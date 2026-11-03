// Focus after navigation (DESIGN §6.19): a keyboard-initiated navigation moves focus into the
// note (editor or reading view); a pointer navigation announces the note's name and moves focus
// to the workspace, so it never stays stranded on the control that opened a closed overlay.
import { create } from 'zustand';
import { displayName } from './paths';

/** A request expires, so a view that mounts much later (a slow lazy chunk) does not steal focus. */
const REQUEST_TTL_MS = 5000;
let focusUntil = 0;
/** The file the request was made for; null for whichever view mounts next. */
let focusPath: string | null = null;
let clearScheduled = false;
/** Counts requests, so the clearing of one taken request leaves a newer one alone. */
let requestSeq = 0;
/** The request last taken by a view. */
let takenSeq = 0;

/**
 * The next note view to mount takes the keyboard focus: the view of `path` when given, so a view
 * of another file mounting first (the pane's previous file on the way) cannot take it.
 */
export function requestNoteFocus(path?: string): void {
  focusUntil = Date.now() + REQUEST_TTL_MS;
  focusPath = path ?? null;
  requestSeq++;
}

/** Withdraws a pending request (the navigation it was made for did not happen). */
export function cancelNoteFocus(): void {
  focusUntil = 0;
  focusPath = null;
}

/**
 * True when the view of `path` mounting now should take the focus. The request stays valid until
 * the current task ends, so a StrictMode remount (which recreates the editor) focuses too.
 */
export function wantsNoteFocus(path?: string): boolean {
  if (Date.now() >= focusUntil) return false;
  if (focusPath !== null && path !== undefined && path !== focusPath) return false;
  takenSeq = requestSeq;
  if (!clearScheduled) {
    clearScheduled = true;
    setTimeout(() => {
      clearScheduled = false;
      // A request made after the last one taken (a rename about to remount the view) stays.
      if (requestSeq !== takenSeq) return;
      focusUntil = 0;
      focusPath = null;
    }, 0);
  }
  return true;
}

interface FocusState {
  /** Live-region message, and a counter so repeating the same message is announced again. */
  message: string;
  seq: number;
  /** Bumped to move focus to the workspace (a pointer navigation). */
  workspace: number;
}

export const useFocusRequests = create<FocusState>()(() => ({ message: '', seq: 0, workspace: 0 }));

/** Speaks `message` through the app's polite live region. */
export function announce(message: string): void {
  useFocusRequests.setState((s) => ({ message, seq: s.seq + 1 }));
}

/** After opening `path`: focus for keyboard users, an announcement for pointer users. */
export function afterOpen(path: string, viaKeyboard: boolean): void {
  if (viaKeyboard) {
    requestNoteFocus(path);
    return;
  }
  announce(`Opened ${displayName(path)}`);
  useFocusRequests.setState((s) => ({ workspace: s.workspace + 1 }));
}

/** A click produced by Enter or Space on a button has no pointer details (`detail` is 0). */
export function isKeyboardClick(e: { detail: number }): boolean {
  return e.detail === 0;
}

/**
 * Returns focus to `previous` when an overlay closes, unless something outside `container` has
 * deliberately taken the focus meanwhile (a command that focused the inline title, a note view
 * that focused its editor). When `previous` is gone (a dialog opened from the command palette,
 * which has closed), the active pane takes the focus, so it is never left on the page's body.
 */
export function returnFocus(previous: HTMLElement | null, container: HTMLElement | null): void {
  if (!previous || previous === document.body) return;
  const active = document.activeElement;
  if (active && active !== document.body && !(container?.contains(active) ?? false)) return;
  if (previous.isConnected) {
    previous.focus({ preventScroll: true });
    return;
  }
  // After the overlay's own elements have left the page.
  queueMicrotask(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    const pane = document.getElementById('workspace-scroll');
    (pane?.querySelector<HTMLElement>('.cm-content[contenteditable="true"]') ?? pane)?.focus({ preventScroll: true });
  });
}

// ---------- input modality ----------

let lastInput: 'keyboard' | 'pointer' = 'pointer';

/** Tracks whether the last interaction was a key press or a pointer (for keyboard-only hints). */
export function installInputModality(): () => void {
  const onKey = () => {
    lastInput = 'keyboard';
  };
  const onPointer = () => {
    lastInput = 'pointer';
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointer, true);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
  };
}

export function lastInputWasKeyboard(): boolean {
  return lastInput === 'keyboard';
}

// ---------- focus containment (DESIGN §6.19) ----------

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** The elements of `container` that Tab can reach, in order (hidden ones left out). */
export function tabbables(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]') && (el.offsetParent !== null || el === document.activeElement));
}

/**
 * Keeps Tab and Shift-Tab inside `container` (a modal dialog, the drawer, the bottom sheet): from
 * the last element Tab wraps to the first, and from the first (or from outside) Shift-Tab wraps
 * to the last. Call it from a keydown handler; it ignores other keys.
 */
export function trapTab(e: KeyboardEvent, container: HTMLElement): void {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
  const items = tabbables(container);
  if (items.length === 0) {
    e.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = container.contains(active);
  if (e.shiftKey && (active === first || active === container || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Arrow keys in a menu (ARIA menu pattern): ↑/↓ move between the enabled items and wrap,
 * Home/End go to the first and last. Returns true when it handled the key.
 */
export function menuKey(e: { key: string; preventDefault(): void }, menu: HTMLElement | null): boolean {
  if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return false;
  const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])')];
  if (items.length === 0) return false;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  // From nowhere, ↑ starts at the last item.
  items[i < 0 && e.key === 'ArrowUp' ? items.length - 1 : next].focus();
  return true;
}
