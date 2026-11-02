// What formulas read from other files (ROADMAP item 42, DESIGN §6.45): notes' properties, notes'
// tables (computed with item 39's engine), query results and spreadsheets' values, kept for the
// page's life and handed to formulas synchronously (HyperFormula's functions cannot wait). A read of
// something not here yet starts loading it and answers "loading"; when it arrives, or later
// changes, the store tells its subscribers which keys changed, and they compute again.
//
// Changes come from the tree (every save, this device's own included, and every other device's
// change through the event stream), from documents open on this device (their text as typed), and
// from spreadsheets open here (their workbook's values, recalculated or edited). Notifications are
// throttled, so typing in a note recalculates the sheets that read it a few times a second at most.
//
// Keys: `names` (which files exist: links resolve against it), `meta:<path>`, `text:<path>`,
// `tables:<path>` (a note's computed tables), `sheet:<path>`, `query:<filter>`.
import type { NotesQueryFilter } from '../../api/endpoints';
import type { FileEntry, NotesQueryResponse, QueriedNote } from '../../api/types';
import type { VaultTree } from '../../api/vaultTree';
import { resolve } from '../../features/links';
import type { FormulaModel } from '../../formulas/model';
import { parseSheet, type SheetFile } from '../format';
import { appLinkHost } from './host';
import { allFormulas, noteFormulas, type NoteFormulas } from './noteText';
import { externalRefs, fileSheet, noteCalls } from './syntax';
import type { LinkValue } from './values';

export type LinkStatus = 'loading' | 'ready' | 'missing' | 'error';

export interface Loaded<T> {
  status: LinkStatus;
  value: T | null;
  message?: string;
}

/** A computed table of a note: its sheet name and its values (row 0 is the header). */
export interface ComputedTable {
  name: string;
  rows: LinkValue[][];
}

/** What a computation that reads other files carries (HyperFormula's `context`, DESIGN §6.45). */
export interface LinkContext {
  /** The file whose formulas these are (links resolve from it), or null (from the vault's root). */
  path(): string | null;
  /** The store keys the computation read. */
  reads: Set<string>;
  /** How many files deep: a sheet's NOTETABLE computes a note's tables at depth 1, and so on. */
  depth: number;
}

export function linkContext(path: () => string | null, depth = 0): LinkContext {
  return { path, reads: new Set(), depth };
}

/** Computes a note's tables with item 39's engine (formulas/engine.ts, a lazy chunk). */
export type TableComputer = (model: FormulaModel, context: LinkContext) => ComputedTable[];

/** A document open on this device: its current text, and its changes as typed. */
export interface OpenDocument {
  text(): string;
  subscribe(fn: () => void): () => void;
}

/** A spreadsheet's workbook open on this device (DESIGN §6.21.4): its live model and changes. */
export interface LiveSheet {
  file(): SheetFile;
  subscribe(fn: () => void): () => void;
}

/** What the store reads from the app: the tree, the API, open documents and the formula engine. */
export interface LinkHost {
  tree(): VaultTree;
  onTreeChange(fn: () => void): () => void;
  queryNotes(filter: NotesQueryFilter): Promise<NotesQueryResponse>;
  readFile(path: string): Promise<string>;
  openDocument(path: string): OpenDocument | null;
  tableComputer(): Promise<TableComputer>;
}

/** How deep NOTETABLE may reach through notes that read sheets that read notes. */
export const MAX_DEPTH = 4;
/** Notifications at most this often (ms). */
export const THROTTLE_MS = 400;
/** Query results at most (NOTEQUERY spills at most this many notes). */
export const QUERY_LIMIT = 500;

interface Entry<T> {
  status: LinkStatus;
  value: T | null;
  message?: string;
  /** The tree entry's version (or mtime) the value was read at. */
  seen: string | null;
  /** A load is under way. */
  loading: boolean;
  /** Stops listening to an open document. */
  off?: () => void;
}

interface TablesEntry {
  text: string;
  value: Loaded<ComputedTable[]>;
  reads: Set<string>;
}

function stamp(entry: FileEntry | undefined): string | null {
  return entry ? (entry.version ?? `${entry.size}:${entry.mtime}`) : null;
}

const json = (v: unknown) => JSON.stringify(v ?? null);

