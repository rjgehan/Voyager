// Toast stack (aria-live polite), with an optional action such as Undo. A toast waits while the
// pointer is over it or the focus is in it, so its action can be reached in time (WCAG 2.2.1); it
// then gets its whole time again.
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToasts, type Toast } from '../../state/toasts';

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  useEffect(() => {
    if (toast.timeout <= 0 || paused) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.timeout);
    return () => clearTimeout(timer);
  }, [toast.id, toast.timeout, dismiss, paused]);
  return (
    <div
      className={`toast toast-${toast.kind}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(toast.id)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
