// New note through the real workspace (DESIGN §6.15): the pending view, the router, RouteSync and
// the panes together, as App renders them.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useLayoutEffect } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { api, installEndpoints } from '../api/endpoints';
import { createMockEndpoints } from '../api/mock';
import { MockVault } from '../api/mock/vault';
import { queryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import { registerBuiltins } from '../extensions/builtins';
import { updatePendingTitle, usePendingNote } from '../state/pendingNote';
import { documents } from '../sync/instance';
import { createWorkspace } from '../workspace/model';
import { RouteSync } from '../workspace/RouteSync';
import { resetWorkspace } from '../workspace/store';
import { WorkspaceLayout } from '../workspace/WorkspaceLayout';
import { createNote } from './fileOps';
import { setNavigator } from './navigation';
import { usePendingNoteGuard } from './pendingNoteGuard';
import { recordOpened } from './recent';
import { DEFAULT_SETTINGS } from './settings';

let vault: MockVault;
let pathname = '';
/** Every pathname the router showed, in order (a `<Navigate replace>` shows up here too). */
let shown: string[] = [];

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  usePendingNoteGuard();
  useEffect(() => setNavigator((to, opts) => void navigate(to, opts)), [navigate]);
  useLayoutEffect(() => {
    pathname = location.pathname;
    if (shown[shown.length - 1] !== location.pathname) shown.push(location.pathname);
  }, [location]);
  return (
    <>
      <RouteSync />
      <WorkspaceLayout />
    </>
  );
}

function renderAt(url: string) {
  resetWorkspace(createWorkspace(url));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Shell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Holds every call of `api[name]` (for `path`, when given) until the returned function is called. */
function gate<K extends 'createFile' | 'getTree' | 'readFile'>(name: K, path?: string): () => void {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const real = api[name] as (...args: unknown[]) => Promise<unknown>;
  const spy = vi.spyOn(api, name).mockImplementation((async (...args: unknown[]) => {
    if (path === undefined || args[0] === path) await held;
    return real(...args);
  }) as never);
  onTestFinished(() => spy.mockRestore());
  return release;
}

beforeEach(() => {
  registerBuiltins();
  queryClient.clear();
  vault = new MockVault(false);
  installEndpoints(createMockEndpoints(vault, { latency: 0, failures: [] }));
  queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v1', readOnly: false });
  usePendingNote.setState({ pending: null, handoff: null });
  shown = [];
});

afterEach(() => {
  for (const s of documents.all()) documents.close(s);
  queryClient.clear();
});

describe('New note in the workspace (DESIGN §6.15)', () => {
  it('waits for the startup tree, keeping the title being typed, then hands it over (F2)', async () => {
    vault.createFile({ path: 'Other.md', content: 'x' }, 'other-device-1');
    const releaseTree = gate('getTree');
    renderAt('/');
    act(() => createNote(''));
    const id = usePendingNote.getState().pending!.id;
    act(() => updatePendingTitle(id, 'Typed', false));
    // Created and read back, but the tree is still on its way: the pending view keeps the title.
    await waitFor(() => expect(vault.getTree().files.map((f) => f.path)).toContain('Untitled.md'));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByLabelText('Note title')).toHaveFocus();
    act(() => updatePendingTitle(id, 'Typed at once', false));
    await act(async () => releaseTree());
    await waitFor(() => expect(pathname).toBe('/n/Untitled.md'));
    const title = await screen.findByLabelText<HTMLTextAreaElement>('Note title');
    await waitFor(() => expect(title.value).toBe('Typed at once'));
    expect(title).toHaveFocus();
    expect(title.readOnly).toBe(false);
  });

  it('is not replaced by the start page’s last-opened note when the tree came first (F2)', async () => {
    vault.createFile({ path: 'Last.md', content: 'last' }, 'other-device-1');
    recordOpened('Last.md');
    const releaseTree = gate('getTree');
    const releaseCreate = gate('createFile');
    renderAt('/');
    act(() => createNote(''));
    // The tree arrives while the pending view shows: the start page is not mounted, so no redirect yet.
    await act(async () => releaseTree());
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.tree())).toBeDefined());
    expect(pathname).toBe('/');
    await act(async () => releaseCreate());
    await waitFor(() => expect(pathname).toBe('/n/Untitled.md'));
    await new Promise((r) => setTimeout(r, 30));
    expect(pathname).toBe('/n/Untitled.md');
    expect(shown).not.toContain('/n/Last.md');
    expect(await screen.findByLabelText('Note title')).toHaveFocus();
  });

  it('gives the focus to the new note’s text, which the previous note’s view never takes on the way', async () => {
    vault.createFile({ path: 'A.md', content: '# A\n\nText\n' }, 'other-device-1');
    queryClient.setQueryData(queryKeys.tree(), vault.getTree());
    const { container } = renderAt('/n/A.md');
    await waitFor(() => expect(container.querySelector('.note-editor .cm-content')).not.toBeNull());
    const aEditor = container.querySelector('.note-editor .cm-content')!;
    const focused: Element[] = [];
    const onFocus = (e: FocusEvent) => focused.push(e.target as Element);
    document.addEventListener('focusin', onFocus);
    onTestFinished(() => document.removeEventListener('focusin', onFocus));
    const releaseCreate = gate('createFile');
    act(() => createNote(''));
    const id = usePendingNote.getState().pending!.id;
    // Enter in the title: the body field takes the focus, nothing is typed into it.
    act(() => updatePendingTitle(id, 'Plan', true));
    await act(async () => releaseCreate());
    await waitFor(() => expect(pathname).toBe('/n/Plan.md'));
    await waitFor(() => expect(container.querySelector('.note-editor .cm-content')).not.toBeNull());
    const planEditor = container.querySelector('.note-editor .cm-content')!;
    expect(planEditor).not.toBe(aEditor);
    expect(document.activeElement).toBe(planEditor);
    expect(focused.filter((el) => el.classList.contains('cm-content') && el !== planEditor)).toEqual([]);
  });
});
