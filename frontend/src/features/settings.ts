import type { CSSProperties } from 'react';
import type { Settings } from '../api/types';

/** Vault settings defaults (DESIGN §5.12), used until GET /api/settings answers. */
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  files: {
    newNoteLocation: 'root',
    newNoteFolder: '',
    newLinkFormat: 'shortest',
    useWikilinks: true,
    attachmentLocation: 'folder',
    attachmentFolder: 'Attachments',
    attachmentSubfolder: 'attachments',
    autoUpdateLinks: true,
    excludedPaths: [],
  },
  dailyNotes: { format: 'YYYY-MM-DD', folder: 'Daily', template: '', openOnStartup: false },
  templates: { folder: 'Templates', dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm', folderTemplates: [] },
  editor: { defaultMode: 'edit', noteWidth: 600, strictLineBreaks: false },
  ai: { enabled: false, provider: 'claude-code', model: 'claude-sonnet-5-5', excludedPaths: ['Private'], maxContextChars: 60000, monthlyBudgetUsd: 5 },
  reminders: { webPush: false, ntfy: false, ntfyTitleOnly: true, inApp: false, dailyNote: false, dailyNoteTime: '09:00' },
};

/** `editor.noteWidth` (DESIGN §6.6): 600 to 1400 CSS pixels, or 'full' for the whole pane. */
export const NOTE_WIDTH_MIN = 600;
export const NOTE_WIDTH_MAX = 1400;
export const NOTE_WIDTH_STEP = 50;

/**
 * The note width the settings ask for. Settings from an older server have `readableLineLength`
 * instead (on: the readable width, off: full).
 */
export function noteWidth(editor: Settings['editor']): number | 'full' {
  const width: unknown = (editor as Partial<Settings['editor']>).noteWidth;
  if (width === 'full') return 'full';
  if (typeof width === 'number' && Number.isFinite(width)) return Math.min(NOTE_WIDTH_MAX, Math.max(NOTE_WIDTH_MIN, Math.round(width)));
  return (editor as { readableLineLength?: unknown }).readableLineLength === false ? 'full' : NOTE_WIDTH_MIN;
}

/** A note column's class and style: `is-readable` capped at `--note-width`, or nothing at full width. */
export function noteWidthProps(editor: Settings['editor']): { className: string; style: CSSProperties | undefined } {
  const width = noteWidth(editor);
  if (width === 'full') return { className: '', style: undefined };
  return { className: ' is-readable', style: { '--note-width': `${width}px` } as CSSProperties };
}
