// The guest page's API (API.md §42.5–42.10, DESIGN §6.48): every request names the share's key in
// its path, `/api/s/<key>/…`, and goes through the owner's `apiFetch` (client id, problem
// handling, transient errors). An extra vault's share lives under `/v/<name>/s/<key>`, so
// `apiUrl` turns these paths into `/api/v/<name>/s/<key>/…` as it does for the owner's app.
import { apiFetch, query } from '../api/client';
import type { EventSourceLike, SaveOptions } from '../api/endpoints';
import type {
  CreateFileRequest,
  FileEntry,
  GuestLandingResponse,
  GuestShareResponse,
  SaveFileRequest,
  TextFile,
  WriteResult,
} from '../api/types';
import { appPathname, apiUrl } from '../state/vault';

/** Where the guest page is: the landing page, or a share (and a note of a folder share). */
export type GuestRoute = { kind: 'landing' } | { kind: 'share'; key: string; path: string | null } | { kind: 'unknown' };

/** Ids are 12 of a-z 0-9; links are 43 base64url characters (DESIGN §5.40). */
const KEY = /^(?:[a-z0-9]{12}|[A-Za-z0-9_-]{43})$/;

export function isShareKey(key: string): boolean {
  return KEY.test(key);
}

/** The route of an address of the guest page (`/s`, `/s/<key>`, `/s/<key>?path=…`, under `/v/<name>` too). */
export function parseGuestRoute(pathname: string, search: string): GuestRoute {
  const local = appPathname(pathname).replace(/\/+$/, '') || '/';
  if (local === '/s') return { kind: 'landing' };
  const m = /^\/s\/([^/]+)$/.exec(local);
  if (!m) return { kind: 'unknown' };
  let key: string;
  try {
    key = decodeURIComponent(m[1]);
  } catch {
    return { kind: 'unknown' };
  }
  if (!isShareKey(key)) return { kind: 'unknown' };
  const path = new URLSearchParams(search).get('path');
  return { kind: 'share', key, path: path && path.length > 0 ? path : null };
}

/** The page address of a share, or of one of its notes. */
export function guestHref(base: string, key: string, path: string | null): string {
  return `${base}/s/${encodeURIComponent(key)}` + (path ? '?path=' + encodeURIComponent(path) : '');
}

function shareApi(key: string): string {
  return `/api/s/${encodeURIComponent(key)}`;
}

export interface GuestApi {
  readonly key: string;
  share(): Promise<GuestShareResponse>;
  readFile(path: string): Promise<TextFile>;
  saveFile(path: string, req: SaveFileRequest, opts?: SaveOptions): Promise<WriteResult>;
  createFile(req: CreateFileRequest, opts?: { idempotencyKey?: string }): Promise<WriteResult>;
  /** Content-addressed like the owner's raw URLs (API.md §9.1), so images can be cached. */
  rawUrl(entry: Pick<FileEntry, 'path' | 'size' | 'mtime'>, opts?: { download?: boolean }): string;
  openEvents(clientId: string, lastEventId: string | null): EventSourceLike;
}

export function guestApi(key: string): GuestApi {
  const base = shareApi(key);
  return {
    key,
    share: () => apiFetch(base),
    readFile: (path) => apiFetch(base + '/files' + query({ path })),
    saveFile: (path, req, opts) => apiFetch(base + '/files' + query({ path }), { method: 'PUT', json: req, keepalive: opts?.keepalive }),
    createFile: (req, opts) => apiFetch(base + '/files', { method: 'POST', json: req, idempotencyKey: opts?.idempotencyKey }),
    rawUrl: (entry, opts) =>
      apiUrl(base + '/files/raw') +
      query({ path: entry.path, v: `${entry.size}-${Date.parse(entry.mtime)}`, download: opts?.download ? 'true' : undefined }),
    openEvents: (clientId, lastEventId) =>
      new EventSource(apiUrl(base + '/events' + query({ clientId, lastEventId: lastEventId ?? undefined }))) as EventSourceLike,
  };
}

/** The shares naming this login (API.md §42.5). */
export function fetchLanding(): Promise<GuestLandingResponse> {
  return apiFetch('/api/s');
}
