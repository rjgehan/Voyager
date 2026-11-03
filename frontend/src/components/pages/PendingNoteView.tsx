// The optimistic new-note view (DESIGN §6.15): shown at once by the tap on "New note", with its
// title focused synchronously (so iOS opens the keyboard) while the note is created. A note's body
// takes writing at once too (Enter in the title, or a tap below it): what is typed there goes into
// the note once it exists. Another view's new file (a drawing) is named here, and opens once its
// name is committed.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useVaultSettings } from '../../api/hooks';
import { autoGrow, useAutoGrow } from '../autoGrow';
import { validateNewName } from '../../features/fileOps';
import { noteWidthProps } from '../../features/settings';
import { usePrefs } from '../../state/prefs';
import { setPendingBody, updatePendingSelection, updatePendingTitle, type PendingNote } from '../../state/pendingNote';

export function PendingNoteView({ pending }: { pending: PendingNote }) {
  const settings = useVaultSettings();
  const spellcheck = usePrefs((s) => s.spellcheck);
  const autocorrect = usePrefs((s) => s.autocorrect);
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(pending.title);
  useAutoGrow(input);
  useAutoGrow(body);
  const error = title.trim() === '' ? null : validateNewName(`${title.trim()}.${pending.extension}`);
  const note = pending.extension === 'md';
  const kind = pending.label.charAt(0).toUpperCase() + pending.label.slice(1);
  const width = noteWidthProps(settings.editor);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (!error) updatePendingTitle(pending.id, title, true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // A note's writing continues in its body, focused inside the key press so the iOS keyboard
      // stays up; the title's blur commits it. An invalid name stays with its message.
      if (note && !error && body.current) body.current.focus();
      else commit();
    }
  };

  const keepBody = (el: HTMLTextAreaElement) => setPendingBody(pending.id, { text: el.value, selectionStart: el.selectionStart, selectionEnd: el.selectionEnd });

  return (
    <div className={`markdown-view${width.className}`} style={width.style} aria-busy="true">
      <header className="note-header">
        <div className="inline-title-wrap">
          <h1 className="inline-title">
            <textarea
              ref={input}
              className="inline-title-input"
              rows={1}
              value={title}
              aria-label={`${kind} title`}
              aria-invalid={!!error}
              spellCheck={false}
              autoCapitalize="sentences"
              enterKeyHint={note ? 'next' : 'done'}
              readOnly={pending.committed}
              onChange={(e) => {
                setTitle(e.target.value);
                autoGrow(e.target);
                updatePendingTitle(pending.id, e.target.value, false);
                // onSelect follows the key, so the selection is kept with the text it belongs to.
                updatePendingSelection(pending.id, e.target.selectionStart, e.target.selectionEnd);
              }}
              onSelect={(e) => updatePendingSelection(pending.id, e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
              onKeyDown={onKeyDown}
              onBlur={(e) => {
                // A template's questions (a dialog over this view) take the focus for a moment and
                // give it back here when they close: the title is still being typed.
                if (e.relatedTarget instanceof Element && e.relatedTarget.closest('[role="dialog"]')) return;
                commit();
              }}
            />
          </h1>
          {error && (
            <p className="field-error inline-title-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </header>
      <p className="pending-note-hint muted">
        {pending.committed ? `Creating the ${pending.label}…` : note ? 'Name the new note, then start writing.' : `Name the new ${pending.label}, then press Enter to open it.`}
      </p>
      {note && (
        // Writing before the note exists (DESIGN §6.15): it moves into the note, caret and all.
        <textarea
          ref={body}
          className="pending-note-body"
          aria-label="Note text"
          placeholder="Start writing…"
          spellCheck={spellcheck}
          autoCorrect={autocorrect ? 'on' : 'off'}
          autoCapitalize="sentences"
          enterKeyHint="enter"
          onChange={(e) => {
            autoGrow(e.currentTarget);
            keepBody(e.currentTarget);
          }}
          onSelect={(e) => keepBody(e.currentTarget)}
        />
      )}
    </div>
  );
}