export class LinkStore {
  private readonly host: LinkHost;
  private readonly metas = new Map<string, Entry<QueriedNote>>();
  private readonly texts = new Map<string, Entry<string>>();
  private readonly sheets = new Map<string, Entry<SheetFile>>();
  private readonly queries = new Map<string, Entry<NotesQueryResponse> & { filter: NotesQueryFilter }>();
  private readonly tablesCache = new Map<string, TablesEntry>();
  private readonly formulasCache = new Map<string, { text: string; value: NoteFormulas }>();
  private readonly live = new Map<string, { sheet: LiveSheet; off: () => void }>();
  /** NOTETABLE reads found while computing: file → notes it read (beyond what its text says). */
  private readonly dynamicEdges = new Map<string, Set<string>>();
  /** Notes whose tables are being computed now (a NOTETABLE that comes back to one is a cycle). */
  private readonly computing = new Set<string>();
  private computer: TableComputer | null = null;
  private computerLoading = false;
  private readonly trackers: Set<string>[] = [];
  private readonly listeners = new Set<(keys: ReadonlySet<string>) => void>();
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlush = 0;
  private tree: VaultTree;
  private readonly offTree: () => void;
  private inFlight = 0;
  private idle: Array<() => void> = [];

  constructor(host: LinkHost) {
    this.host = host;
    this.tree = host.tree();
    this.offTree = host.onTreeChange(() => this.treeChanged());
  }

  // ---------- subscribing ----------

  /** Hears the keys that changed (throttled). */
  subscribe(fn: (keys: ReadonlySet<string>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Runs `fn` recording the keys it reads into `reads`. */
  track<T>(reads: Set<string>, fn: () => T): T {
    this.trackers.push(reads);
    try {
      return fn();
    } finally {
      this.trackers.pop();
    }
  }

  private read(key: string): void {
    for (const t of this.trackers) t.add(key);
  }

  private changed(key: string): void {
    this.pending.add(key);
    if (this.timer !== null) return;
    const wait = Math.max(30, this.lastFlush + THROTTLE_MS - Date.now());
    this.timer = setTimeout(() => this.flush(), wait);
  }

  /** Sends the pending changes now (tests; the timer does it otherwise). */
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    this.lastFlush = Date.now();
    const keys = this.pending;
    this.pending = new Set();
    // A note's computed tables change with whatever they read.
    for (let grew = true; grew; ) {
      grew = false;
      for (const [path, t] of this.tablesCache) {
        const key = `tables:${path}`;
        if (keys.has(key)) continue;
        if ([...t.reads].some((r) => keys.has(r))) {
          this.tablesCache.delete(path);
          keys.add(key);
          grew = true;
        }
      }
    }
    for (const fn of [...this.listeners]) {
      try {
        fn(keys);
      } catch (e) {
        console.error('[links] a listener failed', e);
      }
    }
  }

  /** Resolves when nothing is loading (tests). */
  settled(): Promise<void> {
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }

  private async load<T>(run: () => Promise<T>): Promise<T> {
    this.inFlight++;
    try {
      return await run();
    } finally {
      if (--this.inFlight === 0) {
        const done = this.idle;
        this.idle = [];
        for (const r of done) r();
      }
    }
  }

  destroy(): void {
    this.offTree();
    if (this.timer !== null) clearTimeout(this.timer);
    for (const e of this.texts.values()) e.off?.();
    for (const e of this.sheets.values()) e.off?.();
    for (const l of this.live.values()) l.off();
    this.listeners.clear();
  }

  // ---------- resolving ----------

  /** A note a link target names, from the file at `from` (null: the vault's root), or null. */
  resolveNote(target: string, from: string | null): string | null {
    this.read('names');
    const t = target.trim().replace(/^\[\[(.*)\]\]$/, '$1').split('|')[0].trim();
    if (t === '') return null;
    const path = resolve(t, from ?? '', this.tree.links);
    return path && this.tree.byPath.get(path)?.kind === 'note' ? path : null;
  }

  /** A spreadsheet file a link target names (`Budget.sheet`, `Finance/Budget.sheet`), or null. */
  resolveSheet(target: string, from: string | null): string | null {
    this.read('names');
    const t = target.trim();
    if (t === '' || !/\.sheet$/i.test(t)) return null;
    const path = resolve(t, from ?? '', this.tree.links);
    return path && path.toLowerCase().endsWith('.sheet') && this.tree.byPath.has(path) ? path : null;
  }

  // ---------- notes ----------

  /** A note's metadata from the server's index (`GET /api/notes/query?path=`). */
  noteMeta(path: string): Loaded<QueriedNote> {
    this.read(`meta:${path}`);
    let e = this.metas.get(path);
    if (!e) {
      e = { status: 'loading', value: null, seen: null, loading: false };
      this.metas.set(path, e);
      this.fetchMeta(path, e);
    }
    return e;
  }

  private fetchMeta(path: string, e: Entry<QueriedNote>): void {
    if (e.loading) return;
    e.loading = true;
    const seen = stamp(this.tree.byPath.get(path));
    void this.load(() => this.host.queryNotes({ path, limit: 1 })).then(
      (r) => {
        e.loading = false;
        const note = r.notes[0] ?? null;
        this.settle(`meta:${path}`, e, note ? { status: 'ready', value: note } : { status: 'missing', value: null }, seen);
      },
      (err: unknown) => {
        e.loading = false;
        this.settle(`meta:${path}`, e, { status: 'error', value: e.value, message: errorText(err) }, seen);
      },
    );
  }

  /** A file's text: as typed when it is open on this device, else as saved. */
  text(path: string): Loaded<string> {
    this.read(`text:${path}`);
    let e = this.texts.get(path);
    if (!e) {
      e = { status: 'loading', value: null, seen: null, loading: false };
      this.texts.set(path, e);
      this.fetchText(path, e);
    }
    return e;
  }

  private fetchText(path: string, e: Entry<string>): void {
    const open = this.host.openDocument(path);
    const seen = stamp(this.tree.byPath.get(path));
    if (open) {
      if (!e.off) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = open.subscribe(() => {
          // As typed: read again a little later, so a burst of keys is one change.
          timer ??= setTimeout(() => {
            timer = null;
            this.settle(`text:${path}`, e, { status: 'ready', value: open.text() }, e.seen);
          }, THROTTLE_MS / 2);
        });
        e.off = () => {
          if (timer !== null) clearTimeout(timer);
          unsubscribe();
        };
      }
      this.settle(`text:${path}`, e, { status: 'ready', value: open.text() }, seen);
      return;
    }
    if (e.loading) return;
    e.loading = true;
    void this.load(() => this.host.readFile(path)).then(
      (text) => {
        e.loading = false;
        this.settle(`text:${path}`, e, { status: 'ready', value: text }, seen);
      },
      (err: unknown) => {
        e.loading = false;
        const missing = !this.tree.byPath.has(path);
        this.settle(`text:${path}`, e, missing ? { status: 'missing', value: null } : { status: 'error', value: e.value, message: errorText(err) }, seen);
      },
    );
  }

