// Periods for the vault history page (ROADMAP item 28): local-time boundaries as ISO instants,
// for the `since` filter of GET /api/history/log and /changes (API.md §14.6–14.7).
import type { HistoryEntry, TimelineEntry, TimelineFile } from '../api/types';

export type Period = 'today' | 'week' | 'month' | '30d' | 'all';

export const PERIODS: ReadonlyArray<{ id: Period; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
];

/** The start of a period in local time (weeks start on Monday), or undefined for all time. */
export function periodStart(period: Period, now = new Date()): string | undefined {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':
      break;
    case 'week':
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      break;
    case 'month':
      start.setDate(1);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
    case 'all':
      return undefined;
  }
  return start.toISOString();
}

/** Commits grouped by local day, newest first, keeping their order. */
export function groupByDay<T extends { time: string }>(items: readonly T[]): Array<{ day: string; items: T[] }> {
  const groups: Array<{ day: string; items: T[] }> = [];
  for (const item of items) {
    const d = new Date(item.time);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

/** A timeline file as the history version view takes it. */
export function historyEntryOf(commit: TimelineEntry, file: TimelineFile): HistoryEntry {
  return {
    commitId: commit.commitId,
    shortId: commit.shortId,
    parentCommitId: commit.parentCommitId,
    path: file.path,
    time: commit.time,
    authorName: commit.authorName,
    authorLogin: commit.authorLogin,
    message: commit.message,
    change: file.change,
    renamedFrom: file.renamedFrom,
  };
}

/**
 * Where a file at `path` in commit `commitId` is now, as far as the loaded timeline shows:
 * renames in later commits are followed (newest first in `entries`, as the log returns them).
 * `null` when a later commit deleted it; `path` itself when nothing later touched it.
 */
export function laterPathOf(entries: readonly TimelineEntry[], commitId: string, path: string): string | null {
  const index = entries.findIndex((e) => e.commitId === commitId);
  let current = path;
  for (let i = index - 1; i >= 0; i--) {
    for (const f of entries[i].files) {
      if (f.change === 'renamed' && f.renamedFrom === current) {
        current = f.path;
        break;
      }
      if (f.change === 'deleted' && f.path === current) return null;
    }
  }
  return current;
}
