// In-page measurements of the production build on the generated vault (docs/PERFORMANCE.md, "Browser").
// Paste into the DevTools console of the app's tab (or evaluate it with a browser-automation tool), then call the
// functions on window.notesPerf, for example:
//
//   notesPerf.load()                                   initial load: navigation, FCP, LCP, /api/tree, long tasks
//   await notesPerf.open('Big/Big Note.md')            open a file in the app (client-side route), time to content
//   await notesPerf.typing({ count: 40, at: 0.5 })     Live Preview keystrokes, dispatched through the editor
//   notesPerf.watchInput() ... notesPerf.inputReport() real keyboard input (Event Timing), e.g. while typing by hand
//   await notesPerf.scrollSheet({ frames: 240 })       the open sheet scrolled a little every frame; frame times
//   await notesPerf.panCanvas({ frames: 240 })         the open canvas panned every frame; frame times
//   await notesPerf.graph()                            open the graph page; first draw, then frame times
//   await notesPerf.switcher('copper har')             quick switcher: open, type, time to results per keystroke
//   await notesPerf.search('quarterly review')         search page: time from the query to rendered results
//
// Every function returns a plain object (milliseconds). Nothing here depends on the app's code: it drives the UI
// through routes, DOM events and CodeMirror's public view object.
(() => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));
  /** After the next frame has been produced (rAF, then a task after it). */
  const afterPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(() => resolve(performance.now()), 0)));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const round = (v) => Math.round(v * 10) / 10;
  const stats = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))] ?? 0;
    return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1] ?? 0) };
  };
  async function until(predicate, timeout = 120000) {
    const started = performance.now();
    for (;;) {
      if (predicate()) return performance.now();
      if (performance.now() - started > timeout) throw new Error('timed out waiting');
      await frame();
    }
  }

  const longTasks = [];
  try {
    new PerformanceObserver((list) => longTasks.push(...list.getEntries())).observe({ type: 'longtask', buffered: true });
  } catch {
    // not supported
  }
  // Injected at document start (bench-browser.mjs), these see the whole load: the largest paint, and when the file
  // tree first shows rows.
  let lcp = null;
  try {
    new PerformanceObserver((list) => (lcp = list.getEntries().at(-1)?.startTime ?? lcp)).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // not supported
  }
  let treeShownAt = null;
  const watchTree = () => {
    if (document.querySelector('.tree-row')) return;
    const observer = new MutationObserver(() => {
      if (document.querySelector('.tree-row')) {
        observer.disconnect();
        requestAnimationFrame(() => setTimeout(() => (treeShownAt = performance.now()), 0));
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  };
  if (document.documentElement) watchTree();
  else document.addEventListener('readystatechange', watchTree, { once: true });
  /** Main-thread time in long tasks (over 50 ms each) since `from`: the total, the longest and their count. */
  function blocking(from, to = performance.now()) {
    const tasks = longTasks.filter((t) => t.startTime >= from && t.startTime <= to);
    return { longTasks: tasks.length, longTaskMs: round(tasks.reduce((s, t) => s + t.duration, 0)), longestTaskMs: round(Math.max(0, ...tasks.map((t) => t.duration))) };
  }

  const isApple = /Mac|iPhone|iPad/.test(navigator.platform);
  /** A keyboard shortcut, as the app's global key handler sees it. */
  function shortcut(key, { shift = false } = {}) {
    document.activeElement?.blur?.();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code: 'Key' + key.toUpperCase(), shiftKey: shift, bubbles: true, cancelable: true, ...(isApple ? { metaKey: true } : { ctrlKey: true }) }));
  }
  /** Runs a command by its name through the command palette (Ctrl-P). */
  async function runCommand(name) {
    shortcut('p');
    await until(() => !!document.querySelector('.picker-input'), 10000);
    const input = document.querySelector('.picker-input');
    typeInto(input, name);
    await until(() => document.querySelector('.picker-item.is-active .picker-item-label, .picker-item.is-active')?.textContent.includes(name), 10000);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }

  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  /** Sets a React-controlled input's value as typing would. */
  function typeInto(input, text) {
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  /** Opens the quick switcher with its shortcut (Ctrl-O, Cmd-O on Apple) and returns its input. */
  async function openSwitcher() {
    shortcut('o');
    await until(() => !!document.querySelector('.picker-input'), 10000);
    return document.querySelector('.picker-input');
  }

  /** CodeMirror's view object of the visible editor (what EditorView.findFromDOM reads off the content element). */
  function editorView() {
    const content = [...document.querySelectorAll('.cm-content')].find((el) => el.offsetParent !== null) ?? document.querySelector('.cm-content');
    return content?.cmTile?.root?.view ?? content?.cmView?.rootView?.view ?? null;
  }

  /** Frame times (deltas between animation frames) while `step(i)` runs once per frame for `frames` frames. */
  async function frameTimes(frames, step) {
    const deltas = [];
    let last = await frame();
    const started = last;
    for (let i = 0; i < frames; i++) {
      step(i);
      const now = await frame();
      deltas.push(now - last);
      last = now;
    }
    const s = stats(deltas);
    return { ...s, fps: round((1000 * frames) / (last - started)), over50ms: deltas.filter((d) => d > 50).length, ...blocking(started) };
  }

  window.notesPerf = {
    /** The initial load of this page (call after it has loaded). */
    load() {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, round(p.startTime)]));
      const api = (name) => {
        const entry = performance.getEntriesByType('resource').find((r) => new URL(r.name).pathname === name);
        return entry ? { start: round(entry.startTime), end: round(entry.responseEnd), kib: Math.round(entry.encodedBodySize / 1024) } : null;
      };
      const scripts = performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js'));
      return {
        responseEnd: round(nav.responseEnd),
        domContentLoaded: round(nav.domContentLoadedEventEnd),
        load: round(nav.loadEventEnd),
        firstContentfulPaint: paint['first-contentful-paint'] ?? null,
        largestContentfulPaint: lcp !== null ? round(lcp) : null,
        fileTreeShown: treeShownAt !== null ? round(treeShownAt) : null,
        scripts: { count: scripts.length, kib: Math.round(scripts.reduce((s, r) => s + r.encodedBodySize, 0) / 1024) },
        tree: api('/api/tree'),
        status: api('/api/status'),
        settings: api('/api/settings'),
        ...blocking(0),
      };
    },

    /** Opens a file through the app's router; resolves when its content is on screen. */
    async open(path, { marker } = {}) {
      // As a user does: the quick switcher, the file's name, Enter. Timed from the Enter.
      const name = path.split('/').pop().replace(/\.md$/, '');
      const input = await openSwitcher();
      await typeInto(input, name);
      await until(() => [...document.querySelectorAll('.picker-item.is-active .picker-item-label')].some((el) => el.textContent === name || el.textContent === name + path.slice(path.lastIndexOf('.'))), 10000);
      const started = performance.now();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const kind = path.endsWith('.sheet') ? 'sheet' : path.endsWith('.canvas') ? 'canvas' : 'note';
      const ready = () => {
        if (kind === 'sheet') return !!document.querySelector('.sheet-grid canvas') && !document.querySelector('.view-loading');
        if (kind === 'canvas') return document.querySelectorAll('.canvas-world [data-node-id]').length > 0;
        const view = editorView();
        if (!view || view.state.doc.length === 0) return false;
        // The note's own text (by default its title heading), so the previous note's editor never counts.
        const expected = marker ?? '# ' + path.split('/').pop().replace(/\.md$/, '');
        return view.state.sliceDoc(0, Math.min(view.state.doc.length, 4000)).includes(expected);
      };
      await until(ready);
      const shown = await afterPaint();
      // Let it settle (lazy chunks, embeds, the parse catching up), then report the main-thread work.
      await sleep(1500);
      return { path, toContentMs: round(shown - started), ...blocking(started) };
    },

    /**
     * Keystrokes dispatched as typed input into the open note at `at` (0 = start, 1 = end of the document), each
     * followed by a frame: the time of the update itself (sync) and to the next painted frame. They are deleted again
     * afterwards (the note is saved twice).
     */
    async typing({ count = 40, at = 0.5 } = {}) {
      const view = editorView();
      if (!view) throw new Error('no editor');
      const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Math.round(view.state.doc.lines * at))));
      view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
      view.focus();
      await sleep(500);
      await afterPaint();
      const sync = [];
      const toFrame = [];
      const started = performance.now();
      const from = line.to;
      for (let i = 0; i < count; i++) {
        const head = view.state.selection.main.head;
        const t0 = performance.now();
        view.dispatch({ changes: { from: head, insert: i % 6 === 5 ? ' ' : 'x' }, selection: { anchor: head + 1 }, userEvent: 'input.type' });
        sync.push(performance.now() - t0);
        toFrame.push((await afterPaint()) - t0);
      }
      const result = { lines: view.state.doc.lines, chars: view.state.doc.length, sync: stats(sync), toNextFrame: stats(toFrame), ...blocking(started) };
      view.dispatch({ changes: { from, to: from + count }, userEvent: 'delete' });
      return result;
    },

    /** Starts recording real input events (Event Timing: events of 16 ms or more) and keystrokes. */
    watchInput() {
      this._input = { events: [], keys: 0, started: performance.now() };
      const record = this._input;
      this._observer?.disconnect();
      this._observer = new PerformanceObserver((list) => record.events.push(...list.getEntries()));
      this._observer.observe({ type: 'event', durationThreshold: 16, buffered: false });
      this._keydown && removeEventListener('keydown', this._keydown, true);
      this._keydown = () => record.keys++;
      addEventListener('keydown', this._keydown, true);
      return 'recording';
    },

    /** What watchInput saw: keystrokes, and the input events that took 16 ms or more to the next paint. */
    inputReport() {
      const record = this._input;
      if (!record) return null;
      this._observer?.disconnect();
      removeEventListener('keydown', this._keydown, true);
      const slow = record.events.filter((e) => ['keydown', 'keypress', 'input', 'beforeinput', 'keyup'].includes(e.name));
      const keydowns = slow.filter((e) => e.name === 'keydown');
      return {
        keys: record.keys,
        slowKeydowns: keydowns.length,
        keydownDuration: stats(keydowns.map((e) => e.duration)),
        over50ms: keydowns.filter((e) => e.duration > 50).length,
        processing: stats(keydowns.map((e) => e.processingEnd - e.processingStart)),
        ...blocking(record.started),
      };
    },

    /** Scrolls the open sheet's grid a little every frame (down, then right); frame times. */
    async scrollSheet({ frames = 240, step = 60 } = {}) {
      const scroller = document.querySelector('.sheet-grid .dvn-scroller') ?? document.querySelector('.dvn-scroller');
      if (!scroller) throw new Error('no sheet grid');
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
      await sleep(300);
      const down = await frameTimes(frames, () => (scroller.scrollTop += step));
      const right = await frameTimes(Math.round(frames / 2), () => (scroller.scrollLeft += step));
      return { down, right, rowsReached: Math.round(scroller.scrollTop / 34) };
    },

    /** Pans the open canvas with wheel events every frame; frame times, and how many cards are rendered. */
    async panCanvas({ frames = 240, delta = 40 } = {}) {
      const stage = document.querySelector('.canvas-stage');
      if (!stage) throw new Error('no canvas');
      const rect = stage.getBoundingClientRect();
      const wheel = (dx, dy) => stage.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, deltaMode: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true }));
      const pan = await frameTimes(frames, (i) => wheel(i % 120 < 60 ? delta : -delta, delta / 2));
      const zoomOut = await frameTimes(60, () => stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, ctrlKey: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true })));
      const panZoomedOut = await frameTimes(frames, (i) => wheel(i % 120 < 60 ? delta * 4 : -delta * 4, 0));
      return { pan, zoomOut, panZoomedOut, cardsInDom: document.querySelectorAll('.canvas-world [data-node-id]').length };
    },

    /** Opens the graph page: time to the first drawn frame, then frame times while the layout runs and on zoom. */
    async graph({ frames = 300 } = {}) {
      const started = performance.now();
      await runCommand('Open Graph');
      await until(() => {
        const canvas = document.querySelector('canvas.graph-canvas-surface');
        return !!canvas && canvas.width > 0 && !document.querySelector('.graph-message[aria-busy]');
      });
      const shown = await afterPaint();
      const settling = await frameTimes(frames, () => {});
      const canvas = document.querySelector('canvas.graph-canvas-surface');
      const rect = canvas.getBoundingClientRect();
      const zoom = await frameTimes(120, (i) => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: i < 60 ? -40 : 40, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true })));
      return { toFirstDrawMs: round(shown - started), settling, zoom, ...blocking(started) };
    },

    /** Opens the quick switcher (Ctrl/Cmd-O) and types `query` one character per step; time to updated results. */
    async switcher(query = 'copper har') {
      const started = performance.now();
      shortcut('o');
      await until(() => !!document.querySelector('.picker-input'), 10000);
      const input = document.querySelector('.picker-input');
      const opened = await afterPaint();
      // React renders a discrete input event before dispatchEvent returns: sync is the ranking and the render,
      // toNextFrame adds the frame that shows it.
      const sync = [];
      const toFrame = [];
      for (let i = 1; i <= query.length; i++) {
        const t0 = performance.now();
        typeInto(input, query.slice(0, i));
        sync.push(performance.now() - t0);
        toFrame.push((await afterPaint()) - t0);
      }
      const rows = document.querySelectorAll('.picker-item').length;
      document.querySelector('.picker-cancel')?.click();
      await until(() => !document.querySelector('.picker-input'), 5000);
      // Closing an overlay goes back in history; let that settle before anything else.
      await sleep(500);
      return { openMs: round(opened - started), sync: stats(sync), toNextFrame: stats(toFrame), rows, ...blocking(started) };
    },

    /** The search page for `query`: time from the route change to rendered results. */
    async search(query = 'quarterly review') {
      shortcut('f', { shift: true });
      await until(() => !!document.querySelector('.search-input'), 10000);
      const input = document.querySelector('.search-input');
      const once = async (q) => {
        typeInto(input, '');
        await sleep(500);
        const started = performance.now();
        typeInto(input, q);
        // The query is debounced, then fetched; done when hits for it are on screen.
        await until(() => document.querySelectorAll('.search-hit').length > 0 && document.querySelector('.search-count')?.textContent.includes('result'));
        const shown = await afterPaint();
        const request = performance.getEntriesByType('resource').filter((r) => r.name.includes('/api/search?q=')).at(-1);
        return { query: q, toResultsMs: round(shown - started), requestMs: request ? round(request.responseEnd - request.startTime) : null,
          results: document.querySelectorAll('.search-hit').length, ...blocking(started) };
      };
      // The first search loads the panel's data; the second is the steady state.
      const first = await once('meeting notes');
      const second = await once(query);
      return { first, second };
    },

    /** The open editor's view (for scripted edits). */
    view: () => editorView(),

    /** Heap in use (Chromium only), MiB. */
    memory() {
      return performance.memory ? { usedHeapMiB: Math.round(performance.memory.usedJSHeapSize / 2 ** 20) } : null;
    },
  };
  return 'notesPerf ready';
})();
