import { describe, expect, it } from 'vitest';
import { displaySnippet } from './snippetText';

// A task's related note is indexed as a Markdown link (TaskDocumentIndexer): search matches and
// backlink contexts show its label, not the raw link with its percent-encoded path (QA finding F9).
const RAW = '[Home renovation](/Projects/Home%20renovation.md)';

describe('displaySnippet', () => {
  it('shows a Markdown link as its label, with a highlight in the label kept on the same words', () => {
    expect(displaySnippet(RAW, [{ from: 6, to: 16 }])).toEqual({ text: 'Home renovation', ranges: [{ from: 5, to: 15 }] });
  });

  it('a highlight over the whole link covers the label', () => {
    expect(displaySnippet(RAW, [{ from: 0, to: RAW.length }])).toEqual({ text: 'Home renovation', ranges: [{ from: 0, to: 15 }] });
  });

  it('a highlight inside the destination moves onto the label', () => {
    expect(displaySnippet(RAW, [{ from: 30, to: 40 }])).toEqual({ text: 'Home renovation', ranges: [{ from: 0, to: 15 }] });
  });

  it('shifts highlights after a link, and handles tags and several links on a line', () => {
    const line = '#diy [Home renovation](/Projects/Home%20renovation.md) and [Tiles](</Shop/Tiles list.md> "t") tiles';
    const out = displaySnippet(line, [
      { from: 1, to: 4 },
      { from: line.length - 5, to: line.length },
    ]);
    expect(out.text).toBe('#diy Home renovation and Tiles tiles');
    expect(out.ranges).toEqual([
      { from: 1, to: 4 },
      { from: out.text.length - 5, to: out.text.length },
    ]);
  });

  it('leaves text without links, images and wikilinks as it is', () => {
    for (const text of ['We receive a jam', 'An image ![alt](a.png) here', 'See [[Projects/Plan|the plan]]', 'Brackets [x] and (y)']) {
      expect(displaySnippet(text, [{ from: 0, to: 2 }])).toEqual({ text, ranges: [{ from: 0, to: 2 }] });
    }
  });
});
