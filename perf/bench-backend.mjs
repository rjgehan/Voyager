#!/usr/bin/env node
// Measures the production jar on the generated vault (docs/PERFORMANCE.md): cold start, index build, memory, the
// common reads, search, saves, a rename with 200 backlinks, history, SSE fan-out to 20 clients and the graph.
//
//   node perf/bench-backend.mjs --data <dir> [--jar backend/target/notesapp-0.0.1-SNAPSHOT.jar] [--port 18600]
//        [--publish-port 5150] [--xmx 768m] [--jfr <file.jfr>] [--out <results.json>] [--serve]
//
// <dir> is generate-vault.mjs's --out. Every run starts from a fresh copy of <dir>/vault in <dir>/run, so runs are
// comparable. --serve leaves the server running after the measurements (for the browser part) until Ctrl-C.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import zlib from 'node:zlib';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]?.startsWith('--') ? 'true' : (all[i + 1] ?? 'true')]);
  return pairs;
}, []));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const data = path.resolve(args.data ?? '');
if (!args.data || !fs.existsSync(path.join(data, 'manifest.json'))) {
  console.error('usage: node perf/bench-backend.mjs --data <generate-vault --out dir> [--port 18600] [--serve]');
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.join(data, 'manifest.json'), 'utf8'));
const jar = path.resolve(args.jar ?? fs.readdirSync(path.join(root, 'backend/target'))
  .filter((f) => /^notesapp-.*\.jar$/.test(f)).map((f) => path.join(root, 'backend/target', f))[0] ?? '');
const PORT = Number(args.port ?? 18600);
const PUBLISH_PORT = Number(args['publish-port'] ?? 5150);
const BASE = `http://localhost:${PORT}`;
const CLIENT = 'perf-bench-client-0001';
const run = path.join(data, 'run');
const vault = path.join(run, 'vault');
const results = { machine: machine(), startedAt: new Date().toISOString(), jar: path.basename(jar), manifest: {
  notes: manifest.notes, attachments: manifest.attachments, commits: manifest.commits, bytes: manifest.bytes } };

function machine() {
  const ps = (command) => {
    try {
      return execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  return {
    cpu: ps('(Get-CimInstance Win32_Processor).Name') ?? process.arch,
    cores: ps('(Get-CimInstance Win32_Processor).NumberOfLogicalProcessors'),
    ramGiB: Math.round(Number(ps('(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory') ?? 0) / 2 ** 30),
    os: ps('(Get-CimInstance Win32_OperatingSystem).Caption'),
    java: spawnSync('java', ['-version'], { encoding: 'utf8' }).stderr.split('\n')[0].trim(),
    node: process.version,
  };
}

// ------------------------------------------------------------------ helpers
const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))];
  const round = (v) => Math.round(v * 10) / 10;
  return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1]) };
};

// node:http with keep-alive, not fetch: undici's fetch adds about 15 ms to every request on Windows (curl and
// node:http do not). Responses are gzipped as for a browser; the time includes reading and inflating the body.
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function request(method, url, headers, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: url, agent,
      headers: { Host: `localhost:${PORT}`, 'Accept-Encoding': 'gzip', ...headers,
        ...(payload !== undefined ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let buffer = Buffer.concat(chunks);
        const wire = buffer.length;
        if (response.headers['content-encoding'] === 'gzip') buffer = zlib.gunzipSync(buffer);
        resolve({ status: response.statusCode, buffer, wire });
      });
      response.on('error', reject);
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function call(method, url, body, extraHeaders = {}) {
  const headers = { 'X-Client-Id': CLIENT, Accept: 'application/json', ...extraHeaders };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const started = performance.now();
  const response = await request(method, url, headers, payload);
  const ms = performance.now() - started;
  let json = null;
  try {
    json = JSON.parse(response.buffer.toString('utf8'));
  } catch {
    // not JSON
  }
  return { status: response.status, ms, bytes: response.buffer.length, wireBytes: response.wire, json };
}

async function ok(method, url, body) {
  const result = await call(method, url, body);
  if (result.status >= 300) {
    throw new Error(`${method} ${url} -> ${result.status} ${JSON.stringify(result.json)?.slice(0, 300)}`);
  }
  return result;
}

async function sample(label, warmup, runs, action) {
  for (let i = 0; i < warmup; i++) await action(i);
  const samples = [];
  let last;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    last = await action(warmup + i);
    samples.push(performance.now() - started);
  }
  const s = stats(samples);
  console.log(`  ${label.padEnd(58)} p50 ${String(s.p50).padStart(7)} ms  p95 ${String(s.p95).padStart(7)} ms`);
  return { ...s, ...(last && typeof last === 'object' && 'bytes' in last ? { bytes: last.bytes } : {}) };
}

