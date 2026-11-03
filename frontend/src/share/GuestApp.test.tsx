import { EditorView } from '@codemirror/view';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, GuestShareResponse } from '../api/types';
import { GuestApp } from './GuestApp';

const ID = 'k2v8q4m1x7ab';

function entry(path: string, kind: FileEntry['kind'] = 'note'): FileEntry {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return { path, name, basename: name.slice(0, dot), extension: name.slice(dot + 1), kind, size: 12, mtime: '2026-11-02T10:00:00.000Z', version: kind === 'note' ? 'v1' : null, aliases: [] };
}

function share(overrides: Partial<GuestShareResponse> = {}): GuestShareResponse {
  return {
    id: ID,
    kind: 'note',
    path: 'Family/Groceries.md',
    title: 'Groceries',
    mode: 'edit',
    sharedBy: 'Rob',
    expiresAt: null,
    eventId: 'boot.1',
    folders: [],
    files: [entry('Family/Groceries.md')],
    embedded: [],
    login: 'mom@example.com',
    ...overrides,
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': status < 400 ? 'application/json' : 'application/problem+json', ...headers } });
}

function problem(code: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ type: `urn:notesapp:problem:${code}`, title: code, status, code, detail: code, ...extra }, status);
}

/** The guest API, answered by `route` (method and path with query). */
function serve(route: (method: string, url: string, body: unknown) => Response | undefined) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    return route(method, url, body) ?? problem('not-found', 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

class QuietEventSource {
  static instances: QuietEventSource[] = [];
  readyState = 0;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    QuietEventSource.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = 2;
  }
}

function at(path: string) {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  QuietEventSource.instances = [];
  vi.stubGlobal('EventSource', QuietEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  at('/');
});

describe('the landing page', () => {
  it('lists what is shared with this login, in every vault', async () => {
    at('/s');
    serve((_method, url) =>
      url === '/api/s'
        ? json({
            login: 'mom@example.com',
            name: 'Mom',
            shares: [
              { vault: null, id: ID, kind: 'note', title: 'Groceries', mode: 'edit', sharedBy: 'Rob', url: `/s/${ID}` },
              { vault: 'work', id: 'abcdefabcdef', kind: 'folder', title: 'Trips', mode: 'read', sharedBy: 'Rob', url: '/v/work/s/abcdefabcdef' },
            ],
          })
        : undefined,
    );
    render(<GuestApp />);
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Groceries/ })).toHaveAttribute('href', `/s/${ID}`);
    expect(screen.getByRole('link', { name: /Trips/ })).toHaveAttribute('href', '/v/work/s/abcdefabcdef');
    expect(screen.getByText('Can edit')).toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.getByText(/Signed in as mom@example.com/)).toBeInTheDocument();
  });

  it('says when nothing is shared, and with which login', async () => {
    at('/s');
    serve((_method, url) => (url === '/api/s' ? json({ login: 'aunt@example.com', name: 'Aunt', shares: [] }) : undefined));
    render(<GuestApp />);
    expect(await screen.findByText(/Nothing is shared with/)).toHaveTextContent('aunt@example.com');
  });
});

