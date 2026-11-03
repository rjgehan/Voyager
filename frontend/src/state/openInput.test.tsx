import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureDialog } from '../components/capture/CaptureDialog';
// The page's real unsaved probe (documents + open input), as production installs it.
import '../sync/instance';
import { reportServerBuild, setReloader, setReloadPreparer } from './buildCheck';
import { setPendingBody, startPendingNote, updatePendingTitle, usePendingNote } from './pendingNote';
import { useUi } from './ui';

let reload: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  useUi.getState().setNewBuildAvailable(false);
  setReloadPreparer(null);
  reload = vi.fn<() => void>();
  setReloader(reload);
});

afterEach(() => {
  usePendingNote.setState({ pending: null, handoff: null });
  cleanup();
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

function expectBannerNotReload() {
  expect(reload).not.toHaveBeenCalled();
  expect(useUi.getState().newBuildAvailable).toBe(true);
}

describe('a new build while text is typed outside a note (DESIGN §6.18)', () => {
  it('nothing typed anywhere: a clean page reloads by itself', () => {
    reportServerBuild('build-2', 'build-1');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the pending new note’s typed title is kept: the banner shows instead of the reload', () => {
    startPendingNote(1, '', 'Untitled');
    updatePendingTitle(1, 'Groceries', false);
    setPendingBody(1, { text: 'milk', selectionStart: 4, selectionEnd: 4 });
    reportServerBuild('build-2', 'build-1');
    expectBannerNotReload();
  });

  it('text typed in the quick-capture dialog is kept', () => {
    render(<CaptureDialog />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Capture text' }), { target: { value: 'buy milk' } });
    reportServerBuild('build-2', 'build-1');
    expectBannerNotReload();
  });

  it('text typed in a focused field (quick add, Ask, an inline title) is kept', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    input.value = 'Order tiles';
    reportServerBuild('build-2', 'build-1');
    expectBannerNotReload();
  });

  it('an empty focused field, or a focused note editor (its session covers it), does not stop the reload', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    reportServerBuild('build-2', 'build-1');
    expect(reload).toHaveBeenCalledTimes(1);

    setReloader(reload);
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    content.contentEditable = 'true';
    content.tabIndex = 0;
    content.textContent = 'A saved note';
    editor.append(content);
    document.body.append(editor);
    content.focus();
    reportServerBuild('build-3', 'build-1');
    expect(reload).toHaveBeenCalledTimes(2);
    expect(useUi.getState().newBuildAvailable).toBe(false);
  });

  it('the capture and clip pages never reload by themselves', () => {
    for (const path of ['/capture', '/clip']) {
      useUi.getState().setNewBuildAvailable(false);
      setReloader(reload);
      window.history.replaceState(null, '', path);
      reportServerBuild('build-2', 'build-1');
      expectBannerNotReload();
    }
  });

  it('asks again once the service worker hand-over is done: text typed meanwhile is kept', async () => {
    let release!: () => void;
    setReloadPreparer(() => new Promise<void>((r) => (release = r)));
    reportServerBuild('build-2', 'build-1');
    // The user presses New note and types during the (up to 10 s) wait.
    startPendingNote(2, '', 'Untitled');
    updatePendingTitle(2, 'Groceries', false);
    release();
    await vi.waitFor(() => expect(useUi.getState().newBuildAvailable).toBe(true));
    expect(reload).not.toHaveBeenCalled();
  });
});
