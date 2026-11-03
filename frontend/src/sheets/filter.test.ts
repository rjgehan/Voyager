import { describe, expect, it } from 'vitest';
import { describeCondition, meetsCondition } from './conditions';
import { dataRegion, filterValues, filterView, looksLikeHeader, rowShows } from './filter';
import { emptySheet, type Sheet, type SheetCell, type SheetFilter } from './format';

function sheet(cells: Record<string, SheetCell>, filter?: SheetFilter): Sheet {
  return { ...emptySheet('s1', 'S'), cells, ...(filter ? { filter } : {}) };
}

/** Item / Cost / Status, rows 2–6, a total below. */
const DATA: Record<string, SheetCell> = {
  A1: { v: 'Item' },
  B1: { v: 'Cost' },
  C1: { v: 'Status' },
  A2: { v: 'Rent' },
  B2: { v: 1450 },
  C2: { v: 'Open' },
  A3: { v: 'Food' },
  B3: { v: 300, fmt: '$#,##0' },
  C3: { v: 'Done' },
  A4: { v: 'Gym' },
  B4: { v: 45 },
  A5: { v: 'Power' },
  B5: { f: '=100+20', c: 120 },
  C5: { v: 'Open' },
  A6: { v: 'Books' },
  B6: { v: 60 },
  C6: { v: 'Done' },
  A8: { v: 'Total' },
};

describe('conditions', () => {
  it('compare text without case, numbers as typed input, and empty cells', () => {
    expect(meetsCondition({ when: 'contains', value: 'EN' }, 'Rent', 'Rent')).toBe(true);
    expect(meetsCondition({ when: 'startsWith', value: 'r' }, 'Rent', 'Rent')).toBe(true);
    expect(meetsCondition({ when: 'textIs', value: 'ren' }, 'Rent', 'Rent')).toBe(false);
    expect(meetsCondition({ when: 'gt', value: '100' }, 120, '120')).toBe(true);
    expect(meetsCondition({ when: 'gt', value: '100' }, 'x', 'x')).toBe(false);
    expect(meetsCondition({ when: 'lte', value: '50%' }, 0.5, '50%')).toBe(true);
    expect(meetsCondition({ when: 'between', value: '10', value2: '1' }, 5, '5')).toBe(true);
    expect(meetsCondition({ when: 'notBetween', value: '1', value2: '10' }, 5, '5')).toBe(false);
    expect(meetsCondition({ when: 'gt', value: '2026-10-01' }, 46300, '2026-10-05')).toBe(true);
    expect(meetsCondition({ when: 'eq', value: 'open' }, 'Open', 'Open')).toBe(true);
    expect(meetsCondition({ when: 'neq', value: '5' }, 5, '5')).toBe(false);
    expect(meetsCondition({ when: 'empty' }, null, '')).toBe(true);
    expect(meetsCondition({ when: 'notEmpty' }, '', '')).toBe(false);
    expect(meetsCondition({}, 1, '1')).toBe(true);
    expect(describeCondition({ when: 'between', value: '1', value2: '5' })).toBe('Is between 1 and 5');
  });
});

describe('filterView', () => {
  it('hides rows by values (as they show) and by condition, below the header row', () => {
    const s = sheet(DATA, { range: 'A1:C6', cols: { C: { hide: ['Done'] }, B: { when: 'gt', value: '100' } } });
    expect(filterView(s)).toEqual({ start: 1, end: 5, rows: [1, 4] });
    expect(rowShows(s, s.filter!, 3)).toBe(false);
    // Blanks are hidden as "".
    const blanks = sheet(DATA, { range: 'A1:C6', cols: { C: { hide: [''] } } });
    expect(filterView(blanks)?.rows).toEqual([1, 2, 4, 5]);
  });

  it('sorts the rows that show, blanks last, without moving any cell', () => {
    const s = sheet(DATA, { range: 'A1:C6', sort: { col: 'B', desc: true }, cols: {} });
    expect(filterView(s)?.rows).toEqual([1, 2, 4, 5, 3]);
    const byStatus = sheet(DATA, { range: 'A1:C6', sort: { col: 'C' }, cols: { A: { when: 'notContains', value: 'o' } } });
    expect(filterView(byStatus)?.rows).toEqual([1, 3]);
  });

  it('shows everything as it is without conditions or a sort, and leaves frozen rows alone', () => {
    expect(filterView(sheet(DATA, { range: 'A1:C6', cols: { C: {} } }))).toBeNull();
    expect(filterView(sheet(DATA))).toBeNull();
    const s = sheet(DATA, { range: 'A1:C6', cols: { C: { hide: ['Done'] } } });
    expect(filterView(s, 3)).toEqual({ start: 3, end: 5, rows: [3, 4] });
  });

  it('lists a column’s values as they show, with counts, in sort order', () => {
    const s = sheet(DATA, { range: 'A1:C6', cols: {} });
    expect(filterValues(s, s.filter!, 2).map((v) => [v.text, v.count])).toEqual([
      ['Done', 2],
      ['Open', 2],
      ['', 1],
    ]);
    expect(filterValues(s, s.filter!, 1).map((v) => v.text)).toEqual(['45', '60', '120', '$300', '1450']);
  });
});

describe('the data region around a cell', () => {
  it('grows through touching cells, and stops at empty rows and columns', () => {
    const s = sheet({ ...DATA, E1: { v: 'apart' } });
    expect(dataRegion(s, 1, 2)).toEqual({ col: 0, row: 0, width: 3, height: 6 });
    expect(dataRegion(s, 0, 7)).toEqual({ col: 0, row: 7, width: 1, height: 1 });
    expect(dataRegion(s, 4, 0)).toEqual({ col: 4, row: 0, width: 1, height: 1 });
    expect(looksLikeHeader(s, { col: 0, row: 0, width: 3, height: 6 })).toBe(true);
    expect(looksLikeHeader(s, { col: 0, row: 1, width: 1, height: 5 })).toBe(false);
  });
});
