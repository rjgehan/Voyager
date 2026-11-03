import { afterEach, describe, expect, it } from 'vitest';
import { clearPendingNote, openPendingNote, startPendingNote, updatePendingSelection, updatePendingTitle, usePendingNote } from './pendingNote';

afterEach(() => {
  clearPendingNote();
  usePendingNote.setState({ pending: null, handoff: null });
});

describe('the title handed over to a new note', () => {
  it('is the server\'s free name, selected, when the title was left as "Untitled"', () => {
    startPendingNote(1, '', 'Untitled');
    openPendingNote(1, 'Untitled 1.md');
    expect(usePendingNote.getState().handoff).toMatchObject({ path: 'Untitled 1.md', title: 'Untitled 1', selectionStart: 0, selectionEnd: 10 });
  });

  it('keeps a title being typed as it is, caret and all', () => {
    startPendingNote(2, '', 'Untitled');
    updatePendingTitle(2, 'Meet', false);
    updatePendingSelection(2, 4, 4);
    openPendingNote(2, 'Untitled 1.md');
    expect(usePendingNote.getState().handoff).toMatchObject({ path: 'Untitled 1.md', title: 'Meet', selectionStart: 4, selectionEnd: 4 });
  });

  it('keeps the selection of an untouched title when the note got that name', () => {
    startPendingNote(3, '', 'Untitled');
    updatePendingSelection(3, 2, 2);
    openPendingNote(3, 'Untitled.md');
    expect(usePendingNote.getState().handoff).toMatchObject({ title: 'Untitled', selectionStart: 2, selectionEnd: 2 });
  });
});
