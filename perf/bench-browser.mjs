#!/usr/bin/env node
// Runs perf/bench-browser.js in a headless Chromium (Edge or Chrome) against a running server (docs/PERFORMANCE.md,
// "Browser"), over the DevTools protocol: no dependencies, nothing downloaded. Start the server first, for example
// `node perf/bench-backend.mjs --data <dir> --only none --no-boot2 --serve`.
//
//   node perf/bench-browser.mjs [--url http://localhost:18600] [--browser <chrome or msedge path>] [--cdp-port 5150]
//        [--cpu 1,4] [--only load,open,typing,keys,sheet,canvas,graph,switcher,search] [--out results.json]
//        [--profile true] [--browser-args='--disable-gpu ...'] [--data <generate-vault --out dir>]
//
// --cpu runs everything once per CPU slowdown factor (DevTools CPU throttling; 4 approximates a phone).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// --name value, or --name=value (for values that start with --, such as --browser-args=--disable-gpu).
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--') && arg.includes('=')) pairs.push([arg.slice(2, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]);
  else if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') ? 'true' : (all[i + 1] ?? 'true')]);
  return pairs;
}, []));
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const URL_BASE = args.url ?? 'http://localhost:18600';
const CDP_PORT = Number(args['cdp-port'] ?? 5150);
const CPU = (args.cpu ?? '1').split(',').map(Number);
const want = (section) => !args.only || args.only.split(',').includes(section);
const manifest = args.data ? JSON.parse(fs.readFileSync(path.join(args.data, 'manifest.json'), 'utf8')) : null;
const SAMPLE_NOTE = manifest?.sampleNote ?? null;
const BIG_NOTE = manifest?.bigNote ?? 'Big/Big Note.md';
const SHEET = manifest?.sheet ?? 'Sheets/Big Sheet.sheet';
const CANVAS = manifest?.canvas ?? 'Canvas/Big Canvas.canvas';

function findBrowser() {
  const candidates = [
    args.browser,
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('no Chromium-based browser found: pass --browser <path>');
  return found;
}

// ------------------------------------------------------------------ a minimal DevTools protocol client
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} ${message.error.data ?? ''}`));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method, sessionId) {
    return new Promise((resolve) => {
      const listener = (message) => {
        if (message.method === method && (!sessionId || message.sessionId === sessionId)) {
          this.listeners.splice(this.listeners.indexOf(listener), 1);
          resolve(message.params);
        }
      };
      this.listeners.push(listener);
    });
  }
}

class Page {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  send(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  /** Evaluates an expression in the page (awaiting a promise) and returns its value. */
  async eval(expression, timeout = 300000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (result.exceptionDetails) {
      throw new Error(`page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  async navigate(url) {
    const loaded = this.cdp.once('Page.loadEventFired', this.sessionId);
    await this.send('Page.navigate', { url });
    await loaded;
  }

  async waitFor(expression, timeout = 120000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await this.eval(`!!(${expression})`)) return;
      await sleep(50);
    }
    throw new Error(`timed out waiting for ${expression}`);
  }

  /**
   * With --profile, runs `action` under the JavaScript sampling profiler, writes `<name>.cpuprofile` next to the
   * results (open it in DevTools' Performance panel) and prints the functions with the most self time.
   */
  async profiled(name, action) {
    if (!args.profile) return action();
    await this.send('Profiler.enable');
    await this.send('Profiler.setSamplingInterval', { interval: 200 });
    await this.send('Profiler.start');
    try {
      return await action();
    } finally {
      const { profile } = await this.send('Profiler.stop');
      const dir = path.dirname(path.resolve(args.out ?? '.'));
      fs.writeFileSync(path.join(dir, `${name}.cpuprofile`), JSON.stringify(profile));
      const self = new Map();
      const total = profile.samples.length;
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const counts = new Map();
      for (const id of profile.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const [id, count] of counts) {
        const frame = byId.get(id).callFrame;
        const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop()}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
        self.set(key, (self.get(key) ?? 0) + count);
      }
      console.log(`  profile ${name}: top self time of ${total} samples`);
      for (const [key, count] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        console.log(`    ${((100 * count) / total).toFixed(1).padStart(5)}%  ${key}`);
      }
    }
  }

  /** Types `text` as real key events (keyDown with text, keyUp), `delay` ms apart. */
  async type(text, delay = 60) {
    for (const ch of text) {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      await sleep(delay);
    }
  }
}

