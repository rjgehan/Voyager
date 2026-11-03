// The optimistic "New note" (DESIGN §6.15): the pending view is shown at once with its title
// focused, while the POST runs in the background.
import { create } from 'zustand';

export interface PendingNote {
  id: number;
  folder: string;
  /** The extension of the file being created (`md` for a note) and what it is called ("note", "drawing"). */
  extension: string;
  label: string;
  /** The title as typed so far (without the extension). */
  title: string;
  /** The user committed a title (Enter or blur) before the note existed: it becomes a rename. */
  committed: boolean;
  /** The title field's selection, carried over to the real note's title. */
  selectionStart: number;
  selectionEnd: number;
  /**
   * The path the note is opening at: the route is switching to it. The pending view stays (and
   * keeps taking keys, which follow into `handoff`) until the pane shows that route, so the pane's
   * previous route (the start page, the previous note) never renders in between.
   */
  opening: string | null;
}

export interface TitleHandoff {
  path: string;
  title: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Text typed into a pending note's body, with its selection: it goes into the note once it exists. */
export interface PendingBody {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

interface PendingState {
  pending: PendingNote | null;
  /** Hands the typed title over to the real note's inline title once the note exists. */
  handoff: TitleHandoff | null;
}

export const usePendingNote = create<PendingState>()(() => ({ pending: null, handoff: null }));

/**
 * The bodies typed so far, by pending id. Kept outside the store, so a keystroke re-renders
 * nothing, and kept when the pending view goes away (a navigation): the note still gets them.
 */
const bodies = new Map<number, PendingBody>();

/** A new pending note (or other file) whose whole title is selected, so typing replaces it. */
export function startPendingNote(id: number, folder: string, title: string, file: { extension: string; label: string } = { extension: 'md', label: 'note' }): void {
  usePendingNote.setState({
    pending: { id, folder, ...file, title, committed: false, selectionStart: 0, selectionEnd: title.length, opening: null },
    handoff: null,
  });
}

/** The title typed after the note began opening follows into its hand-over. */
function followingHandoff(pending: PendingNote, handoff: TitleHandoff | null): TitleHandoff | null {
  if (!handoff || pending.opening !== handoff.path) return handoff;
  return { path: handoff.path, title: pending.title, selectionStart: pending.selectionStart, selectionEnd: pending.selectionEnd };
}

export function updatePendingTitle(id: number, title: string, committed: boolean): void {
  const { pending, handoff } = usePendingNote.getState();
  if (pending?.id !== id) return;
  const next = { ...pending, title, committed };
  usePendingNote.setState({ pending: next, handoff: followingHandoff(next, handoff) });
}

export function updatePendingSelection(id: number, selectionStart: number, selectionEnd: number): void {
  const { pending, handoff } = usePendingNote.getState();
  if (pending?.id === id && (pending.selectionStart !== selectionStart || pending.selectionEnd !== selectionEnd)) {
    const next = { ...pending, selectionStart, selectionEnd };
    usePendingNote.setState({ pending: next, handoff: followingHandoff(next, handoff) });
  }
}

/**
 * Pending note `id` opens at `path`: a title still being typed goes to the note's inline title
 * (`handoff`), and the pending view stays until the pane shows the note.
 */
export function openPendingNote(id: number, path: string): void {
  const { pending } = usePendingNote.getState();
  if (pending?.id !== id) return;
  usePendingNote.setState({
    pending: { ...pending, opening: path },
    handoff: pending.committed ? null : { path, title: pending.title, selectionStart: pending.selectionStart, selectionEnd: pending.selectionEnd },
  });
}

/** The body of pending note `id` as typed so far (an empty body is no body). */
export function setPendingBody(id: number, body: PendingBody): void {
  if (body.text === '') bodies.delete(id);
  else bodies.set(id, body);
}

export function hasPendingBody(id: number): boolean {
  return bodies.has(id);
}

/** Consumed once, by the note that pending note `id` became. */
export function takePendingBody(id: number): PendingBody | null {
  const body = bodies.get(id) ?? null;
  bodies.delete(id);
  return body;
}

export function clearPendingNote(id?: number): void {
  const { pending } = usePendingNote.getState();
  if (pending && (id === undefined || pending.id === id)) usePendingNote.setState({ pending: null });
}

/** Consumed once by the inline title of the note at `path`. */
export function takeTitleHandoff(path: string): TitleHandoff | null {
  const { handoff } = usePendingNote.getState();
  if (!handoff || handoff.path !== path) return null;
  usePendingNote.setState({ handoff: null });
  return handoff;
}
