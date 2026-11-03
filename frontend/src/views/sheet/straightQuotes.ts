// Straight quotes while a formula is typed (DESIGN §6.21.5), in Glide's cell editor and in the
// formula bar: iOS Smart Punctuation turns `"` into “ or ” even with autocorrect off, so a formula's
// curly quotes are made straight as they are typed (`sheets/smartQuotes.ts`; commits straighten
// them too, for pasted text). Glide's editor is not ours to configure: when it takes the focus it
// gets autocorrect, autocapitalize, spellcheck and autocomplete switched off, as the bar has.
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { setInputValue } from '../../formulas/assist';
import { straightenFormula } from '../../sheets/smartQuotes';

interface Options {
  /** Where Glide's cell editor opens. */
  portalRef: RefObject<HTMLDivElement | null>;
  /** The formula bar's field, while it edits a cell. */
  barInput(): HTMLInputElement | null;
}

export function useStraightQuotes({ portalRef, barInput }: Options): void {
  const bar = useRef(barInput);
  useLayoutEffect(() => {
    bar.current = barInput;
  });

  useEffect(() => {
    const field = (target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null => {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null;
      return portalRef.current?.contains(target) || target === bar.current() || target.classList.contains('sheet-formula-input') ? target : null;
    };
    const onInput = (e: Event) => {
      const el = field(e.target);
      if (!el) return;
      const next = straightenFormula(el.value);
      if (next === el.value) return;
      // One character for one: the caret stays where it was.
      const start = el.selectionStart;
      const end = el.selectionEnd;
      setInputValue(el, next);
      if (start !== null && end !== null) el.setSelectionRange(start, end);
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || !portalRef.current?.contains(el)) return;
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.setAttribute('autocomplete', 'off');
      el.spellcheck = false;
    };
    document.addEventListener('input', onInput, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [portalRef]);
}