const enc = encodeURIComponent;
// --only reads,search,history,writes,move,sse runs some sections; --reuse keeps the run's vault (no fresh copy);
// --no-boot2 skips the second boot.
const want = (section) => !args.only || args.only.split(',').includes(section);

// ------------------------------------------------------------------ the server
let server = null;
let serverLog = '';
let serverLabel = '';

function startServer(label) {
  serverLabel = label;
  const jvm = [`-Xmx${args.xmx ?? '768m'}`, '-XX:+ExitOnOutOfMemoryError'];
  if (args.jfr) {
    jvm.push(`-XX:StartFlightRecording=filename=${path.resolve(args.jfr).replace(/\.jfr$/, '')}-${label}.jfr,settings=profile,dumponexit=true`);
  }
  const props = {
    'server.port': PORT,
    'server.address': '127.0.0.1',
    'notes.vault-dir': vault,
    'notes.allowed-hosts': `localhost:${PORT},127.0.0.1:${PORT},localhost`,
    'notes.identity.allow-default': 'true',
    'notes.security.require-tailscale-interface': 'false',
    'notes.secrets-dir': path.join(run, 'secrets'),
    'notes.backup.status-file': path.join(run, 'no-backup', 'status.json'),
    'notes.vaults.dir': path.join(run, 'vaults'),
    'notes.vaults.allow-create': 'false',
    'notes.publish.port': PUBLISH_PORT,
    'notes.publish.dir': path.join(run, 'publish'),
    'notes.welcome-note': 'false',
    'management.health.diskspace.path': vault,
    // --props 'a=1;b=2' adds or overrides server properties (experiments: an access log, other limits).
    ...Object.fromEntries((args.props ?? '').split(';').filter(Boolean).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])),
  };
  const argv = [...jvm, '-jar', jar, ...Object.entries(props).map(([k, v]) => `--${k}=${v}`)];
  const started = performance.now();
  serverLog = '';
  server = spawn('java', argv, { cwd: run, stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (chunk) => {
    serverLog += chunk.toString();
    fs.appendFileSync(path.join(run, `server-${label}.log`), chunk);
  };
  server.stdout.on('data', append);
  server.stderr.on('data', append);
  server.on('exit', (code) => {
    if (code !== null && code !== 0 && code !== 1) console.error(`server exited with ${code}`);
  });
  return started;
}

async function waitReady(started) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await request('GET', '/readyz', {});
      if (response.status === 200) return performance.now() - started;
    } catch {
      // not listening yet
    }
    if (server.exitCode !== null) throw new Error(`server exited:\n${serverLog.slice(-3000)}`);
    await sleep(25);
  }
  throw new Error('server did not become ready in 180 s');
}

async function waitGit(started) {
  for (;;) {
    const status = (await ok('GET', '/api/status')).json;
    if (status.git.state === 'ready') return performance.now() - started;
    await sleep(100);
  }
}

function memory() {
  const pid = server.pid;
  try {
    execFileSync('jcmd', [String(pid), 'GC.run'], { encoding: 'utf8' });
  } catch {
    // jcmd may be missing; the RSS still tells
  }
  let heapUsedMiB = null;
  try {
    const info = execFileSync('jcmd', [String(pid), 'GC.heap_info'], { encoding: 'utf8' });
    const match = /used (\d+)K/.exec(info);
    if (match) heapUsedMiB = Math.round(Number(match[1]) / 1024);
  } catch {
    // ignore
  }
  let rssMiB = null;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: 'utf8' });
    rssMiB = Math.round(Number(out.trim()) / 2 ** 20);
  } catch {
    try {
      rssMiB = Math.round(Number(fs.readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * 4096 / 2 ** 20);
    } catch {
      // ignore
    }
  }
  return { heapUsedMiB, rssMiB };
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    await call('POST', '/api/history/commit');
  } catch {
    // ignore
  }
  if (args.jfr) {
    // The process is killed (Windows has no SIGTERM for it), so the recording is dumped first.
    try {
      execFileSync('jcmd', [String(server.pid), 'JFR.dump', `filename=${path.resolve(args.jfr).replace(/\.jfr$/, '')}-${serverLabel}.jfr`], { encoding: 'utf8' });
    } catch (error) {
      console.error(`JFR.dump failed: ${error.message}`);
    }
  }
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill(); // our own child, by its handle (its exact PID)
  await exited;
  server = null;
}

