// A panel anchored at a cell (a filter's menu, a dropdown's list), as Google Sheets opens them under
// the cell: Esc and a press outside close it, focus goes into it and back where it was. On a phone
// it is a dialog instead (the Modal's sheet, with the back gesture and 44 px rows).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../../components/overlays/Modal';
import { returnFocus } from '../../features/focus';
import type { ScreenRect } from './SheetGrid';

interface Props {
  label: string;
  /** The cell it opens under. */
  anchor: ScreenRect;
  /** A phone: a dialog rather than a panel. */
  phone: boolean;
  className?: string;
  onClose(): void;
  children: ReactNode;
}

export function SheetPopover({ label, anchor, phone, className, onClose, children }: Props) {
  if (phone) {
    return (
      <Modal label={label} onClose={onClose} variant="sheet" className={`sheet-popover-dialog ${className ?? ''}`}>
        {children}
      </Modal>
    );
  }
  return (
    <Panel label={label} anchor={anchor} className={className} onClose={onClose}>
      {children}
    </Panel>
  );
}

function Panel({ label, anchor, className, onClose, children }: Omit<Props, 'phone'>) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const [previous] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Under the cell, kept inside the window (above it when there is no room below).
    const rect = el.getBoundingClientRect();
    const below = anchor.y + anchor.height + 2;
    const top = below + rect.height > window.innerHeight - 8 ? Math.max(8, anchor.y - rect.height - 2) : below;
    el.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8))}px`;
    el.style.top = `${top}px`;
    if (!el.contains(document.activeElement)) el.querySelector<HTMLElement>('[data-autofocus], input, button')?.focus({ preventScroll: true });
    return () => returnFocus(previous, el);
  }, [anchor, previous]);

  useLayoutEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return createPortal(
    <div ref={ref} className={`sheet-popover ${className ?? ''}`} role="dialog" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}
