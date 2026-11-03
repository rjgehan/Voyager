/**
 * A thin client for the Voyager API (docs/API.md), used to arrange state quickly so UI tests
 * click only through the part they are about, and by the API specs themselves.
 *
 * Plain, erasable TypeScript, so `node scripts/seed.ts` runs it as well as Playwright does.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What the last `npm run reset` wrote: which mode it started and where. */
const runEnvFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.run', 'env.json');
const runEnv: { apiUrl?: string; webUrl?: string; login?: string; mode?: string } = existsSync(runEnvFile)
  ? JSON.parse(readFileSync(runEnvFile, 'utf8'))
  : {};

export const API_URL = process.env.API_URL ?? runEnv.apiUrl ?? 'http://127.0.0.1:18570';
export const WEB_URL = process.env.WEB_URL ?? runEnv.webUrl ?? 'http://localhost:5153';
export const MODE = process.env.E2E_MODE ?? runEnv.mode ?? 'dev';
/** A Tailscale login the server's identity allowlist admits (scripts/reset.mjs). */
export const ALLOWED_LOGIN = runEnv.login ?? 'e2e-owner@example.test';

/** One client id for this process, as a page has one per load (API.md §2). */
export const CLIENT_ID = `e2e-${randomUUID()}`;

export class ApiError extends Error {
  status: number;
  body: string;
  code: string | undefined;
  problem: any;
  constructor(status: number, body: string, method: string, path: string) {
    super(`${method} ${path} → ${status} ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    try {
      this.problem = JSON.parse(body);
      this.code = this.problem?.code;
    } catch {
      this.problem = null;
    }
  }
}

export type Json = any;

export interface CallOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** An extra vault's name: the call goes to /api/v/<name>/… (API.md §41). */
  vault?: string;
  /** Send this exact body (bytes or text) instead of JSON. */
  raw?: Uint8Array | string;
}

/** `/api/x` in the default vault, `/api/v/<name>/x` in an extra one. */
export function apiPath(path: string, vault?: string) {
  return vault ? path.replace(/^\/api\//, `/api/v/${vault}/`) : path;
}

export async function call(method: string, path: string, opts: CallOptions = {}): Promise<Json> {
  const url = API_URL + apiPath(path, opts.vault);
  const res = await fetch(url, {
    method,
    headers: {
      'x-client-id': CLIENT_ID,
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    body: opts.raw !== undefined ? (opts.raw as BodyInit) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, text, method, path);
  const type = res.headers.get('content-type') ?? '';
  return text && type.includes('json') ? JSON.parse(text) : text || null;
}

/** The refusal a call ends with: `{status, code}`, or `{status: 200}` for any success. */
export async function refusal(method: string, path: string, opts: CallOptions = {}) {
  try {
    await call(method, path, opts);
    return { status: 200, code: undefined as string | undefined, problem: null as any };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, code: e.code, problem: e.problem };
    throw e;
  }
}

/**
 * A request with full control of the headers, Host included (fetch would not send another Host).
 * Used by the security specs.
 */
export function rawRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string; json: any }> {
  const u = new URL(API_URL);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: u.hostname, port: Number(u.port), path, method, headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json: any = null;
          try {
            json = JSON.parse(data);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data, json });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let counter = 0;
/** A name no other test or run uses: "Prefix k3x9a1". Valid as a file or folder name. */
export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Query-string encoding for a vault path (API.md §1.3: `+` must be %2B). */
export const q = (path: string) => encodeURIComponent(path);

// --- Files -----------------------------------------------------------------------------------

export interface FileEntry {
  path: string;
  name: string;
  basename: string;
  extension: string;
  kind: string;
  size: number;
  mtime: string;
  version: string | null;
  aliases: string[];
}

export const tree = (vault?: string): Promise<{ eventId: string; folders: { path: string }[]; files: FileEntry[] }> =>
  call('GET', '/api/tree', { vault });

export const readFile = (path: string, vault?: string): Promise<{ path: string; content: string; version: string; kind: string }> =>
  call('GET', `/api/files?path=${q(path)}`, { vault });

export const createFile = (
  path: string,
  content = '',
  { vault, onConflict = 'fail' }: { vault?: string; onConflict?: 'fail' | 'rename' } = {},
): Promise<{ file: FileEntry; created: boolean; createdFolders: string[] }> =>
  call('POST', '/api/files', { body: { path, content, onConflict }, vault });

export const saveFile = (
  path: string,
  content: string,
  baseVersion: string | null,
  { vault, flushHistory }: { vault?: string; flushHistory?: boolean } = {},
): Promise<{ file: FileEntry; created: boolean }> =>
  call('PUT', `/api/files?path=${q(path)}`, { body: { content, baseVersion, ...(flushHistory ? { flushHistory } : {}) }, vault });

/** Reads the file, applies `edit` to its text and saves it with the version it read. */
export async function editFile(path: string, edit: (text: string) => string, vault?: string) {
  const f = await readFile(path, vault);
  return saveFile(path, edit(f.content), f.version, { vault });
}

export const trashFile = (path: string, vault?: string) => call('DELETE', `/api/files?path=${q(path)}`, { vault });

export const move = (from: string, to: string, { updateLinks = true, dryRun = false, vault }: { updateLinks?: boolean; dryRun?: boolean; vault?: string } = {}) =>
  call('POST', '/api/move', { body: { from, to, updateLinks, dryRun }, vault });

export const createFolder = (path: string, vault?: string) => call('POST', '/api/folders', { body: { path }, vault });

/** Uploads bytes to a path (API.md §9.2), creating or replacing the file. */
export const uploadRaw = (path: string, bytes: Uint8Array, contentType = 'application/octet-stream', vault?: string) =>
  call('PUT', `/api/files/raw?path=${q(path)}&onConflict=overwrite`, { raw: bytes, headers: { 'content-type': contentType }, vault });

/** Commits the pending history batch now (API.md §14.5), so history tests need not wait. */
export const commitNow = (vault?: string): Promise<{ commitId: string | null }> => call('POST', '/api/history/commit', { vault });

export const search = (query: string, extra = '', vault?: string) => call('GET', `/api/search?q=${encodeURIComponent(query)}${extra}`, { vault });

export const backlinks = (path: string, vault?: string) => call('GET', `/api/notes/backlinks?path=${q(path)}`, { vault });

// --- Tasks (API.md §20) ----------------------------------------------------------------------

export const newList = (name: string, extra: { color?: string; icon?: string } = {}, vault?: string) =>
  call('POST', '/api/tasks/lists', { body: { name, ...extra }, vault }).then((r) => r.lists[0]);

export const newTask = (fields: Record<string, unknown> & { title: string }, vault?: string) =>
  call('POST', '/api/tasks', { body: fields, vault }).then((r) => r.task);

export const newSection = (listId: string, name: string, vault?: string) =>
  call('POST', `/api/tasks/lists/${listId}/sections`, { body: { name }, vault }).then(
    (r) => r.lists[0].sections.find((s: any) => s.name === name),
  );

// --- Dates -----------------------------------------------------------------------------------

/** A local calendar day, `YYYY-MM-DD`, `offset` days from today. */
export function day(offset = 0, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Waits until a condition on the API holds, for checks after something saved in the background. */
export async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeout = 10_000): Promise<T> {
  const until = Date.now() + timeout;
  let last: T = await fn();
  while (!ok(last)) {
    if (Date.now() > until) throw new Error(`Condition not met within ${timeout} ms; last value: ${JSON.stringify(last)?.slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, 200));
    last = await fn();
  }
  return last;
}
