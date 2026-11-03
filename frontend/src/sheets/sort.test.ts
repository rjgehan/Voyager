import { describe, expect, it } from 'vitest';
import { emptySheet, type Sheet, type SheetCell } from './format';
import { compareSortValues, sortRows } from './sort';

describe('compareSortValues', () => {
  it('orders numbers, text (without case, digits naturally), booleans and errors, blanks always last', () => {
    const values = ['b', null, 10, { e: '#N/A' }, 'A', true, 2, '', 'item 10', false, 'Item 9'];
    const asc = [...values].sort((a, b) => compareSortValues(a, b));
    expect(asc).toEqual([2, 10, 'A', 'b', 'Item 9', 'item 10', false, true, { e: '#N/A' }, null, '']);
    const desc = [...values].sort((a, b) => compareSortValues(a, b, true));
    expect(desc).toEqual([{ e: '#N/A' }, true, false, 'item 10', 'Item 9', 'b', 'A', 10, 2, null, '']);
  });
});

describe('sortRows', () => {
  const sheet = (cells: Record<string, SheetCell>): Sheet => ({ ...emptySheet('s1', 'S'), cells });

  it('sorts rows by their keys in turn, keeping the order of equal rows (stable)', () => {
    const s = sheet({ A1: { v: 'b' }, B1: { v: 2 }, A2: { v: 'a' }, B2: { v: 2 }, A3: { v: 'c' }, B3: { v: 1 }, A4: { v: 'd' } });
    expect(sortRows(s, [0, 1, 2, 3], [{ col: 1 }])).toEqual([2, 0, 1, 3]);
    expect(sortRows(s, [0, 1, 2, 3], [{ col: 1, desc: true }, { col: 0 }])).toEqual([1, 0, 2, 3]);
    // A formula sorts by its cached result.
    const f = sheet({ A1: { f: '=1+1', c: 2 }, A2: { v: 1 } });
    expect(sortRows(f, [0, 1], [{ col: 0 }])).toEqual([1, 0]);
  });
});
