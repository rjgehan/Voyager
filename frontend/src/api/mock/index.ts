// In-memory implementation of `Endpoints` for VITE_MOCK_API=1 (dev only) and the GitHub Pages demo
// (DESIGN §6.46), loaded with a dynamic import. Adds network-like latency, blob URLs for raw files,
// and `window.notesMock` helpers to simulate another device: external edits, deletes, moves,
// dropped connections and failures.
import { clientId } from '../../state/clientId';
import { ApiError, TransientError } from '../client';
import { installEndpoints, type Endpoints } from '../endpoints';
import type { FileEntry, Problem } from '../types';
import { mockCapture } from './capture';
import type { SeedFile } from './seed';
import { installMockServer } from './server';
import { mimeOf, MockVault } from './vault';

type FailureKind = 'network' | '502' | 'busy' | 'io-error';

export interface MockControls {
  vault: MockVault;
  /** Latency added to every call, in ms. */
  latency: number;
  failNext(count: number, kind?: FailureKind): void;
  externalEdit(path: string, content: string): void;
  externalDelete(path: string): void;
  /** Moves a file as another device would (with link updates). */
  otherDeviceMove(from: string, to: string): void;
  dropConnections(): void;
  setServerBuild(sha: string): void;
  /** The latest answers (at most 500): endpoint calls and the features' own requests, with their status. */
  readonly requests: readonly MockRequestRecord[];
}

/** One answer of the mock: `call` and the function's name for `Endpoints`, else the HTTP method and path. */
export interface MockRequestRecord {
  method: string;
  path: string;
  status: number;
}

/** Records how each endpoint call ended: 200, or the problem's or transient failure's status. */
function logged(endpoints: Endpoints, record: (r: MockRequestRecord) => void): Endpoints {
  const out: Record<string, unknown> = { ...endpoints };
  for (const [name, fn] of Object.entries(endpoints)) {
    if (typeof fn !== 'function') continue;
    out[name] = (...args: unknown[]) => {
      const result: unknown = (fn as (...a: unknown[]) => unknown)(...args);
      if (result instanceof Promise) {
        result.then(
          () => record({ method: 'call', path: name, status: 200 }),
          (e: unknown) => record({ method: 'call', path: name, status: e instanceof ApiError ? e.status : e instanceof TransientError ? (e.status ?? 0) : 500 }),
        );
      }
      return result;
    };
  }
  return out as unknown as Endpoints;
}

