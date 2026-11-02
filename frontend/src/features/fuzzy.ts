// fuzzysort wrappers (DESIGN §6.1: always `threshold: 0`).
import fuzzysort, { type SnapshotKeys } from 'fuzzysort';

export interface Ranked<T> {
  item: T;
  score: number;
}

/**
 * From this many items on, `fuzzyRank` searches immutable snapshots (fuzzysort prepares every target once, and narrows
 * the candidates as a query grows by a letter) and asks each boost group for its best `limit` only, instead of ranking
 * every match: the quick switcher and `[[` completion over a 10,000-note vault took 60 to 450 ms per keystroke on a
 * phone-speed CPU (docs/PERFORMANCE.md).
 */
export const SNAPSHOT_MIN_ITEMS = 1000;

interface Groups<T> {
  /** The boost of every item, as computed when the groups were made. */
  boosts: Float64Array;
  groups: Array<{ boost: number; snapshot: SnapshotKeys<T> }>;
}

/** Snapshots per items array: callers keep the array (of a tree, say) for as long as it does not change. */
const cache = new WeakMap<object, unknown>();

function groupsOf<T>(items: readonly T[], keys: ReadonlyArray<(item: T) => string>, boost?: (item: T) => number): Groups<T> {
  const boosts = Float64Array.from(items, (item) => (boost ? boost(item) : 0));
  const cached = cache.get(items) as Groups<T> | undefined;
  if (cached && cached.boosts.length === boosts.length && cached.boosts.every((b, i) => b === boosts[i])) return cached;
  const members = new Map<number, T[]>();
  items.forEach((item, i) => {
    const list = members.get(boosts[i]!);
    if (list) list.push(item);
    else members.set(boosts[i]!, [item]);
  });
  const made: Groups<T> = {
    boosts,
    groups: [...members].map(([b, list]) => ({ boost: b, snapshot: fuzzysort.snapshot(list, { keys: keys.map((k) => (item: T) => k(item)) }) })),
  };
  cache.set(items, made);
  return made;
}

/**
 * Ranks `items` by fuzzy match over `keys`; `boost` adjusts an item's score (e.g. +0.05 for notes). A long list is
 * searched through snapshots kept for the array, so pass the same array again while the items are the same.
 */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  keys: ReadonlyArray<(item: T) => string>,
  limit: number,
  boost?: (item: T) => number,
): Ranked<T>[] {
  if (items.length >= SNAPSHOT_MIN_ITEMS) {
    // Within a group every item has the same boost, so the best `limit` overall are among each group's best `limit`.
    const ranked: Ranked<T>[] = [];
    for (const group of groupsOf(items, keys, boost).groups) {
      for (const r of fuzzysort.go(query, group.snapshot, { threshold: 0, limit })) ranked.push({ item: r.obj, score: r.score + group.boost });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  }
  const results = fuzzysort.go(query, items, {
    keys: keys.map((k) => (item: T) => k(item)),
    threshold: 0,
    limit: boost ? 0 : limit,
  });
  const ranked = results.map((r) => ({ item: r.obj, score: r.score + (boost ? boost(r.obj) : 0) }));
  if (boost) ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

/** Ranks plain strings. */
export function fuzzyStrings(query: string, items: readonly string[], limit: number): string[] {
  return fuzzysort.go(query, items, { threshold: 0, limit }).map((r) => r.target);
}
