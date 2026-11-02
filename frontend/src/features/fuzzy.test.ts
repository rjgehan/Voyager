import fuzzysort from 'fuzzysort';
import { describe, expect, it } from 'vitest';
import { fuzzyRank, SNAPSHOT_MIN_ITEMS } from './fuzzy';

interface Item {
  label: string;
  path: string;
  note: boolean;
}

const WORDS = ['copper', 'harbor', 'meeting', 'notes', 'budget', 'review', 'garden', 'recipe', 'café', 'Zürich', 'plan', 'q3'];

function items(count: number): Item[] {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, i) => {
    const label = `${WORDS[Math.floor(random() * WORDS.length)]} ${WORDS[Math.floor(random() * WORDS.length)]} ${i}`;
    const note = random() < 0.8;
    return { label, path: `Area ${i % 50}/${label}${note ? '.md' : '.png'}`, note };
  });
}

/** What fuzzyRank returned before snapshots: every match ranked, boosted, sorted. */
function reference(query: string, list: readonly Item[], limit: number): Array<{ item: Item; score: number }> {
  return fuzzysort
    .go(query, list, { keys: [(i: Item) => i.label, (i: Item) => i.path], threshold: 0, limit: 0 })
    .map((r) => ({ item: r.obj, score: r.score + (r.obj.note ? 0.05 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

describe('fuzzyRank over long lists', () => {
  it('ranks exactly as ranking every match does, boosts included', () => {
    const list = items(SNAPSHOT_MIN_ITEMS * 3);
    for (const query of ['c', 'co', 'cop', 'copper h', 'meeting notes 12', 'zur', 'cafe', 'png', 'area 7', 'xyz', 'q3 plan']) {
      const fast = fuzzyRank(query, list, [(i) => i.label, (i) => i.path], 50, (i) => (i.note ? 0.05 : 0));
      const slow = reference(query, list, 50);
      // Equal scores may come in either order; the scores, and the items at each score, are the same.
      expect(fast.map((r) => r.score)).toEqual(slow.map((r) => r.score));
      const byScore = (ranked: typeof fast) => ranked.map((r) => `${r.score} ${r.item.path}`).sort();
      if (fast.length === 50 && slow.length === 50) {
        // At the cut, which of several equal scores made it may differ: compare above the lowest score.
        const last = slow[49]!.score;
        expect(byScore(fast.filter((r) => r.score > last))).toEqual(byScore(slow.filter((r) => r.score > last)));
      } else {
        expect(byScore(fast)).toEqual(byScore(slow));
      }
    }
  });

  it('keeps its snapshots for the same array, and follows a new one', () => {
    const list = items(SNAPSHOT_MIN_ITEMS);
    const keys = [(i: Item) => i.label];
    const first = fuzzyRank('harbor', list, keys, 10).map((r) => r.item);
    expect(fuzzyRank('harbor', list, keys, 10).map((r) => r.item)).toEqual(first);
    const renamed = list.map((i) => (i === first[0] ? { ...i, label: 'nothing alike' } : i));
    expect(fuzzyRank('harbor', renamed, keys, 10).map((r) => r.item)).not.toContain(first[0]);
    // The same array with other boosts is grouped again.
    const tenth = first[9]!;
    const boosted = fuzzyRank('harbor', list, keys, 10, (i) => (i === tenth ? 1 : 0));
    expect(boosted[0]!.item).toBe(tenth);
  });
});
