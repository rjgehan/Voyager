import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { queryClient } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { DEFAULT_SETTINGS } from '../../features/settings';
import { setPendingProblem, startPendingNote, takePendingBody, updatePendingTitle, usePendingNote, whenRetryAsked } from '../../state/pendingNote';
import { PendingNoteView } from './PendingNoteView';

function view() {
  return (
    <QueryClientProvider client={queryClient}>
      <PendingNoteView pending={usePendingNote.getState().pending!} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  usePendingNote.setState({ pending: null, handoff: null });
  queryClient.clear();
});

describe('PendingNoteView', () => {
  it('asks for a new note’s name, then for writing', () => {
    queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v1', readOnly: false });
    startPendingNote(1, '', 'Untitled');
    render(view());
    expect(screen.getByLabelText('Note title')).toHaveValue('Untitled');
    expect(screen.getByText('Name the new note, then start writing.')).toBeInTheDocument();
  });

  it('names a new drawing as a drawing, which opens once its name is committed', () => {
    queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v1', readOnly: false });
    startPendingNote(2, '', 'Untitled', { extension: 'excalidraw', label: 'drawing' });
    const { rerender } = render(view());
    expect(screen.getByLabelText('Drawing title')).toHaveValue('Untitled');
    expect(screen.getByText('Name the new drawing, then press Enter to open it.')).toBeInTheDocument();
    // A drawing has no text to start writing.
    expect(screen.queryByLabelText('Note text')).not.toBeInTheDocument();
    updatePendingTitle(2, 'Plan', true);
    rerender(view());
    expect(screen.getByText('Creating the drawing…')).toBeInTheDocument();
  });

  it('moves on to the body with Enter, and keeps what is written there for the note', () => {
    queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v1', readOnly: false });
    startPendingNote(5, '', 'Untitled');
    const { rerender } = render(view());
    const title = screen.getByLabelText('Note title');
    fireEvent.change(title, { target: { value: 'Groceries' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    const body = screen.getByLabelText<HTMLTextAreaElement>('Note text');
    expect(body).toHaveFocus();
    // Leaving the title committed it: the note is being created under that name.
    expect(usePendingNote.getState().pending).toMatchObject({ title: 'Groceries', committed: true });
    rerender(view());
    expect(screen.getByText('Creating the note…')).toBeInTheDocument();
    fireEvent.change(body, { target: { value: 'milk\neggs' } });
    expect(takePendingBody(5)).toEqual({ text: 'milk\neggs', selectionStart: 9, selectionEnd: 9 });
  });

  it('keeps the title’s selection with the text it belongs to', () => {
    queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v1', readOnly: false });
    startPendingNote(7, '', 'Untitled');
    render(view());
    const title = screen.getByLabelText<HTMLTextAreaElement>('Note title');
    // "I" typed over the selected "Untitled": the input event comes before any selectionchange, and
    // the note may be handed over in between.
    fireEvent.change(title, { target: { value: 'I', selectionStart: 1, selectionEnd: 1 } });
    expect(usePendingNote.getState().pending).toMatchObject({ title: 'I', selectionStart: 1, selectionEnd: 1 });
  });

  it('says when it waits for the server, and offers Try again when the server refused the note', async () => {
    queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v1', readOnly: false });
    startPendingNote(8, '', 'Untitled');
    updatePendingTitle(8, 'Groceries', true);
    setPendingProblem(8, { message: "Can't reach the server.", retry: 'auto' });
    const { rerender } = render(view());
    expect(screen.getByRole('status')).toHaveTextContent("Can't reach the server.");
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    setPendingProblem(8, { message: 'The note could not be created: The folder name is not allowed', retry: 'manual' });
    rerender(view());
    expect(screen.getByRole('alert')).toHaveTextContent('The folder name is not allowed');
    // The title stays, and Try again asks the flow to create the note again.
    expect(screen.getByLabelText('Note title')).toHaveValue('Groceries');
    const asked = whenRetryAsked(8);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await expect(asked).resolves.toBe(true);
  });

  it('a tap in the body commits the title the same way', () => {
    queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v1', readOnly: false });
    startPendingNote(6, '', 'Untitled');
    render(view());
    screen.getByLabelText('Note text').focus();
    expect(usePendingNote.getState().pending).toMatchObject({ title: 'Untitled', committed: true });
  });

  it('takes the note width of the settings', () => {
    queryClient.setQueryData(queryKeys.settings(), { settings: { ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, noteWidth: 900 } }, version: 'v1', readOnly: false });
    startPendingNote(4, '', 'Untitled');
    const { container, unmount } = render(view());
    const column = container.querySelector<HTMLElement>('.markdown-view')!;
    expect(column).toHaveClass('is-readable');
    expect(column.style.getPropertyValue('--note-width')).toBe('900px');
    unmount();
    queryClient.setQueryData(queryKeys.settings(), { settings: { ...DEFAULT_SETTINGS, editor: { ...DEFAULT_SETTINGS.editor, noteWidth: 'full' } }, version: 'v2', readOnly: false });
    const full = render(view()).container.querySelector<HTMLElement>('.markdown-view')!;
    expect(full).not.toHaveClass('is-readable');
    expect(full.style.getPropertyValue('--note-width')).toBe('');
  });

  it("keeps the title open while a template's questions have the focus, and commits it on any other blur", () => {
    queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v1', readOnly: false });
    startPendingNote(3, '', 'Untitled');
    render(view());
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const field = document.createElement('input');
    dialog.appendChild(field);
    document.body.appendChild(dialog);
    field.focus();
    expect(usePendingNote.getState().pending?.committed).toBe(false);
    screen.getByLabelText('Note title').focus();
    document.body.focus();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(usePendingNote.getState().pending?.committed).toBe(true);
    dialog.remove();
  });
});