process.on('SIGINT', async () => {
  await stopServer();
  process.exit(130);
});

// ------------------------------------------------------------------ SSE clients
function openStream(clientId) {
  const frames = [];
  const waiters = [];
  let req;
  const ready = (async () => {
    let buffer = '';
    let resolveHello;
    const hello = new Promise((resolve) => (resolveHello = resolve));
    req = http.get({ host: '127.0.0.1', port: PORT, path: `/api/events?clientId=${clientId}`,
      headers: { Host: `localhost:${PORT}`, Accept: 'text/event-stream' } }, (response) => {
      response.setEncoding('utf8');
      response.on('error', () => {});
      response.on('data', (chunk) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = /^event: ?(.*)$/m.exec(raw)?.[1];
          const dataLine = /^data: ?(.*)$/m.exec(raw)?.[1];
          if (!event) continue;
          const frame = { event, data: dataLine ? JSON.parse(dataLine) : null, at: performance.now() };
          if (event === 'hello') resolveHello();
          frames.push(frame);
          for (const waiter of [...waiters]) {
            if (waiter.match(frame)) {
              waiters.splice(waiters.indexOf(waiter), 1);
              waiter.resolve(frame);
            }
          }
        }
      });
    });
    req.on('error', () => {});
    await hello;
  })();
  return {
    ready,
    waitFor: (match) => {
      const found = frames.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((resolve) => waiters.push({ match, resolve }));
    },
    close: () => req?.destroy(),
  };
}

