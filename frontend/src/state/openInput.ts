// Text typed outside a note session, which an automatic new-build reload would lose (DESIGN §6.18).
// Notes keep their text in drafts, but the pending new note's title, quick capture, quick add, an
// inline-title rename, Ask and dialogs keep theirs only in memory: while any of them is open the
// page shows the "new version" banner instead of reloading by itself.
import { usePendingNote } from './pendingNote';
import { appPathname } from './vault';

function typedInto(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  // A note's editor: its session (and draft) already counts.
  if (el.closest('.cm-editor')) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return !el.readOnly && el.value.trim() !== '';
  return el.isContentEditable && (el.textContent ?? '').trim() !== '';
}

export function hasOpenInput(): boolean {
  if (usePendingNote.getState().pending !== null) return true;
  // The capture page and the clipper's page hold what they are about to save.
  const path = appPathname();
  if (path === '/capture' || path === '/clip') return true;
  if (document.querySelector('.modal-panel')) return true;
  return typedInto(document.activeElement);
}
