// The endpoints that features call with `apiFetch` themselves rather than through `Endpoints`
// (tasks, calendar, flashcards, habits, properties, note queries, and the status of Ask your vault
// and reminders), answered in the page for the in-memory mock: the dev server with VITE_MOCK_API=1
// and the GitHub Pages demo (DESIGN §6.46). `window.fetch` is wrapped for same-origin `/api/` paths
// only; every other request goes to the network unchanged. An endpoint the mock does not have
// answers `404 not-found`, as a server without the feature would.
import { ApiError } from '../client';
import type { Problem, PropertyType } from '../types';
import { aiStatus, datedNotes, habits, MockFlashcards, MockProperties, queryNotes, remindersStatus } from './features';
import { fail } from './problems';
import { MockTasks } from './tasks';
import type { MockVault } from './vault';

export interface MockRequest {
  method: string;
  /** The path after `/api`, such as `/tasks/lists`. */
  path: string;
  params: URLSearchParams;
  body: unknown;
  /** `X-Client-Id`: the origin of the change, whose own events are not echoed. */
  origin: string | null;
}

export interface MockResponse {
  status: number;
  body: unknown;
}

type Handler = (req: MockRequest, match: string[]) => unknown;

/** The routing table over a vault; `handle` answers one request (also used by the tests). */
export function createMockServer(vault: MockVault): (req: MockRequest) => MockResponse {
  const tasks = new MockTasks(vault);
  const flashcards = new MockFlashcards(vault);
  const properties = new MockProperties(vault);
  const created = (body: unknown): MockResponse => ({ status: 201, body });
  const routes: Array<[string, RegExp, Handler]> = [
    ['GET', /^\/tasks\/lists$/, () => tasks.lists()],
    ['POST', /^\/tasks\/lists$/, (r) => created(tasks.createList(r.body as never, r.origin))],
    ['POST', /^\/tasks\/lists\/reorder$/, (r) => tasks.reorderLists(r.body as never, r.origin)],
    ['PATCH', /^\/tasks\/lists\/([^/]+)$/, (r, [id]) => tasks.updateList(id, r.body as never, r.origin)],
    [
      'DELETE',
      /^\/tasks\/lists\/([^/]+)$/,
      (r, [id]) => {
        const list = tasks.lists().lists.find((l) => l.id === id) ?? fail('not-found', 'No such list');
        return { lists: [], files: [], createdFolders: [], moved: null, trash: vault.deleteFile(list.path, r.origin) };
      },
    ],
    ['POST', /^\/tasks\/lists\/([^/]+)\/sections$/, (r, [id]) => created(tasks.addSection(id, r.body as never, r.origin))],
    ['POST', /^\/tasks\/lists\/([^/]+)\/sections\/reorder$/, (r, [id]) => tasks.reorderSections(id, r.body as never, r.origin)],
    ['PATCH', /^\/tasks\/lists\/([^/]+)\/sections\/([^/]+)$/, (r, [id, s]) => tasks.renameSection(id, s, r.body as never, r.origin)],
    ['DELETE', /^\/tasks\/lists\/([^/]+)\/sections\/([^/]+)$/, (r, [id, s]) => tasks.deleteSection(id, s, r.origin)],
    ['GET', /^\/tasks$/, (r) => tasks.query(r.params)],
    ['POST', /^\/tasks$/, (r) => created(tasks.create(r.body as never, r.origin))],
    ['POST', /^\/tasks\/reorder$/, (r) => tasks.reorder(r.body as never, r.origin)],
    ['GET', /^\/tasks\/([^/]+)$/, (_r, [id]) => tasks.get(id)],
    ['PATCH', /^\/tasks\/([^/]+)$/, (r, [id]) => tasks.update(id, r.body as never, r.origin)],
    ['DELETE', /^\/tasks\/([^/]+)$/, (r, [id]) => tasks.remove(id, r.origin)],
    ['POST', /^\/tasks\/([^/]+)\/complete$/, (r, [id]) => tasks.complete(id, (r.body ?? undefined) as never, r.origin)],
    ['POST', /^\/tasks\/([^/]+)\/uncomplete$/, (r, [id]) => tasks.uncomplete(id, r.origin)],
    ['GET', /^\/notes\/by-date$/, (r) => datedNotes(vault, r.params)],
    ['GET', /^\/notes\/query$/, (r) => queryNotes(vault, r.params)],
    ['GET', /^\/flashcards$/, () => flashcards.state()],
    ['GET', /^\/flashcards\/notes$/, () => flashcards.notes()],
    ['POST', /^\/flashcards\/reviews$/, (r) => flashcards.review((r.body as { reviews: never }).reviews)],
    ['POST', /^\/flashcards\/undo$/, (r) => flashcards.undo(r.body as never)],
    ['POST', /^\/flashcards\/prune$/, (r) => flashcards.prune((r.body as { cards: string[] }).cards)],
    ['PUT', /^\/flashcards\/config$/, (r) => flashcards.setConfig(r.body as never)],
    ['GET', /^\/habits$/, () => habits(vault)],
    ['GET', /^\/properties$/, () => properties.list()],
    ['GET', /^\/properties\/values$/, (r) => properties.values(r.params.get('name') ?? '')],
    ['GET', /^\/properties\/types$/, () => properties.getTypes()],
    [
      'PUT',
      /^\/properties\/types$/,
      (r) => {
        const b = r.body as { name: string; type: PropertyType | null };
        return properties.setType(b.name, b.type);
      },
    ],
    ['POST', /^\/properties\/rename$/, (r) => properties.rename(r.body as never, r.origin)],
    ['GET', /^\/ai\/status$/, () => aiStatus()],
    ['GET', /^\/reminders\/status$/, () => remindersStatus()],
    ['PUT', /^\/reminders\/zone$/, () => ({ status: 204, body: null })],
    // Reminders are delivered by the server: a test reaches no route, and snoozing or finishing a
    // reminder changes nothing (the task itself is changed through the task API).
    ['POST', /^\/reminders\/test$/, () => ({ sent: false, error: 'Reminders are sent by the NotesApp server; the in-memory mock has none' })],
    ['POST', /^\/reminders\/(snooze|done)$/, () => ({ changed: false, until: null })],
    ['POST', /^\/push\/(key|subscriptions)$/, () => fail('bad-request', 'Web Push needs the NotesApp server')],
    ['DELETE', /^\/push\/subscriptions\/([^/]+)$/, () => fail('not-found', 'No such device')],
  ];

  return (req) => {
    try {
      for (const [method, pattern, handler] of routes) {
        if (method !== req.method) continue;
        const m = pattern.exec(req.path);
        if (!m) continue;
        const out = handler(req, m.slice(1).map(decodeURIComponent));
        return isResponse(out) ? out : { status: 200, body: out };
      }
      return fail('not-found', 'This needs the NotesApp server; the in-memory mock does not have it');
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: e.problem };
      const problem: Problem = { type: 'urn:notesapp:problem:internal-error', title: 'Internal error', status: 500, code: 'internal-error', detail: String(e), incidentId: 'mock' };
      console.error('[notesapp] mock server', e);
      return { status: 500, body: problem };
    }
  };
}

function isResponse(x: unknown): x is MockResponse {
  return typeof x === 'object' && x !== null && 'status' in x && 'body' in x && Object.keys(x).length === 2;
}

function bodyOf(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string' || init.body === '') return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}

/** Wraps `window.fetch` so same-origin `/api/` requests are answered by `createMockServer`; `record` sees each answer. */
export function installMockServer(vault: MockVault, record?: (r: { method: string; path: string; status: number }) => void): void {
  const handle = createMockServer(vault);
  const native = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return native(input, init);
    const headers = new Headers(init?.headers);
    // The server's answers take a moment; a little latency keeps the app's loading states honest.
    await new Promise((r) => setTimeout(r, 15));
    const method = (init?.method ?? 'GET').toUpperCase();
    const res = handle({ method, path: url.pathname.slice('/api'.length), params: url.searchParams, body: bodyOf(init), origin: headers.get('X-Client-Id') });
    record?.({ method, path: url.pathname, status: res.status });
    if (res.status === 204) return new Response(null, { status: 204 });
    const problem = res.status >= 400;
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': problem ? 'application/problem+json' : 'application/json' },
    });
  };
}
