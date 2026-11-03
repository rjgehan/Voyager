// A toolbar with one Tab stop (DESIGN §6.21.5), as WAI-ARIA's toolbar pattern asks: Tab enters and
// leaves it at the button used last, and ArrowLeft, ArrowRight, Home and End move along its enabled
// buttons. The buttons' tabindex is set on the DOM after every render, so buttons that come, go or
// are disabled never strand the Tab stop.
import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.disabled);

export function useRovingToolbar(ref: RefObject<HTMLElement | null>): { onKeyDown(e: KeyboardEvent<HTMLElement>): void; onFocus(e: { target: EventTarget }): void } {
  const current = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = buttons(el);
    const at = Math.min(current.current, items.length - 1);
    for (const b of el.querySelectorAll<HTMLButtonElement>('button')) b.tabIndex = -1;
    if (items[at]) items[at].tabIndex = 0;
  });
  const move = (el: HTMLElement, index: number) => {
    const items = buttons(el);
    if (items.length === 0) return;
    const i = (index + items.length) % items.length;
    current.current = i;
    for (const b of items) b.tabIndex = -1;
    items[i].tabIndex = 0;
    items[i].focus();
  };
  return {
    onKeyDown(e) {
      const el = ref.current;
      if (!el || !(e.target instanceof HTMLButtonElement)) return;
      const items = buttons(el);
      const i = items.indexOf(e.target);
      const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
      if (next === null || i < 0) return;
      e.preventDefault();
      move(el, next);
    },
    onFocus(e) {
      const el = ref.current;
      if (!el || !(e.target instanceof HTMLButtonElement)) return;
      const i = buttons(el).indexOf(e.target);
      if (i >= 0) current.current = i;
    },
  };
}
