import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownNoteLanguage } from './language';
import { smartPunctuationGuard } from './smartPunctuation';
import { cellLanguage } from './livePreview/table';
import { tableCellHost } from './livePreview/table/facets';

/** Simulates iOS replacing the text before the cursor with a smart character. */
function typeSmart(doc: string, cursor: number, replaceFrom: number, insert: string): string {
  let state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdownNoteLanguage(), smartPunctuationGuard] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  state = state.update({}).state;
  state = state.update({ changes: { from: replaceFrom, to: cursor, insert }, userEvent: 'input.type' }).state;
  return state.doc.toString();
}

describe('smartPunctuationGuard', () => {
  it('reverts an em dash typed as -- at the start of a line', () => {
    expect(typeSmart('-', 1, 0, '—')).toBe('--');
  });

  it('reverts curly quotes inside frontmatter', () => {
    const doc = '---\ntags: \n---\nBody';
    const at = doc.indexOf('tags: ') + 6;
    expect(typeSmart(doc, at, at, '“')).toBe('---\ntags: "\n---\nBody');
  });

  it('reverts curly quotes inside inline code', () => {
    const doc = 'a `x` b';
    expect(typeSmart(doc, 4, 4, '’')).toBe("a `x'` b");
  });

  it('keeps smart punctuation in ordinary prose', () => {
    expect(typeSmart('He said ', 8, 8, '“')).toBe('He said “');
    expect(typeSmart('a -', 3, 2, '—')).toBe('a —');
  });
});

describe('smartPunctuationGuard in a table cell (ROADMAP 39)', () => {
  /** iOS typing a smart character into a table cell's editor holding `doc`. */
  function typeInCell(doc: string, insert: string): string {
    const host = new EditorView({ doc: '' });
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [cellLanguage, tableCellHost.of(host), smartPunctuationGuard] });
    const next = state.update({ changes: { from: doc.length, insert }, userEvent: 'input.type' }).state.doc.toString();
    host.destroy();
    return next;
  }

  it('keeps a formula’s quotes straight, so its text and sheet names still read', () => {
    expect(typeInCell('=IF(A2>0,', '“')).toBe('=IF(A2>0,"');
    expect(typeInCell('=IF(A2>0,"yes', '”')).toBe('=IF(A2>0,"yes"');
    expect(typeInCell(' =', '‘')).toBe(" ='");
  });

  it('leaves a cell of text alone', () => {
    expect(typeInCell('He said ', '“')).toBe('He said “');
  });
});