  /** A note's formulas, from its text. */
  formulas(path: string): Loaded<NoteFormulas> {
    const text = this.text(path);
    if (text.value === null) return { status: text.status, value: null, message: text.message };
    let cached = this.formulasCache.get(path);
    if (!cached || cached.text !== text.value) {
      cached = { text: text.value, value: noteFormulas(text.value) };
      this.formulasCache.set(path, cached);
    }
    return { status: 'ready', value: cached.value };
  }

  /**
   * A note's tables as its formulas compute them (item 39's engine), reading the sheets they refer
   * to through this store. Cached until the note's text or something it read changes.
   */
  tables(path: string, depth: number): Loaded<ComputedTable[]> {
    this.read(`tables:${path}`);
    // The engine loads while the text does.
    const computer = this.tableComputer();
    const formulas = this.formulas(path);
    if (!formulas.value) return { status: formulas.status, value: null, message: formulas.message };
    const text = this.texts.get(path)?.value ?? '';
    const cached = this.tablesCache.get(path);
    if (cached && cached.text === text) return cached.value;
    if (!computer) return { status: 'loading', value: null };
    if (formulas.value.off) {
      // Formulas off: the cells as typed.
      const value: Loaded<ComputedTable[]> = { status: 'ready', value: formulas.value.model.tables.map((t) => ({ name: t.name, rows: t.rows.map((r) => r.map((c) => (c.trim() === '' ? null : c))) })) };
      this.tablesCache.set(path, { text, value, reads: new Set([`text:${path}`]) });
      return value;
    }
    if (this.computing.has(path)) return { status: 'error', value: null, message: 'cycle' };
    const context = linkContext(() => path, depth);
    this.computing.add(path);
    let value: Loaded<ComputedTable[]>;
    try {
      value = { status: 'ready', value: this.track(context.reads, () => computer(formulas.value!.model, context)) };
    } catch (err) {
      value = { status: 'error', value: null, message: errorText(err) };
    } finally {
      this.computing.delete(path);
    }
    context.reads.add(`text:${path}`);
    this.tablesCache.set(path, { text, value, reads: context.reads });
    return value;
  }

