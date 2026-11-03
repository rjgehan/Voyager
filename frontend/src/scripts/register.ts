// Scripts in notes (ROADMAP items 40 and 17, DESIGN §6.43) through the extension points of DESIGN
// §6.8: event handlers that make the results of the scripts that read a changed note stale (the
// showing ones run again, debounced: editor/livePreview/scripts.ts), and the `/` menu's
// "Script block" and "Dataview query". This page's own saves, creates, moves and deletes come back
// without an event (API.md §16.4), so the notes' versions in the tree, which they patch, are
// watched too.
// Always loaded (extensions/builtins.ts), so it imports no editor code: the editor's chunk brings
// the blocks' runs (invalidation reaches them through ./invalidation) and insertBlock (editor/kit.ts).
import type { QueryClient } from '@tanstack/react-query';
import { queryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import type { TreeResponse } from '../api/types';
import { editorKit } from '../editor/kitHandle';
import { registerSlashItem } from '../editor/slashRegistry';
import { registerEventHandler } from '../extensions';
import { invalidateLoadedScripts } from './invalidation';

/** The paths an event changed, or null when it may have changed any note (a folder, a resync). */
export function changedPaths(name: string, data: unknown): string[] | null {
  const d = (data ?? {}) as { path?: unknown; file?: { path?: unknown }; from?: unknown; to?: unknown; type?: unknown };
  switch (name) {
    case 'file.created':
    case 'file.changed':
      return typeof d.file?.path === 'string' ? [d.file.path] : null;
    case 'file.deleted':
      return typeof d.path === 'string' ? [d.path] : null;
    case 'entry.moved':
      return d.type === 'file' && typeof d.from === 'string' && typeof d.to === 'string' ? [d.from, d.to] : null;
    default:
      return null;
  }
}

const EVENTS = ['file.created', 'file.changed', 'file.deleted', 'entry.moved', 'folder.deleted', 'resync'];

export const SCRIPT_TEMPLATE = '```script\nshow("Today is " + today().format("dddd D MMMM"))\n```';
export const DATAVIEW_TEMPLATE = '```dataview\nTABLE file.mtime AS "Modified"\nSORT file.mtime DESC\nLIMIT 10\n```';

let registered = false;

const isNote = (path: string) => path.toLowerCase().endsWith('.md');

/** The notes of a tree snapshot: path → version. */
function noteVersions(tree: TreeResponse): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const f of tree.files) if (isNote(f.path)) out.set(f.path, f.version);
  return out;
}

/** The notes whose version differs between two snapshots, or that only one of them has. */
export function changedNotes(before: ReadonlyMap<string, string | null>, after: ReadonlyMap<string, string | null>): string[] {
  const out: string[] = [];
  for (const [path, version] of after) if (!before.has(path) || before.get(path) !== version) out.push(path);
  for (const path of before.keys()) if (!after.has(path)) out.push(path);
  return out;
}

/**
 * Makes the results that read a note stale whenever the tree shows it changed, appeared or went
 * away: another device's change (its event patches the tree as well; the second invalidation
 * changes nothing) and this page's own writes alike. Returns the unsubscription (tests).
 */
export function watchNoteVersions(qc: QueryClient): () => void {
  const tree = qc.getQueryData<TreeResponse>(queryKeys.tree());
  let known: Map<string, string | null> | null = tree ? noteVersions(tree) : null;
  return qc.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] !== 'tree') return;
    if (event.type === 'removed') {
      known = null;
      return;
    }
    if (event.type !== 'updated') return;
    const data = event.query.state.data as TreeResponse | undefined;
    if (!data) return;
    const now = noteVersions(data);
    const before = known;
    known = now;
    // The first tree: nothing has run against an older one.
    if (before === null) return;
    const changed = changedNotes(before, now);
    if (changed.length > 0) invalidateLoadedScripts(changed);
  });
}

export function registerScripts(): void {
  if (registered) return;
  registered = true;
  for (const name of EVENTS) {
    registerEventHandler(name, (data) => {
      const paths = changedPaths(name, data);
      // Only notes are read by scripts; another file's change matters only when it is unknown.
      if (paths && paths.every((p) => !p.toLowerCase().endsWith('.md'))) return;
      invalidateLoadedScripts(paths);
    });
  }
  watchNoteVersions(queryClient);
  registerSlashItem({
    id: 'script',
    label: 'Script block',
    keywords: 'script javascript js code run compute',
    group: 'Block',
    scope: 'block',
    order: 29.5,
    run: (v) => void editorKit()?.insertBlock(v, SCRIPT_TEMPLATE, '```script\n'.length),
  });
  registerSlashItem({
    id: 'dataview',
    label: 'Dataview query',
    keywords: 'dataview query table list task dql',
    group: 'Block',
    scope: 'block',
    order: 29.6,
    run: (v) => void editorKit()?.insertBlock(v, DATAVIEW_TEMPLATE, '```dataview\n'.length),
  });
}