describe('a shared note', () => {
  it('opens in Live Preview with who shared it, and saves through the share', async () => {
    at(`/s/${ID}`);
    const fetchMock = serve((method, url, body) => {
      if (url === `/api/s/${ID}`) return json(share());
      if (method === 'GET' && url === `/api/s/${ID}/files?path=Family%2FGroceries.md`)
        return json({ path: 'Family/Groceries.md', kind: 'note', content: '- [ ] milk\n', version: 'v1', size: 11, mtime: '2026-11-02T10:00:00.000Z', lossy: false });
      if (method === 'PUT' && url === `/api/s/${ID}/files?path=Family%2FGroceries.md`) {
        expect(body).toMatchObject({ baseVersion: 'v1' });
        return json({ file: { ...entry('Family/Groceries.md'), version: 'v2' }, created: false, createdFolders: [] });
      }
      return undefined;
    });
    const { container } = render(<GuestApp />);
    // The share's view is a lazy chunk (the editor): its first render takes a moment in tests.
    expect(await screen.findByText('Shared by Rob', { exact: false }, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText('Can edit')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.cm-content')?.textContent).toContain('milk'));
    expect(container.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'true');
    expect(document.title).toBe('Groceries · Shared · Voyager');
    // The share's own event stream, never the owner's.
    await waitFor(() => expect(QuietEventSource.instances.map((s) => s.url.split('?')[0])).toEqual([`/api/s/${ID}/events`]));
    // An edit autosaves through the share's endpoint.
    const view = EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement);
    expect(view).not.toBeNull();
    view!.dispatch({ changes: { from: view!.state.doc.length, insert: '- [ ] eggs\n' }, userEvent: 'input.type' });
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true), { timeout: 4000 });
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith(`/api/s/${ID}`))).toBe(true);
  });

  it('is read-only in a view share', async () => {
    at(`/s/${ID}`);
    serve((_method, url) => {
      if (url === `/api/s/${ID}`) return json(share({ mode: 'read' }));
      if (url.startsWith(`/api/s/${ID}/files?`)) return json({ path: 'Family/Groceries.md', kind: 'note', content: '- [ ] milk\n', version: 'v1', size: 11, mtime: '2026-11-02T10:00:00.000Z', lossy: false });
      return undefined;
    });
    const { container } = render(<GuestApp />);
    expect(await screen.findByText('View only', undefined, { timeout: 8000 })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.cm-content')?.textContent).toContain('milk'));
    expect(container.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'false');
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('says when the share has ended or is not for this login', async () => {
    at(`/s/${ID}`);
    serve(() => problem('share-not-found', 404));
    render(<GuestApp />);
    expect(await screen.findByText('This share is not available', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See what is shared with you' })).toHaveAttribute('href', '/s');
    expect(QuietEventSource.instances).toEqual([]);
  });

  it('says when to try again after too many attempts', async () => {
    at(`/s/${ID}`);
    serve(() => problem('too-many-attempts', 429, { retryAfter: 600 }));
    render(<GuestApp />);
    expect(await screen.findByText('Too many attempts', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText(/in 10 minutes/)).toBeInTheDocument();
  });

  it('refuses addresses that are not share keys without asking the server', async () => {
    at('/s/../../api/tree');
    const fetchMock = serve(() => undefined);
    render(<GuestApp />);
    expect(await screen.findByText('Not a share address')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a shared folder', () => {
  it('lists its files and opens a note from the list', async () => {
    at(`/s/${ID}`);
    serve((_method, url) => {
      if (url === `/api/s/${ID}`)
        return json(
          share({
            kind: 'folder',
            path: 'Family/Recipes',
            title: 'Recipes',
            folders: [
              { path: 'Family/Recipes', name: 'Recipes' },
              { path: 'Family/Recipes/Cakes', name: 'Cakes' },
            ],
            files: [entry('Family/Recipes/Pie.md'), entry('Family/Recipes/pie.png', 'image'), entry('Family/Recipes/Cakes/Lemon.md')],
            embedded: [entry('Attachments/photo.png', 'image')],
          }),
        );
      if (url === `/api/s/${ID}/files?path=Family%2FRecipes%2FPie.md`)
        return json({ path: 'Family/Recipes/Pie.md', kind: 'note', content: 'Apples\n', version: 'v1', size: 7, mtime: '2026-11-02T10:00:00.000Z', lossy: false });
      return undefined;
    });
    const { container } = render(<GuestApp />);
    const list = await screen.findByRole('navigation', { name: 'Files in Recipes' }, { timeout: 8000 });
    expect(list).toHaveTextContent('Pie');
    expect(list).toHaveTextContent('pie.png');
    expect(list).toHaveTextContent('Cakes');
    expect(list).toHaveTextContent('Lemon');
    // Embedded media outside the folder is not listed as part of the share.
    expect(list).not.toHaveTextContent('photo.png');
    expect(screen.getByRole('button', { name: /New note/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Pie' }));
    expect(window.location.search).toBe('?path=Family%2FRecipes%2FPie.md');
    await waitFor(() => expect(container.querySelector('.cm-content')?.textContent).toContain('Apples'));
  });
});