// ------------------------------------------------------------------ the measurements
async function measure() {
  const r = (results.backend = {});
  const version = async (p) => (await ok('GET', `/api/files?path=${enc(p)}`)).json.version;

  if (want('reads')) {
  console.log('reads');
  r.tree = await sample('GET /api/tree', 3, 15, () => ok('GET', '/api/tree'));
  r.status = await sample('GET /api/status', 3, 15, () => ok('GET', '/api/status'));
  r.openNote = await sample('GET /api/files (a 4 KB note)', 3, 30, (i) => ok('GET', `/api/files?path=${enc(manifest.hubSources[i % 50])}`));
  r.openBigNote = await sample('GET /api/files (the 5 MB note)', 2, 10, () => ok('GET', `/api/files?path=${enc(manifest.bigNote)}`));
  r.openSheet = await sample('GET /api/files (the 2,000 x 30 sheet)', 2, 10, () => ok('GET', `/api/files?path=${enc(manifest.sheet)}`));
  r.openCanvas = await sample('GET /api/files (the 1,000-card canvas)', 2, 10, () => ok('GET', `/api/files?path=${enc(manifest.canvas)}`));
  r.noteMeta = await sample('GET /api/notes/meta', 3, 30, (i) => ok('GET', `/api/notes/meta?path=${enc(manifest.hubSources[i % 50])}`));
  r.backlinksHub = await sample('GET /api/notes/backlinks (Hub, 200 linked)', 3, 15, () => ok('GET', `/api/notes/backlinks?path=${enc(manifest.hub)}`));
  r.unlinked = await sample('GET /api/notes/backlinks?unlinked=true (a note)', 1, 8, () => ok('GET', `/api/notes/backlinks?unlinked=true&path=${enc(manifest.sampleNote)}`));
  r.graph = await sample('GET /api/graph', 3, 15, () => ok('GET', '/api/graph'));
  const graphVersion = (await ok('GET', '/api/graph')).json.version;
  r.graphUnchanged = await sample('GET /api/graph?since= (unchanged)', 3, 15, () => ok('GET', `/api/graph?since=${enc(graphVersion)}`));
  r.tags = await sample('GET /api/tags', 3, 15, () => ok('GET', '/api/tags'));
  r.properties = await sample('GET /api/properties', 3, 15, () => ok('GET', '/api/properties'));
  const today = new Date().toISOString().slice(0, 10);
  r.tasksToday = await sample('GET /api/tasks?view=today', 3, 15, () => ok('GET', `/api/tasks?view=today&date=${today}`));
  r.tasksList = await sample('GET /api/tasks?view=list (500 tasks)', 3, 15, () => ok('GET', '/api/tasks?view=list'));
  r.calendar = await sample('GET /api/notes/by-date (a year, created)', 2, 10, () => ok('GET', '/api/notes/by-date?from=2025-01-01&to=2025-12-31&property=created'));

  }
  if (want('search')) {
  console.log('search (prefix=true&fuzzy=true, as the search panel sends)');
  r.search = {};
  const all = [];
  for (const [kind, queries] of Object.entries(manifest.queries)) {
    for (const q of queries) {
      const label = `search ${kind}: ${q}`;
      const samples = [];
      for (let i = 0; i < 3; i++) await ok('GET', `/api/search?q=${enc(q)}&prefix=true&fuzzy=true`);
      let total = 0;
      for (let i = 0; i < 12; i++) {
        const result = await ok('GET', `/api/search?q=${enc(q)}&prefix=true&fuzzy=true`);
        samples.push(result.ms);
        total = result.json.total;
      }
      const s = stats(samples);
      all.push(...samples);
      r.search[q] = { kind, total, ...s };
      console.log(`  ${label.padEnd(58)} p50 ${String(s.p50).padStart(7)} ms  p95 ${String(s.p95).padStart(7)} ms  (${total} hits)`);
    }
  }
  r.searchAll = stats(all);
  console.log(`  ${'all queries'.padEnd(58)} p50 ${String(r.searchAll.p50).padStart(7)} ms  p95 ${String(r.searchAll.p95).padStart(7)} ms`);
  // Typing in the search box: every prefix of a phrase, as the panel queries while the user types.
  const typed = 'quarterly review';
  r.searchTyping = await sample('search while typing (16 prefixes of "quarterly review")', 0, 1, async () => {
    for (let i = 1; i <= typed.length; i++) await ok('GET', `/api/search?q=${enc(typed.slice(0, i))}&prefix=true&fuzzy=true`);
  });
  // Four concurrent searchers.
  {
    const queries = Object.values(manifest.queries).flat().filter((q) => !q.startsWith('/'));
    const samples = [];
    const until = performance.now() + 5000;
    await Promise.all(Array.from({ length: 4 }, async (_, w) => {
      let i = w;
      while (performance.now() < until) {
        const result = await ok('GET', `/api/search?q=${enc(queries[i++ % queries.length])}&prefix=true&fuzzy=true`);
        samples.push(result.ms);
      }
    }));
    r.searchConcurrent4 = { ...stats(samples), perSecond: Math.round(samples.length / 5) };
    console.log(`  ${'4 concurrent searchers'.padEnd(58)} p50 ${String(r.searchConcurrent4.p50).padStart(7)} ms  p95 ${String(r.searchConcurrent4.p95).padStart(7)} ms  ${r.searchConcurrent4.perSecond}/s`);
  }

  }
  if (want('history')) {
  console.log('history');
  r.historyHub = await sample('GET /api/history (Hub, ~80 commits)', 2, 10, () => ok('GET', `/api/history?path=${enc(manifest.hub)}&limit=50`));
  r.historyCold = await sample('GET /api/history (a note in 1 of 2,000 commits)', 2, 10, () => ok('GET', `/api/history?path=${enc(manifest.coldNote)}&limit=50`));
  r.historyRenamed = await sample('GET /api/history (a renamed note, --follow)', 2, 10, () => ok('GET', `/api/history?path=${enc(manifest.renamed[0])}&limit=50`));
  r.historyLog = await sample('GET /api/history/log (first page)', 2, 10, () => ok('GET', '/api/history/log?limit=50'));
  r.historyLogDeep = await sample('GET /api/history/log?offset=1900', 2, 10, () => ok('GET', '/api/history/log?limit=50&offset=1900'));
  r.historyChanges = await sample('GET /api/history/changes (30 days)', 1, 5, () => ok('GET', `/api/history/changes?since=${new Date(Date.now() - 30 * 86400000).toISOString()}`));
  r.historyDeleted = await sample('GET /api/history/deleted', 1, 5, () => ok('GET', '/api/history/deleted?limit=50'));
  {
    const commits = (await ok('GET', `/api/history?path=${enc(manifest.hub)}&limit=50`)).json.entries;
    const old = commits[commits.length - 1];
    r.historyContent = await sample('GET /api/history/content (an old Hub version)', 2, 10, () => ok('GET', `/api/history/content?path=${enc(old.path)}&commit=${old.commitId}`));
  }

  }
  if (want('writes')) {
  console.log('writes');
  {
    const p = manifest.sampleNote;
    let v = await version(p);
    const base = (await ok('GET', `/api/files?path=${enc(p)}`)).json.content;
    r.save = await sample('PUT /api/files (a 4 KB note)', 5, 60, async (i) => {
      const result = await ok('PUT', `/api/files?path=${enc(p)}`, { content: `${base}\nEdit ${i}\n`, baseVersion: v });
      v = result.json.file.version;
      return result;
    });
  }
  {
    const p = manifest.bigNote;
    let v = await version(p);
    const base = (await ok('GET', `/api/files?path=${enc(p)}`)).json.content;
    r.saveBig = await sample('PUT /api/files (the 5 MB note)', 2, 10, async (i) => {
      const result = await ok('PUT', `/api/files?path=${enc(p)}`, { content: `${base}\nEdit ${i}\n`, baseVersion: v });
      v = result.json.file.version;
      return result;
    });
  }
  {
    const p = manifest.sheet;
    let v = await version(p);
    const base = (await ok('GET', `/api/files?path=${enc(p)}`)).json.content;
    r.saveSheet = await sample('PUT /api/files (the sheet, one cell changed)', 2, 10, async (i) => {
      const result = await ok('PUT', `/api/files?path=${enc(p)}`, { content: base.replace('"C2": { "v": ', `"C2": { "v": ${i}`), baseVersion: v });
      v = result.json.file.version;
      return result;
    });
  }
  {
    const p = manifest.canvas;
    let v = await version(p);
    const base = (await ok('GET', `/api/files?path=${enc(p)}`)).json.content;
    r.saveCanvas = await sample('PUT /api/files (the canvas, one card moved)', 2, 10, async (i) => {
      const result = await ok('PUT', `/api/files?path=${enc(p)}`, { content: base.replace('"x":0,', `"x":${i + 1},`), baseVersion: v });
      v = result.json.file.version;
      return result;
    });
  }
  r.create = await sample('POST /api/files (a new note)', 2, 20, (i) => ok('POST', '/api/files', { path: `Inbox/Perf ${Date.now()} ${i}.md`, content: `# New ${i}\n\n[[Hub]]\n` }));
  }
  if (want('move')) {
    const moved = await call('POST', '/api/move', { from: manifest.hub, to: 'Hub 2.md', updateLinks: true });
    if (moved.status !== 200) throw new Error(`move failed ${moved.status} ${JSON.stringify(moved.json)}`);
    r.renameHub = { ms: Math.round(moved.ms), linkUpdates: moved.json.linkUpdates?.length ?? null };
    console.log(`  ${'POST /api/move (Hub, 200 backlinks)'.padEnd(58)} ${Math.round(moved.ms)} ms (${r.renameHub.linkUpdates} notes rewritten)`);
    const back = await call('POST', '/api/move', { from: 'Hub 2.md', to: manifest.hub, updateLinks: true });
    r.renameHubBack = { ms: Math.round(back.ms) };
    console.log(`  ${'POST /api/move (and back)'.padEnd(58)} ${Math.round(back.ms)} ms`);
    const folder = await call('POST', '/api/move', { from: 'Area 07', to: 'Area 07 moved', updateLinks: true });
    r.moveFolder = { ms: Math.round(folder.ms), linkUpdates: folder.json?.linkUpdates?.length ?? null, status: folder.status };
    console.log(`  ${'POST /api/move (a folder of 100 notes)'.padEnd(58)} ${Math.round(folder.ms)} ms (${r.moveFolder.linkUpdates} notes rewritten)`);
  }

  if (want('sse')) {
  console.log('SSE fan-out (20 clients)');
  {
    const streams = Array.from({ length: 20 }, (_, i) => openStream(`perf-listener-${String(i).padStart(4, '0')}`));
    await Promise.all(streams.map((s) => s.ready));
    const p = manifest.hubSources[7];
    let v = await version(p);
    const base = (await ok('GET', `/api/files?path=${enc(p)}`)).json.content;
    const samples = [];
    const saves = [];
    for (let i = 0; i < 25; i++) {
      const started = performance.now();
      const result = await ok('PUT', `/api/files?path=${enc(p)}`, { content: `${base}\nFan-out ${i}\n`, baseVersion: v });
      saves.push(performance.now() - started);
      v = result.json.file.version;
      const expected = v;
      const frames = await Promise.all(streams.map((s) => s.waitFor((f) => f.event === 'file.changed' && f.data.file.version === expected)));
      if (i >= 5) samples.push(Math.max(...frames.map((f) => f.at)) - started);
    }
    streams.forEach((s) => s.close());
    r.sseFanOut20 = stats(samples);
    r.saveWith20Streams = stats(saves.slice(5));
    console.log(`  ${'save to file.changed at all 20 clients'.padEnd(58)} p50 ${String(r.sseFanOut20.p50).padStart(7)} ms  p95 ${String(r.sseFanOut20.p95).padStart(7)} ms`);
  }
  }
}