  /** Whether a note's tables are being computed now (a NOTETABLE that reaches it again is a cycle). */
  isComputing(path: string): boolean {
    return this.computing.has(path);
  }

  private tableComputer(): TableComputer | null {
    if (this.computer) return this.computer;
    this.read('engine');
    if (!this.computerLoading) {
      this.computerLoading = true;
      void this.load(() => this.host.tableComputer()).then(
        (c) => {
          this.computer = c;
          this.changed('engine');
        },
        () => {
          // Retried at the next read (a chunk that failed to load: offline, a deploy).
          this.computerLoading = false;
        },
      );
    }
    return null;
  }

  // ---------- queries ----------

  /** The notes a filter matches (`GET /api/notes/query`), at most QUERY_LIMIT. */
  query(filter: NotesQueryFilter): Loaded<NotesQueryResponse> {
    const f = { ...filter, limit: filter.limit ?? QUERY_LIMIT };
    const key = `query:${json(f)}`;
    this.read(key);
    let e = this.queries.get(key);
    if (!e) {
      e = { status: 'loading', value: null, seen: null, loading: false, filter: f };
      this.queries.set(key, e);
      this.fetchQuery(key, e);
    }
    return e;
  }

  private fetchQuery(key: string, e: Entry<NotesQueryResponse> & { filter: NotesQueryFilter }): void {
    if (e.loading) return;
    e.loading = true;
    void this.load(() => this.host.queryNotes(e.filter)).then(
      (r) => {
        e.loading = false;
        this.settle(key, e, { status: 'ready', value: r }, null);
      },
      (err: unknown) => {
        e.loading = false;
        this.settle(key, e, { status: 'error', value: null, message: errorText(err) }, null);
      },
    );
  }

  // ---------- spreadsheets ----------

  /** A spreadsheet's model: its open workbook's, else its text's (as typed when open here, else as saved). */
  sheet(path: string): Loaded<SheetFile> {
    this.read(`sheet:${path}`);
    const live = this.live.get(path);
    if (live) return { status: 'ready', value: live.sheet.file() };
    let e = this.sheets.get(path);
    if (!e) {
      e = { status: 'loading', value: null, seen: null, loading: false };
      this.sheets.set(path, e);
      this.fetchSheet(path, e);
    }
    return e;
  }

