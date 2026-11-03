// Google Sheets' keys while a cell is edited (DESIGN §6.21.16), in Glide's cell editor and in the
// formula bar: F4 steps the reference at the caret through $A$1, A$1, $A1 and A1; Mod-; types
// today's date and Mod-Shift-; the time at the caret (Mod-Alt-Shift-; both).
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { setInputValue } from '../../formulas/assist';
import { isApple } from '../../features/platform';
import { cycleReference, dateText, timeText } from '../../sheets/keys';

interface Options {
  /** Where Glide's cell editor opens. */
  portalRef: RefObject<HTMLDivElement | null>;
  /** The formula bar's field, while it edits a cell. */
  barInput(): HTMLInputElement | HTMLTextAreaElement | null;
}

/** What Mod-; (and Shift, and Alt) types: the date, the time, or both. */
export function nowText(shift: boolean, alt: boolean, now = new Date()): string {
  if (shift && alt) return `${dateText(now)} ${timeText(now)}`;
  return shift ? timeText(now) : dateText(now);
}

export function useFormulaKeys({ portalRef, barInput }: Options): void {
  const bar = useRef(barInput);
  useLayoutEffect(() => {
    bar.current = barInput;
  });

  useEffect(() => {
    const field = (target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null => {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null;
      return portalRef.current?.contains(target) || target === bar.current() ? target : null;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const el = field(e.target);
      if (!el || e.isComposing) return;
      const mod = isApple ? e.metaKey : e.ctrlKey;
      const caret = el.selectionStart ?? el.value.length;
      if (e.key === 'F4' && !mod && !e.altKey && !e.shiftKey) {
        const next = cycleReference(el.value, caret);
        if (!next) return;
        e.preventDefault();
        e.stopPropagation();
        setInputValue(el, next.text);
        el.setSelectionRange(next.caret, next.caret);
        return;
      }
      if (mod && (e.code === 'Semicolon' || e.key === ';' || e.key === ':')) {
        e.preventDefault();
        e.stopPropagation();
        const text = nowText(e.shiftKey, e.altKey);
        const end = el.selectionEnd ?? caret;
        setInputValue(el, el.value.slice(0, caret) + text + el.value.slice(end));
        el.setSelectionRange(caret + text.length, caret + text.length);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [portalRef]);
}