// ------------------------------------------------------------------ main
/** One browser, with a new profile of its own, for the runs at one CPU slowdown. */
async function runAt(cpuRate, results) {
  const browserPath = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-perf-browser-'));
  const browser = spawn(browserPath, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,900',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--mute-audio',
    // --browser-args '--disable-gpu ...' adds switches (e.g. to compare GPU and software rasterization).
    ...(args['browser-args'] ?? '').split(' ').filter(Boolean),
    'about:blank',
  ], { stdio: 'ignore' });
  results.browser = path.basename(browserPath);
  try {
    let version;
    for (let i = 0; i < 100 && !version; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      } catch {
        await sleep(100);
      }
    }
    if (!version) throw new Error('the browser did not open its DevTools port');
    results.browserVersion = version.Browser;
    console.log(`${version.Browser} (headless), ${URL_BASE}`);
    const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
    const script = fs.readFileSync(path.join(here, 'bench-browser.js'), 'utf8');

    for (const cpu of [cpuRate]) {
      console.log(`\nCPU slowdown ${cpu}x`);
      const run = (results.runs[`cpu${cpu}x`] = {});
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(cdp, sessionId);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: script });
      await page.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      const print = (label, value) => console.log(`  ${label.padEnd(40)} ${JSON.stringify(value)}`);

      // The first load warms the HTTP cache like a returning visitor; the measured load is the second.
      await page.navigate(`${URL_BASE}/`);
      await page.waitFor("document.querySelectorAll('.tree-row').length > 0");
      await sleep(1000);
      if (args.eval) {
        // Debugging: --eval '<expression>' runs in the loaded app and prints its value.
        console.log(JSON.stringify(await page.eval(args.eval), null, 2));
        continue;
      }
      if (want('load')) {
        await page.navigate(`${URL_BASE}/`);
        await page.waitFor("document.querySelectorAll('.tree-row').length > 0");
        await sleep(2000);
        run.load = await page.eval('notesPerf.load()');
        print('load', run.load);
      }
      if (want('open') && SAMPLE_NOTE) {
        run.openNote = await page.eval(`notesPerf.open(${JSON.stringify(SAMPLE_NOTE)})`);
        print('open a 4 KB note', run.openNote);
        // A second note: the editor's chunks are loaded now.
        run.openNoteWarm = await page.eval(`notesPerf.open(${JSON.stringify(manifest.hubSources[5])})`);
        print('open another note (warm)', run.openNoteWarm);
      }
      if (want('open') || want('typing') || want('keys')) {
        run.openBigNote = await page.profiled(`open-big-note-cpu${cpu}x`, () => page.eval(`notesPerf.open(${JSON.stringify(BIG_NOTE)})`));
        print('open the 5 MB note', run.openBigNote);
      }
      if (want('typing')) {
        for (const at of [0.001, 0.5, 1]) {
          run[`typingAt${at}`] = await page.profiled(`typing-at-${at}-cpu${cpu}x`, () => page.eval(`notesPerf.typing({ count: 40, at: ${at} })`));
          print(`typing at ${at * 100}% (dispatched)`, run[`typingAt${at}`]);
          await sleep(1500);
        }
      }
      if (want('keys')) {
        // Real key events into the editor (Event Timing reports the slow ones), then the text is removed again.
        await page.eval(`(() => { const v = notesPerf.view();
          const line = v.state.doc.line(Math.round(v.state.doc.lines / 2)); v.dispatch({ selection: { anchor: line.to } }); v.focus(); return true; })()`);
        await sleep(500);
        await page.eval('notesPerf.watchInput()');
        await page.type('the quick brown fox jumps over the lazy dog ', 80);
        await sleep(1500);
        run.keys = await page.eval('notesPerf.inputReport()');
        print('real keystrokes', run.keys);
        await page.eval(`(() => { const v = notesPerf.view(); const h = v.state.selection.main.head;
          v.dispatch({ changes: { from: h - 44, to: h } }); return true; })()`);
        await sleep(1500);
      }
      if (want('sheet')) {
        run.openSheet = await page.profiled(`open-sheet-cpu${cpu}x`, () => page.eval(`notesPerf.open(${JSON.stringify(SHEET)})`));
        print('open the sheet', run.openSheet);
        await sleep(1000);
        run.scrollSheet = await page.eval('notesPerf.scrollSheet({ frames: 240 })');
        print('scroll the sheet', run.scrollSheet);
      }
      if (want('canvas')) {
        run.openCanvas = await page.eval(`notesPerf.open(${JSON.stringify(CANVAS)})`);
        print('open the canvas', run.openCanvas);
        await sleep(1000);
        run.panCanvas = await page.eval('notesPerf.panCanvas({ frames: 240 })');
        print('pan the canvas', run.panCanvas);
      }
      if (want('graph')) {
        run.graph = await page.profiled(`graph-cpu${cpu}x`, () => page.eval('notesPerf.graph({ frames: 300 })'));
        print('graph', run.graph);
      }
      if (want('switcher')) {
        // A fresh page: nothing left running from the views opened before (the graph keeps drawing while shown).
        await page.navigate(`${URL_BASE}/`);
        await page.waitFor("document.querySelectorAll('.tree-row').length > 0");
        await sleep(1500);
        run.switcher = await page.profiled(`switcher-cpu${cpu}x`, () => page.eval("notesPerf.switcher('copper har')"));
        print('quick switcher', run.switcher);
        run.switcherOneChar = await page.eval("notesPerf.switcher('a')");
        print('quick switcher, one character', run.switcherOneChar);
      }
      if (want('search')) {
        run.search = await page.eval("notesPerf.search('quarterly review')");
        print('search page', run.search);
      }
      run.memory = await page.eval('notesPerf.memory()');
      print('JS heap', run.memory);
      await cdp.send('Target.closeTarget', { targetId });
    }
  } finally {
    try {
      const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
      const cdp = await Cdp.connect(v.webSocketDebuggerUrl);
      await Promise.race([cdp.send('Browser.close'), sleep(3000)]);
    } catch {
      // already gone
    }
    await Promise.race([new Promise((resolve) => (browser.exitCode !== null ? resolve() : browser.once('exit', resolve))), sleep(5000)]);
    if (browser.exitCode === null) browser.kill();
    await new Promise((resolve) => (browser.exitCode !== null ? resolve() : browser.once('exit', resolve)));
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // the browser may still hold files for a moment
    }
  }
}

async function main() {
  const results = { url: URL_BASE, startedAt: new Date().toISOString(), runs: {} };
  for (const cpu of CPU) {
    await runAt(cpu, results);
  }
  const out = path.resolve(args.out ?? `browser-results-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nresults: ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