  private fetchSheet(path: string, e: Entry<SheetFile>): void {
    const parsed = (text: string): Omit<Loaded<SheetFile>, 'seen'> => {
      const r = parseSheet(text);
      return r.ok ? { status: 'ready', value: r.file } : { status: 'error', value: null, message: r.error };
    };
    const open = this.host.openDocument(path);
    const seen = stamp(this.tree.byPath.get(path));
    if (open) {
      if (!e.off) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = open.subscribe(() => {
          timer ??= setTimeout(() => {
            timer = null;
            this.settle(`sheet:${path}`, e, parsed(open.text()), e.seen);
          }, THROTTLE_MS / 2);
        });
        e.off = () => {
          if (timer !== null) clearTimeout(timer);
          unsubscribe();
        };
      }
      this.settle(`sheet:${path}`, e, parsed(open.text()), seen);
      return;
    }
    if (e.loading) return;
    e.loading = true;
    void this.load(() => this.host.readFile(path)).then(
      (text) => {
        e.loading = false;
        this.settle(`sheet:${path}`, e, parsed(text), seen);
      },
      (err: unknown) => {
        e.loading = false;
        const missing = !this.tree.byPath.has(path);
        this.settle(`sheet:${path}`, e, missing ? { status: 'missing', value: null } : { status: 'error', value: e.value, message: errorText(err) }, seen);
      },
    );
  }

  /**
   * A workbook open on this device (DESIGN §6.21.4): formulas that read the sheet see its values as
   * they are, recalculated or edited, before they are saved. Returns what forgets it.
   */
  addLiveSheet(path: () => string, sheet: LiveSheet): () => void {
    let at = path();
    const entry = {
      sheet,
      off: sheet.subscribe(() => {
        const now = path();
        if (now !== at) {
          this.live.delete(at);
          this.changed(`sheet:${at}`);
          at = now;
          this.live.set(at, entry);
        }
        this.changed(`sheet:${at}`);
      }),
    };
    this.live.get(at)?.off();
    this.live.set(at, entry);
    this.changed(`sheet:${at}`);
    return () => {
      entry.off();
      if (this.live.get(at) === entry) {
        this.live.delete(at);
        this.changed(`sheet:${at}`);
      }
    };
  }

  // ---------- the dependency graph ----------

  /** Records that `from` read the tables of note `to` (a NOTETABLE whose note was computed, not written). */
  addEdge(from: string, to: string): void {
    const set = this.dynamicEdges.get(from) ?? new Set<string>();
    if (set.has(to)) return;
    set.add(to);
    this.dynamicEdges.set(from, set);
  }

  /**
   * The files whose computed values a file reads: a note's references to spreadsheets
   * (`Budget.sheet!B10`) and NOTETABLE calls, a spreadsheet's NOTETABLE calls. Null while loading.
   */
  edges(path: string): string[] | null {
    const out = new Set(this.dynamicEdges.get(path) ?? []);
    let formulas: readonly string[];
    if (path.toLowerCase().endsWith('.sheet')) {
      const sheet = this.sheet(path);
      if (sheet.status === 'loading') return null;
      formulas = sheet.value ? sheet.value.sheets.flatMap((s) => Object.values(s.cells).flatMap((c) => (c.f === undefined ? [] : [c.f]))) : [];
    } else {
      const f = this.formulas(path);
      if (f.status === 'loading') return null;
      formulas = f.value ? allFormulas(f.value) : [];
    }
    for (const formula of formulas) {
      for (const call of noteCalls(formula)) {
        const target = call.name === 'NOTETABLE' ? call.args[0] : null;
        const note = target ? this.resolveNote(target, path) : null;
        if (note) out.add(note);
      }
      for (const ref of externalRefs(formula)) {
        const file = fileSheet(ref.name);
        const sheet = file ? this.resolveSheet(file.file, path) : null;
        if (sheet) out.add(sheet);
      }
    }
    return [...out];
  }

  /** Whether `from`'s values depend, through any chain of files, on `to`'s (a cycle when `to` reads `from`). */
  reaches(from: string, to: string): boolean {
    const seen = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0 && seen.size <= 200) {
      const next = this.edges(queue.shift()!);
      for (const p of next ?? []) {
        if (p === to) return true;
        if (!seen.has(p)) {
          seen.add(p);
          queue.push(p);
        }
      }
    }
    return false;
  }

  // ---------- changes ----------

  /** Takes a load's result; tells subscribers when it differs from what they saw. */
  private settle<T>(key: string, e: Entry<T>, next: Loaded<T>, seen: string | null): void {
    const before = e.status === 'loading' ? undefined : json([e.status, e.value, e.message]);
    e.status = next.status;
    e.value = next.value;
    e.message = next.message;
    e.seen = seen;
    if (before !== json([e.status, e.value, e.message])) this.changed(key);
  }

  private treeChanged(): void {
    const before = this.tree;
    const after = this.host.tree();
    if (after === before) return;
    this.tree = after;
    let names = before.files.length !== after.files.length;
    let notesChanged = false;
    const changedPaths = new Set<string>();
    for (const f of after.files) {
      const old = before.byPath.get(f.path);
      if (!old) names = true;
      if (old !== f && stamp(old) !== stamp(f)) {
        changedPaths.add(f.path);
        if (f.kind === 'note') notesChanged = true;
      }
    }
    if (!names) for (const f of before.files) if (!after.byPath.has(f.path)) names = true;
    if (names) {
      notesChanged = true;
      for (const f of before.files) if (!after.byPath.has(f.path)) changedPaths.add(f.path);
      this.changed('names');
    }
    for (const path of changedPaths) {
      const meta = this.metas.get(path);
      if (meta && meta.seen !== stamp(after.byPath.get(path))) this.fetchMeta(path, meta);
      const text = this.texts.get(path);
      if (text && text.seen !== stamp(after.byPath.get(path))) this.fetchText(path, text);
      const sheet = this.sheets.get(path);
      if (sheet && !this.live.has(path) && sheet.seen !== stamp(after.byPath.get(path))) this.fetchSheet(path, sheet);
    }
    if (notesChanged) for (const [key, q] of this.queries) this.fetchQuery(key, q);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------- the page's store ----------

let store: LinkStore | null = null;
let hostFactory: () => LinkHost = appLinkHost;

/** The page's store: one vault per page (DESIGN §6.44), so one store. */
export function linkStore(): LinkStore {
  store ??= new LinkStore(hostFactory());
  return store;
}

/** Starts the page's store afresh over `host` (tests), or over the app again. */
export function resetLinkStore(host?: LinkHost): void {
  store?.destroy();
  store = null;
  hostFactory = host ? () => host : appLinkHost;
}