export function createMockEndpoints(vault: MockVault, controls: { latency: number; failures: FailureKind[] }): Endpoints {
  const urls = new Map<string, string>();

  async function call<T>(run: () => T | Promise<T>): Promise<T> {
    await new Promise((r) => setTimeout(r, controls.latency * (0.6 + Math.random() * 0.8)));
    const failure = controls.failures.shift();
    if (failure === 'network') throw new TransientError('Failed to fetch');
    if (failure === '502') throw new TransientError('HTTP 502', 502);
    if (failure === 'busy') throw new TransientError('Server busy', 503, 1000);
    if (failure === 'io-error') {
      const problem: Problem = { type: 'urn:notesapp:problem:io-error', title: 'Storage error', status: 500, code: 'io-error', detail: 'Simulated storage error', incidentId: 'mock' };
      throw new ApiError(problem);
    }
    // Deep-copy results so callers can never mutate the mock's state by reference.
    return structuredClone(await run());
  }

  function blobUrl(key: string, bytes: Uint8Array | null, path: string): string {
    if (!bytes) return 'data:,';
    const cached = urls.get(key);
    if (cached) return cached;
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mimeOf(path) }));
    urls.set(key, url);
    return url;
  }

  return {
    getMe: () => call(() => ({ login: 'owner@notes', name: 'Owner', profilePicUrl: null, source: 'default' as const })),
    getStatus: () => call(() => vault.getStatus()),
    getStatusDetails: () => call(() => vault.getStatusDetails()),
    sendTestAlert: () => call(() => vault.sendTestAlert()),
    getSettings: () => call(() => vault.getSettings()),
    putSettings: (req) => call(() => vault.putSettings(req, clientId)),
    getTree: () => call(() => vault.getTree()),
    readFile: (path) => call(() => vault.readFile(path)),
    createFile: (req, opts) => call(() => vault.createFile(req, clientId, opts?.idempotencyKey)),
    saveFile: (path, req) => call(() => vault.saveFile(path, req, clientId)),
    deleteFile: (path) => call(() => vault.deleteFile(path, clientId)),
    uploadRaw: (path, body, onConflict, opts) => call(() => vault.uploadRaw(path, body, onConflict, clientId, opts?.idempotencyKey)),
    uploadAttachment: (name, source, body, opts) =>
      call(() => vault.uploadAttachment(name, source, body, clientId, opts?.idempotencyKey)),
    createFolder: (path) => call(() => vault.createFolder(path, clientId)),
    capture: (req) => call(() => mockCapture(vault, req, null, clientId)),
    captureFile: (name, body, params) =>
      call(async () => {
        const source = params.target === 'daily' ? null : 'Inbox.md';
        const attachment = await vault.uploadAttachment(name, source, body, clientId);
        return mockCapture(vault, { ...params, url: null, title: null }, attachment, clientId);
      }),
    deleteFolder: (path) => call(() => vault.deleteFolder(path, clientId)),
    move: (req) => call(() => vault.move(req, clientId)),
    getNoteMeta: (path) => call(() => vault.getNoteMeta(path)),
    queryNotes: (filter) => call(() => vault.queryNotes(filter)),
    getBacklinks: (path, unlinked) => call(() => vault.getBacklinks(path, unlinked)),
    resolveLinks: (req) => call(() => ({ resolved: vault.resolveTargets(req.source, req.targets) })),
    search: (q, opts = {}) => call(() => vault.search(q, opts.limit, opts.sort, opts.prefix ?? false)),
    getTags: () => call(() => ({ tags: vault.getTags() })),
    getGraph: (since) => call(() => vault.getGraph(since)),
    getCompat: () => call(() => vault.getCompat()),
    listTrash: () => call(() => ({ entries: vault.listTrash() })),
    restoreTrash: (id, req) => call(() => vault.restoreTrash(id, req, clientId)),
    purgeTrashEntry: (id) => call(() => void vault.purgeTrash(id, clientId)),
    emptyTrash: () => call(() => ({ purged: vault.purgeTrash(null, clientId) })),
    getHistory: (path, opts = {}) => call(() => vault.getHistory(path, opts.limit, opts.offset)),
    getHistoryContent: (path, commit) => call(() => vault.getHistoryContent(path, commit)),
    restoreHistory: (req) => call(() => vault.restoreHistory(req, clientId)),
    commitHistory: () => call(() => vault.commitNow()),
    pushMirror: () => call(() => vault.pushMirror()),
    getHistoryLog: (f, opts = {}) => call(() => vault.getHistoryLog(f, opts.limit, opts.offset)),
    getHistoryChanges: (f) => call(() => vault.getHistoryChanges(f)),
    getDeletedFiles: (q, opts = {}) => call(() => vault.getDeletedFiles(q, opts.limit, opts.offset)),
    getTemplates: () => call(() => vault.getTemplates()),
    getBookmarks: () => call(() => vault.getBookmarks()),
    putBookmarks: (req) => call(() => vault.putBookmarks(req, clientId)),
    renameHeading: (req) => call(() => vault.renameHeading(req, clientId)),
    addBlockId: (req) => call(() => vault.addBlockId(req, clientId)),
    getPublish: () => call(() => vault.getPublish()),
    publishNote: (req) => call(() => vault.publishNote(req)),
    unpublishNote: (path) => call(() => vault.unpublishNote(path)),
    // One vault in the mock (DESIGN §6.44): nothing to switch to.
    listVaults: () => call(() => ({ vaults: [{ name: 'main', isDefault: true, state: 'ready' as const, url: '/' }], canCreate: false })),
    createVault: () =>
      call(() => {
        throw new ApiError({ type: 'urn:notesapp:problem:vaults-off', title: 'Creating vaults is off', status: 409, detail: 'The mock has one vault', code: 'vaults-off' });
      }),
    getTranscriptionStatus: () => call(() => vault.getTranscriptionStatus()),
    transcribe: (path) => call(() => vault.transcribe(path)),
    rawUrl: (entry: Pick<FileEntry, 'path' | 'size' | 'mtime'>) =>
      blobUrl(`file:${entry.path}:${entry.size}:${entry.mtime}`, vault.rawBytes(entry.path), entry.path),
    trashRawUrl: (id) => {
      const item = vault.trashBytes(id);
      return item ? blobUrl(`trash:${id}`, item.bytes, item.path) : 'data:,';
    },
    historyRawUrl: (path, commit) => blobUrl(`history:${commit}:${path}`, vault.historyBytes(path, commit), path),
    openEvents: (id, lastEventId) => vault.hub.connect(id, lastEventId),
  };
}

declare global {
  interface Window {
    notesMock?: MockControls;
  }
}

export interface MockOptions {
  /** The vault's files: the dev seed (seed.ts) by default. */
  seed?: readonly SeedFile[];
  /** Latency added to every call, in ms (60 by default). */
  latency?: number;
}

export function installMockApi(options: MockOptions = {}): MockControls {
  const vault = new MockVault(options.seed ?? true);
  const state = { latency: options.latency ?? 60, failures: [] as FailureKind[] };
  const requests: MockRequestRecord[] = [];
  const record = (r: MockRequestRecord) => {
    requests.push(r);
    if (requests.length > 500) requests.shift();
  };
  installEndpoints(logged(createMockEndpoints(vault, state), record));
  // The endpoints the features keep beside themselves (tasks, flashcards, habits, calendar, ...).
  installMockServer(vault, record);
  const controls: MockControls = {
    vault,
    requests,
    get latency() {
      return state.latency;
    },
    set latency(ms: number) {
      state.latency = ms;
    },
    failNext(count, kind = 'network') {
      for (let i = 0; i < count; i++) state.failures.push(kind);
    },
    externalEdit: (path, content) => vault.externalWrite(path, content),
    externalDelete: (path) => vault.externalDelete(path),
    otherDeviceMove: (from, to) => void vault.move({ from, to }, 'other-device-0001'),
    dropConnections: () => vault.hub.dropAll(),
    setServerBuild: (sha) => {
      vault.hub.buildSha = sha;
    },
  };
  window.notesMock = controls;
  console.info('[notesapp] Using the in-memory mock API. Try window.notesMock.externalEdit("Welcome.md", "# Hi")');
  return controls;
}
