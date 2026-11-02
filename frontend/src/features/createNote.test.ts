import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { api, installEndpoints } from '../api/endpoints';
import { createMockEndpoints } from '../api/mock';
import { MockVault } from '../api/mock/vault';
import { queryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import { clearPendingNote, hasPendingBody, setPendingBody, updatePendingTitle, usePendingNote } from '../state/pendingNote';
import { documents } from '../sync/instance';
import { newDrawingContent } from '../views/excalidraw/format';
import { createNote } from './fileOps';
import { setNavigator } from './navigation';
import { DEFAULT_SETTINGS } from './settings';
import { templateRenderer } from './templates';

let vault: MockVault;
let routes: string[];

beforeEach(() => {
  vault = new MockVault(false);
  installEndpoints(createMockEndpoints(vault, { latency: 0, failures: [] }));
  queryClient.setQueryData(queryKeys.tree(), vault.getTree());
  routes = [];
  setNavigator((to) => routes.push(to));
  usePendingNote.setState({ pending: null, handoff: null });
});

afterEach(() => {
  queryClient.clear();
});

const settle = () => vi.waitFor(() => expect(vault.getTree().files.length).toBeGreaterThan(0));

describe('createNote for files without an inline title (a new drawing, DESIGN §6.8.1)', () => {
  it('opens the drawing once the pending title is committed, under that name', async () => {
    createNote('', newDrawingContent(), 'excalidraw');
    const id = usePendingNote.getState().pending!.id;
    await settle();
    expect(vault.getTree().files.map((f) => f.path)).toEqual(['Untitled.excalidraw']);
    // Created, but the title is still being typed: nothing opens yet.
    await new Promise((r) => setTimeout(r, 20));
    expect(routes).toEqual([]);
    updatePendingTitle(id, 'Architecture', false);
    updatePendingTitle(id, 'Architecture', true);
    await vi.waitFor(() => expect(routes).toEqual(['/n/Architecture.excalidraw']));
    expect(vault.getTree().files.map((f) => f.path)).toEqual(['Architecture.excalidraw']);
    expect(usePendingNote.getState()).toMatchObject({ pending: null, handoff: null });
  });

  it('keeps the free name when the title is committed untouched', async () => {
    createNote('', newDrawingContent(), 'excalidraw');
    const id = usePendingNote.getState().pending!.id;
    await settle();
    updatePendingTitle(id, 'Untitled', true);
    await vi.waitFor(() => expect(routes).toEqual(['/n/Untitled.excalidraw']));
  });

  it('a note still opens at once and hands its title over to the inline title', async () => {
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    updatePendingTitle(id, 'Half typ', false);
    await vi.waitFor(() => expect(routes).toEqual(['/n/Untitled.md']));
    expect(usePendingNote.getState().handoff).toMatchObject({ path: 'Untitled.md', title: 'Half typ' });
  });
});

describe('writing typed into a new note before it exists (DESIGN §6.15)', () => {
  /** Holds the create request until `release` is called: the pending view shows "Creating the note…". */
  function gateCreate(): () => void {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const create = api.createFile;
    const spy = vi.spyOn(api, 'createFile').mockImplementation(async (...args) => {
      await gate;
      return create(...args);
    });
    onTestFinished(() => spy.mockRestore());
    return release;
  }

  /** The note's session, closed when the test ends (the registry outlives the test's vault). */
  function sessionOf(path: string) {
    const session = documents.get(path)!;
    onTestFinished(() => documents.close(session));
    return session;
  }

  it('goes into the note under its new name, with everything typed meanwhile and the caret where it was', async () => {
    const release = gateCreate();
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    // Enter in the title, then writing in the body while the note is being created.
    updatePendingTitle(id, 'Groceries', true);
    setPendingBody(id, { text: 'milk', selectionStart: 4, selectionEnd: 4 });
    release();
    setPendingBody(id, { text: 'milk\neggs', selectionStart: 9, selectionEnd: 9 });
    await vi.waitFor(() => expect(routes).toEqual(['/n/Groceries.md']));
    const session = sessionOf('Groceries.md');
    expect(session.getText()).toBe('milk\neggs');
    expect(session.editorState.selection.main.head).toBe(9);
    expect(usePendingNote.getState().pending).toBeNull();
    expect(hasPendingBody(id)).toBe(false);
    await session.flush();
    expect(vault.readFile('Groceries.md').content).toBe('milk\neggs');
  });

  it('keeps the free name when the title is committed untouched', async () => {
    const release = gateCreate();
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    updatePendingTitle(id, 'Untitled', true);
    setPendingBody(id, { text: 'A quick thought', selectionStart: 2, selectionEnd: 7 });
    release();
    await vi.waitFor(() => expect(routes).toEqual(['/n/Untitled.md']));
    const session = sessionOf('Untitled.md');
    expect(session.getText()).toBe('A quick thought');
    expect(session.editorState.selection.main).toMatchObject({ from: 2, to: 7 });
  });

  it("goes in at a template's cursor", async () => {
    vault.createFile({ path: 'Templates/Meeting.md', content: '# {{title}}\n\n{{cursor}}\n\nNotes' }, 'other-device-1');
    queryClient.setQueryData(queryKeys.tree(), vault.getTree());
    queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v1', readOnly: false });
    const release = gateCreate();
    createNote('', templateRenderer('Templates/Meeting.md'));
    const id = usePendingNote.getState().pending!.id;
    updatePendingTitle(id, 'Standup', true);
    setPendingBody(id, { text: 'Ship it', selectionStart: 7, selectionEnd: 7 });
    release();
    await vi.waitFor(() => expect(routes).toEqual(['/n/Standup.md']));
    const session = sessionOf('Standup.md');
    expect(session.getText()).toBe('# Standup\n\nShip it\n\nNotes');
    expect(session.editorState.selection.main.head).toBe('# Standup\n\nShip it'.length);
  });

  it('still reaches the note when the user went elsewhere meanwhile', async () => {
    const release = gateCreate();
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    updatePendingTitle(id, 'Untitled', true);
    setPendingBody(id, { text: 'half a thought', selectionStart: 14, selectionEnd: 14 });
    // The navigation guard (App.tsx) clears the pending view.
    clearPendingNote();
    release();
    await vi.waitFor(() => expect(vault.readFile('Untitled.md').content).toBe('half a thought'));
    sessionOf('Untitled.md');
    expect(routes).toEqual([]);
  });

  it('opens a note without a body as soon as it exists', async () => {
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    updatePendingTitle(id, 'Plan', true);
    await vi.waitFor(() => expect(routes).toEqual(['/n/Plan.md']));
    expect(documents.get('Plan.md')).toBeUndefined();
  });
});
