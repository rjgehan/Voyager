import { describe, expect, it } from 'vitest';
import { emptySheet, type SheetFile } from './format';
import { findMatches, findPattern, replaceEdit } from './find';

const FILE: SheetFile = {
  type: 'notesapp-sheet',
  version: 1,
  engine: '',
  named: {},
  sheets: [
    {
      ...emptySheet('s1', 'Budget'),
      cells: {
        A1: { v: 'Rent' },
        B1: { v: 1450, fmt: '$#,##0.00' },
        A2: { v: 'rent deposit' },
        B2: { f: '=B1*2', c: 2900 },
        A3: { v: 'Food' },
        C3: { f: '=SUM(B1:B2)', c: 4350 },
      },
    },
    { ...emptySheet('s2', 'Notes'), cells: { A1: { v: 'Rent is due' } } },
  ],
};

const refs = (ms: ReturnType<typeof findMatches>) => ms.map((m) => `${m.sheet}:${String.fromCharCode(65 + m.col)}${m.row + 1}`);

describe('find', () => {
  it('finds cells by the text they show, without case, row by row, on the open sheet or all', () => {
    expect(refs(findMatches(FILE, 's1', { query: 'rent' }))).toEqual(['s1:A1', 's1:A2']);
    expect(refs(findMatches(FILE, 's1', { query: 'rent', allSheets: true }))).toEqual(['s1:A1', 's1:A2', 's2:A1']);
    expect(refs(findMatches(FILE, 's1', { query: 'Rent', matchCase: true }))).toEqual(['s1:A1']);
    expect(refs(findMatches(FILE, 's1', { query: 'rent', wholeCell: true }))).toEqual(['s1:A1']);
    // As the number shows, and a formula by its result unless formulas are searched.
    expect(refs(findMatches(FILE, 's1', { query: '1,450' }))).toEqual(['s1:B1']);
    expect(refs(findMatches(FILE, 's1', { query: 'SUM' }))).toEqual([]);
    expect(refs(findMatches(FILE, 's1', { query: 'SUM', formulas: true }))).toEqual(['s1:C3']);
    expect(refs(findMatches(FILE, 's1', { query: '^r.*t$', regex: true }))).toEqual(['s1:A1', 's1:A2']);
    expect(findPattern({ query: '(', regex: true })).toBeNull();
    expect(findMatches(FILE, 's1', { query: '' })).toEqual([]);
  });

  it('replaces in what a cell holds: text, a number as typed, or a formula with formulas searched', () => {
    const at = (sheet: string, col: number, row: number) => ({ sheet, col, row });
    expect(replaceEdit(FILE, at('s1', 0, 1), { query: 'rent' }, 'Rent')).toEqual({ sheet: 's1', ref: 'A2', content: { v: 'Rent deposit' } });
    // `1450` is written so: replacing 45 gives the number 1500 (its format stays with the cell).
    expect(replaceEdit(FILE, at('s1', 1, 0), { query: '45' }, '50')).toEqual({ sheet: 's1', ref: 'B1', content: { v: 1500 } });
    // Only the shown text matches ("1,450"): nothing to replace in what the cell holds.
    expect(replaceEdit(FILE, at('s1', 1, 0), { query: '1,4' }, 'x')).toBeNull();
    expect(replaceEdit(FILE, at('s1', 2, 2), { query: 'SUM' }, 'AVERAGE')).toBeNull();
    expect(replaceEdit(FILE, at('s1', 2, 2), { query: 'SUM', formulas: true }, 'AVERAGE')).toEqual({ sheet: 's1', ref: 'C3', content: { f: '=AVERAGE(B1:B2)' } });
    // `$` is literal unless the query is an expression, where `$1` is a group.
    expect(replaceEdit(FILE, at('s1', 0, 0), { query: 'Rent' }, 'R$1')).toEqual({ sheet: 's1', ref: 'A1', content: { v: 'R$1' } });
    expect(replaceEdit(FILE, at('s1', 0, 1), { query: '(rent) (deposit)', regex: true }, '$2 $1')).toEqual({ sheet: 's1', ref: 'A2', content: { v: 'deposit rent' } });
  });

  it('replaces in text that looks like a number, keeping it text, with Match entire cell or an anchored expression', () => {
    const file: SheetFile = { ...FILE, sheets: [{ ...emptySheet('s1', 'Zip'), cells: { A1: { v: '02139' }, A2: { v: 'TRUE' }, A3: { v: '10%' }, A4: { v: '1/2' } } }] };
    const at = (row: number) => ({ sheet: 's1', col: 0, row });
    expect(refs(findMatches(file, 's1', { query: '02139', wholeCell: true }))).toEqual(['s1:A1']);
    expect(replaceEdit(file, at(0), { query: '02139', wholeCell: true }, '02140')).toEqual({ sheet: 's1', ref: 'A1', content: { v: '02140' } });
    expect(replaceEdit(file, at(0), { query: '^0', regex: true }, '1')).toEqual({ sheet: 's1', ref: 'A1', content: { v: '12139' } });
    expect(replaceEdit(file, at(0), { query: '021' }, '031')).toEqual({ sheet: 's1', ref: 'A1', content: { v: '03139' } });
    expect(replaceEdit(file, at(1), { query: 'TRUE', wholeCell: true }, 'FALSE')).toEqual({ sheet: 's1', ref: 'A2', content: { v: 'FALSE' } });
    expect(replaceEdit(file, at(2), { query: '10%', wholeCell: true }, '20%')).toEqual({ sheet: 's1', ref: 'A3', content: { v: '20%' } });
    expect(replaceEdit(file, at(3), { query: '^1/', regex: true }, '3/')).toEqual({ sheet: 's1', ref: 'A4', content: { v: '3/2' } });
  });
});
