import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { api, installEndpoints } from '../api/endpoints';
import { createMockEndpoints } from '../api/mock';
import { MockVault } from '../api/mock/vault';
import { queryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import { clearPendingNote, hasPendingBody, setPendingBody, updatePendingSelection, updatePendingTitle, usePendingNote } from '../state/pendingNote';
import { documents } from '../sync/instance';
import { newDrawingContent } from '../views/excalidraw/format';
import { createNote } from './fileOps';
import { setNavigator } from './navigation';
import { DEFAULT_SETTINGS } from './settings';
import { templateRenderer } from './templates';

let vault: MockVault;
let routes: string[];
/** Whether the new note's session could take input when the route switched to it. */
let editableAtSwap: boolean[];

beforeEach(() => {
  vault = new MockVault(false);
  installEndpoints(createMockEndpoints(vault, { latency: 0, failures: [] }));
  queryClient.setQueryData(queryKeys.tree(), vault.getTree());
  routes = [];
  editableAtSwap = [];
  setNavigator((to) => {
    routes.push(to);
    const path = decodeURIComponent(to.slice('/n/'.length));
    if (path.endsWith('.md')) editableAtSwap.push(documents.get(path)?.isEditable() ?? false);
  });
  usePendingNote.setState({ pending: null, handoff: null });
});

afterEach(() => {
  queryClient.clear();
});

/** Holds the first read of `path` (the new note's session load) until `release` is called. */
function gateRead(path: string): () => void {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const read = api.readFile;
  const spy = vi.spyOn(api, 'readFile').mockImplementation(async (p, ...rest) => {
    if (p === path) await gate;
    return read(p, ...rest);
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
    // The pending view stays until the pane shows the drawing (the navigation then clears it).
    expect(usePendingNote.getState()).toMatchObject({ pending: { id, opening: 'Architecture.excalidraw' }, handoff: null });
  });

  it('names a drawing whose title was committed before the user went elsewhere', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const create = api.createFile;
    const spy = vi.spyOn(api, 'createFile').mockImplementation(async (...args) => {
      await gate;
      return create(...args);
    });
    onTestFinished(() => spy.mockRestore());
    createNote('', newDrawingContent(), 'excalidraw');
    const id = usePendingNote.getState().pending!.id;
    updatePendingTitle(id, 'Architecture', true);
    clearPendingNote();
    release();
    await vi.waitFor(() => expect(vault.getTree().files.map((f) => f.path)).toEqual(['Architecture.excalidraw']));
    expect(routes).toEqual([]);
  });

  it('keeps the free name when the title is committed untouched', async () => {
    createNote('', newDrawingContent(), 'excalidraw');
    const id = usePendingNote.getState().pending!.id;
    await settle();
    updatePendingTitle(id, 'Untitled', true);
    await vi.waitFor(() => expect(routes).toEqual(['/n/Untitled.excalidraw']));
  });

  it('a note opens once it has loaded and hands the title typed by then over to the inline title', async () => {
    const release = gateRead('Untitled.md');
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    updatePendingTitle(id, 'Shop', false);
    await settle();
    // Created, but its text is still being read: the pending view keeps taking the title.
    await new Promise((r) => setTimeout(r, 20));
    expect(routes).toEqual([]);
    expect(usePendingNote.getState().pending).toMatchObject({ id, title: 'Shop' });
    updatePendingTitle(id, 'Shopping', false);
    updatePendingSelection(id, 8, 8);
    release();
    await vi.waitFor(() => expect(routes).toEqual(['/n/Untitled.md']));
    // The inline title is editable and the editor mounts in the same commit as the swap.
    expect(editableAtSwap).toEqual([true]);
    expect(usePendingNote.getState().handoff).toEqual({ path: 'Untitled.md', title: 'Shopping', selectionStart: 8, selectionEnd: 8 });
    // Until the pane shows the note, the pending view stays and what is typed follows into the hand-over.
    expect(usePendingNote.getState().pending).toMatchObject({ id, opening: 'Untitled.md' });
    updatePendingTitle(id, 'Shopping list', false);
    updatePendingSelection(id, 13, 13);
    expect(usePendingNote.getState().handoff).toEqual({ path: 'Untitled.md', title: 'Shopping list', selectionStart: 13, selectionEnd: 13 });
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
    expect(usePendingNote.getState().pending).toMatchObject({ id, opening: 'Groceries.md' });
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

  it('renames to a committed title even when the user went elsewhere meanwhile', async () => {
    const release = gateCreate();
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    // Enter in the title (its blur commits), writing, then a tap on another note.
    updatePendingTitle(id, 'Groceries', true);
    setPendingBody(id, { text: 'milk', selectionStart: 4, selectionEnd: 4 });
    clearPendingNote();
    release();
    await vi.waitFor(() => expect(vault.readFile('Groceries.md').content).toBe('milk'));
    sessionOf('Groceries.md');
    expect(vault.getTree().files.map((f) => f.path)).toEqual(['Groceries.md']);
    // The note is not opened: the user stays where they went.
    expect(routes).toEqual([]);
  });

  it('renames to a committed title without a body when the user went elsewhere', async () => {
    const release = gateCreate();
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    updatePendingTitle(id, 'Groceries', true);
    clearPendingNote();
    release();
    await vi.waitFor(() => expect(vault.getTree().files.map((f) => f.path)).toEqual(['Groceries.md']));
    expect(vault.readFile('Groceries.md').content).toBe('');
    expect(routes).toEqual([]);
  });

  it('renames to a title committed while the note was being read', async () => {
    const release = gateRead('Untitled.md');
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    updatePendingTitle(id, 'Groceries', false);
    await settle();
    // Enter in the title once the note exists but is still being read; then writing.
    updatePendingTitle(id, 'Groceries', true);
    setPendingBody(id, { text: 'milk', selectionStart: 4, selectionEnd: 4 });
    release();
    await vi.waitFor(() => expect(routes).toEqual(['/n/Groceries.md']));
    const session = sessionOf('Groceries.md');
    expect(session.getText()).toBe('milk');
    expect(vault.getTree().files.map((f) => f.path)).toEqual(['Groceries.md']);
    expect(usePendingNote.getState().handoff).toBeNull();
  });

  it('opens a note without a body once it has loaded, with what was typed into the body meanwhile', async () => {
    const release = gateRead('Plan.md');
    createNote('', '', 'md');
    const id = usePendingNote.getState().pending!.id;
    // Enter in the title: the body has the focus, nothing typed into it yet.
    updatePendingTitle(id, 'Plan', true);
    await vi.waitFor(() => expect(vault.getTree().files.map((f) => f.path)).toEqual(['Plan.md']));
    await new Promise((r) => setTimeout(r, 20));
    // The pending view (and its focused body field) stays while the note is read.
    expect(routes).toEqual([]);
    expect(usePendingNote.getState().pending).toMatchObject({ id, committed: true });
    setPendingBody(id, { text: 'Step one', selectionStart: 8, selectionEnd: 8 });
    release();
    await vi.waitFor(() => expect(routes).toEqual(['/n/Plan.md']));
    expect(editableAtSwap).toEqual([true]);
    const session = sessionOf('Plan.md');
    expect(session.getText()).toBe('Step one');
    expect(session.editorState.selection.main.head).toBe(8);
  });
});