// ------------------------------------------------------------------ main
async function main() {
  if (!fs.existsSync(jar)) throw new Error(`no jar at ${jar}: run perf/build-jar.sh`);
  if (!args.reuse) {
    console.log(`copying the vault to ${run}...`);
    fs.rmSync(run, { recursive: true, force: true });
    fs.mkdirSync(run, { recursive: true });
    fs.cpSync(path.join(data, 'vault'), vault, { recursive: true });
  }

  console.log('first boot (fresh copy: no .notesapp caches)');
  let started = startServer('boot1');
  const ready = await waitReady(started);
  const status = (await ok('GET', '/api/status')).json;
  results.startup = {
    coldStartMs: Math.round(ready),
    indexBuiltInMs: status.index.builtInMs,
    files: status.vault.files,
    notes: status.vault.notes,
    memoryAtReady: memory(),
  };
  console.log(`  ready in ${Math.round(ready)} ms (index ${status.index.builtInMs} ms, ${status.vault.files} files)`);
  results.startup.gitReadyMs = Math.round(await waitGit(started));
  console.log(`  git bootstrap done ${results.startup.gitReadyMs} ms after start`);
  // PDF text extraction runs in the background after readiness.
  {
    const cache = path.join(vault, '.notesapp', 'cache', 'search-text');
    const pdfs = Math.round(manifest.attachments * 0.3);
    const deadline = Date.now() + 600_000;
    let count = 0;
    while (Date.now() < deadline) {
      count = fs.existsSync(cache) ? fs.readdirSync(cache).length : 0;
      if (count >= pdfs) break;
      await sleep(250);
    }
    results.startup.pdfTextDoneMs = Math.round(performance.now() - started);
    results.startup.pdfTextCached = count;
    console.log(`  PDF text of ${count} PDFs extracted ${results.startup.pdfTextDoneMs} ms after start`);
  }
  results.startup.memorySteady = memory();
  console.log(`  memory after GC: heap ${results.startup.memorySteady.heapUsedMiB} MiB, RSS ${results.startup.memorySteady.rssMiB} MiB`);

  await measure();
  results.memoryAfter = memory();
  console.log(`memory after the run: heap ${results.memoryAfter.heapUsedMiB} MiB, RSS ${results.memoryAfter.rssMiB} MiB`);
  const serve = async () => {
    console.log(`serving ${BASE} (Ctrl-C stops)`);
    await new Promise(() => {});
  };
  if (args.serve && args['no-boot2']) await serve();
  await stopServer();

  if (!args['no-boot2']) {
    console.log('second boot (warm .notesapp caches and OS file cache)');
    started = startServer('boot2');
    results.startup.warmStartMs = Math.round(await waitReady(started));
    results.startup.warmGitReadyMs = Math.round(await waitGit(started));
    console.log(`  ready in ${results.startup.warmStartMs} ms, git ready ${results.startup.warmGitReadyMs} ms`);
    if (args.serve) await serve();
    await stopServer();
  }

  const outFile = path.resolve(args.out ?? path.join(data, `results-${Date.now()}.json`));
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`results: ${outFile}`);
}

main().catch(async (error) => {
  console.error(error);
  await stopServer();
  process.exit(1);
});
