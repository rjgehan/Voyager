import { describe, expect, it } from 'vitest';
import { shiftFormula } from '../refs';
import { externalRefs, fileSheet, noteCalls, parseNoteQuery, queryColumns, rewriteExternalRefs, usesNoteFunctions } from './syntax';

describe('note function calls', () => {
  it('finds calls with their literal arguments, nested ones included', () => {
    expect(noteCalls('=NOTEPROP("Projects/Plan", "status")')).toEqual([{ name: 'NOTEPROP', args: ['Projects/Plan', 'status'] }]);
    expect(noteCalls('=IF(notecount("tag:work")>2, NOTETABLE("Say ""hi""", B2), 0)')).toEqual([
      { name: 'NOTECOUNT', args: ['tag:work'] },
      { name: 'NOTETABLE', args: ['Say "hi"', null] },
    ]);
    expect(noteCalls('=NOTEQUERY()')).toEqual([{ name: 'NOTEQUERY', args: [] }]);
  });

  it('ignores strings, other functions and text that is not a formula', () => {
    expect(noteCalls('="NOTEPROP(x)"')).toEqual([]);
    expect(noteCalls('=MYNOTEPROP(1)')).toEqual([]);
    expect(noteCalls('NOTEPROP("a","b")')).toEqual([]);
    expect(usesNoteFunctions('=SUM(A1:A3)')).toBe(false);
    expect(usesNoteFunctions('=1+NOTECOUNT("#x")')).toBe(true);
  });
});

describe('references to spreadsheet files', () => {
  it('reads files, sheets, cells, ranges and named ranges', () => {
    const refs = externalRefs("=Budget.sheet!B10+SUM('Finance/Budget.sheet#Summary'!$A$1:B3)*Budget.sheet!Total");
    expect(refs.map(({ file, sheet, target }) => ({ file, sheet, target }))).toEqual([
      { file: 'Budget.sheet', sheet: null, target: 'B10' },
      { file: 'Finance/Budget.sheet', sheet: 'Summary', target: '$A$1:B3' },
      { file: 'Budget.sheet', sheet: null, target: 'Total' },
    ]);
    expect(externalRefs('=SUM(Budget.sheet!A:A)')[0].target).toBe('A:A');
    expect(externalRefs('=SUM(Budget.sheet!2:5)')[0].target).toBe('2:5');
  });

  it("leaves the note's own tables, strings and functions alone", () => {
    expect(externalRefs('=budget!B5+Table1!A1')).toEqual([]);
    expect(externalRefs('="Budget.sheet!B10"')).toEqual([]);
    expect(fileSheet('budget')).toBeNull();
    expect(fileSheet('.sheet')).toBeNull();
    expect(fileSheet('Budget.SHEET#')).toEqual({ file: 'Budget.SHEET', sheet: null });
  });

  it('rewrites each reference and keeps the rest of the formula', () => {
    expect(rewriteExternalRefs('=Budget.sheet!B10*2+budget!A1', (r) => `'X'!${r.target}`)).toBe("='X'!B10*2+budget!A1");
    expect(rewriteExternalRefs('=1', () => 'never')).toBe('=1');
  });

  it('moves with fill like any reference (item 39), the file staying', () => {
    expect(shiftFormula('=Budget.sheet!B2*2', 1, 0)).toBe('=Budget.sheet!B3*2');
    expect(shiftFormula("='Budget.sheet#Summary'!$B$2+Budget.sheet!C2", 2, 1)).toBe("='Budget.sheet#Summary'!$B$2+Budget.sheet!D4");
  });
});

describe('note queries', () => {
  it('reads tags, folders, links, properties and search words', () => {
    expect(parseNoteQuery('tag:work #home folder:Projects status=open priority!=low prop:due [[Plan]] "weekly review" -draft')).toEqual({
      tag: ['work', 'home'],
      folder: 'Projects',
      prop: ['status=open', 'priority!=low', 'due'],
      linksTo: 'Plan',
      q: '"weekly review" -draft',
    });
    expect(parseNoteQuery('')).toEqual({ tag: [], folder: null, prop: [], linksTo: null, q: null });
    expect(parseNoteQuery('folder:"My notes" links:Plan').folder).toBe('My notes');
    expect(parseNoteQuery('status="in progress"').prop).toEqual(['status=in progress']);
  });

  it('reads columns', () => {
    expect(queryColumns('title, status ,due')).toEqual(['title', 'status', 'due']);
    expect(queryColumns('')).toEqual(['title']);
  });
});
