import { describe, expect, it } from 'vitest';
import { shownCell } from './display';
import { Workbook } from './engine';
import { cellValue, parseSheet, type SheetCell } from './format';
import { pivotTable } from './pivot';

const DATA: Record<string, SheetCell> = {
  A1: { v: 'Category' },
  B1: { v: 'Month' },
  C1: { v: 'Cost' },
  A2: { v: 'Home' },
  B2: { v: 'Jan' },
  C2: { v: 1450, fmt: '$#,##0' },
  A3: { v: 'Living' },
  B3: { v: 'Jan' },
  C3: { v: 300 },
  A4: { v: 'home' },
  B4: { v: 'Feb' },
  C4: { v: 120 },
  A5: { v: 'Living' },
  B5: { v: 'Feb' },
  C5: { v: 60 },
};

function workbook(cells: Record<string, SheetCell> = DATA, name = 'My data'): Workbook {
  const parsed = parseSheet(JSON.stringify({ type: 'notesapp-sheet', version: 1, engine: '', sheets: [{ id: 's1', name, cells }], named: {} }));
  if (!parsed.ok) throw new Error(parsed.error);
  return Workbook.open(parsed.file);
}

/** Puts a pivot table on a new sheet and returns its shown values, row by row. */
function made(opts: Parameters<typeof pivotTable>[1], cells?: Record<string, SheetCell>, name?: string): Array<Array<string | number | boolean | null>> {
  const wb = workbook(cells, name);
  const table = pivotTable(wb.file.sheets[0], opts);
  const id = wb.addSheet('Pivot');
  wb.setCells(Object.entries(table.cells).map(([ref, c]) => ({ sheet: id, ref, content: c.f !== undefined ? { f: c.f } : { v: c.v as string | number }, fmt: c.fmt })));
  return Array.from({ length: table.height }, (_, r) =>
    Array.from({ length: table.width }, (_, c) => {
      const v = cellValue(wb.cell(id, String.fromCharCode(65 + c) + (r + 1)));
      return typeof v === 'object' && v !== null ? v.e : v;
    }),
  );
}

const range = { col: 0, row: 0, width: 3, height: 5 };

describe('pivot tables', () => {
  it('sums a column by the groups of another, with a grand total, as live formulas', () => {
    expect(made({ range, rows: 0, values: 2, summary: 'SUM' })).toEqual([
      ['Category', 'SUM of Cost'],
      ['Home', 1570],
      ['Living', 360],
      ['Grand total', 1930],
    ]);
    const table = pivotTable(workbook().file.sheets[0], { range, rows: 0, values: 2, summary: 'SUM' });
    expect(table.cells.B2).toEqual({ f: "=SUMIFS('My data'!$C$2:$C$5, 'My data'!$A$2:$A$5, $A2)", fmt: '$#,##0' });
    expect(table.boldRows).toEqual([0, 3]);
  });

  it('spreads a second column’s groups across, and counts, averages or takes the extremes', () => {
    expect(made({ range, rows: 0, cols: 1, values: 2, summary: 'SUM' })).toEqual([
      ['Category', 'Feb', 'Jan', 'Grand total'],
      ['Home', 120, 1450, 1570],
      ['Living', 60, 300, 360],
      ['Grand total', 180, 1750, 1930],
    ]);
    expect(made({ range, rows: 1, values: 2, summary: 'COUNT' })).toEqual([
      ['Month', 'COUNT of Cost'],
      ['Feb', 2],
      ['Jan', 2],
      ['Grand total', 4],
    ]);
    expect(made({ range, rows: 0, values: 2, summary: 'AVERAGE' })[1]).toEqual(['Home', 785]);
    expect(made({ range, rows: 0, cols: 1, values: 2, summary: 'AVERAGE' })[2]).toEqual(['Living', 60, 300, 180]);
    expect(made({ range, rows: 0, values: 2, summary: 'MAX' })[2]).toEqual(['Living', 300]);
    expect(made({ range, rows: 0, values: 2, summary: 'MIN' })[3]).toEqual(['Grand total', 60]);
  });

  it('matches groups exactly: comparison signs, wildcards and a text 1 beside a number 1 are plain values', () => {
    const bands: Array<[string | number, number]> = [
      ['<18', 10], ['<18', 5], ['18-64', 20], ['>65', 30], ['Misc*', 7], ['Misc stuff', 8], ['1', 1], [1, 2], ['=x', 4], ['Food?', 6], ['Food!', 9],
    ];
    const cells: Record<string, SheetCell> = { A1: { v: 'Band' }, B1: { v: 'Amount' } };
    bands.forEach(([band, amount], i) => {
      cells[`A${i + 2}`] = { v: band };
      cells[`B${i + 2}`] = { v: amount };
    });
    const r = { col: 0, row: 0, width: 2, height: bands.length + 1 };
    const of = (summary: 'SUM' | 'COUNT' | 'AVERAGE' | 'MIN' | 'MAX') => {
      const rows = made({ range: r, rows: 0, values: 1, summary }, cells);
      return new Map(rows.slice(1).map(([label, v]) => [`${typeof label}:${String(label)}`, v]));
    };
    // Groups a criterion would misread compare values; the others stay fast SUMIFS.
    const formulas = pivotTable(workbook(cells).file.sheets[0], { range: r, rows: 0, values: 1, summary: 'SUM' }).cells;
    const formulaOf = (group: string | number) => Object.entries(formulas).find(([ref, c]) => ref.startsWith('A') && c.v === group)![0].replace('A', 'B');
    expect(formulas[formulaOf('Misc stuff')].f).toMatch(/^=SUMIFS\(/);
    expect(formulas[formulaOf('18-64')].f).toMatch(/^=SUMIFS\(/);
    for (const group of ['<18', '>65', 'Misc*', 'Food?', '=x', '1', 1]) expect(formulas[formulaOf(group)].f).toMatch(/^=ARRAYFORMULA\(/);
    const sum = of('SUM');
    expect(sum.get('string:<18')).toBe(15);
    expect(sum.get('string:>65')).toBe(30);
    expect(sum.get('string:Misc*')).toBe(7);
    expect(sum.get('string:Misc stuff')).toBe(8);
    expect(sum.get('string:Food?')).toBe(6);
    expect(sum.get('string:=x')).toBe(4);
    expect(sum.get('string:1')).toBe(1);
    expect(sum.get('number:1')).toBe(2);
    expect(sum.get('string:Grand total')).toBe(102);
    // The groups add up to the grand total.
    expect([...sum.entries()].filter(([k]) => k !== 'string:Grand total').reduce((a, [, v]) => a + (v as number), 0)).toBe(102);
    const count = of('COUNT');
    expect([count.get('string:<18'), count.get('string:>65'), count.get('string:Misc*'), count.get('string:1'), count.get('number:1')]).toEqual([2, 1, 1, 1, 1]);
    expect(count.get('string:Grand total')).toBe(11);
    const average = of('AVERAGE');
    expect([average.get('string:<18'), average.get('string:>65'), average.get('string:=x')]).toEqual([7.5, 30, 4]);
    expect([of('MIN').get('string:Misc*'), of('MAX').get('string:Misc*'), of('MIN').get('string:<18'), of('MAX').get('string:<18')]).toEqual([7, 7, 5, 10]);
    // Across, too.
    const cross = made({ range: { col: 0, row: 0, width: 3, height: 5 }, rows: 1, cols: 0, values: 2, summary: 'SUM' }, {
      A1: { v: 'Band' }, B1: { v: 'Month' }, C1: { v: 'Cost' },
      A2: { v: '<18' }, B2: { v: 'Jan' }, C2: { v: 10 },
      A3: { v: 'Misc*' }, B3: { v: 'Jan' }, C3: { v: 7 },
      A4: { v: 'Misc stuff' }, B4: { v: 'Jan' }, C4: { v: 8 },
      A5: { v: '18' }, B5: { v: 'Feb' }, C5: { v: 3 },
    });
    const at = (row: number) => Object.fromEntries(cross[0].map((h, j) => [String(h), cross[row][j]]));
    expect(cross.map((row) => row[0])).toEqual(['Month', 'Feb', 'Jan', 'Grand total']);
    expect(at(2)).toEqual({ Month: 'Jan', '18': 0, '<18': 10, 'Misc stuff': 8, 'Misc*': 7, 'Grand total': 25 });
    expect(at(3)).toEqual({ Month: 'Grand total', '18': 3, '<18': 10, 'Misc stuff': 8, 'Misc*': 7, 'Grand total': 28 });
  });

  it('leaves out empty and text values of a group, and averages to 0 when its values cancel out', () => {
    const cells: Record<string, SheetCell> = {
      A1: { v: 'Group' }, B1: { v: 'Value' },
      A2: { v: 'a' }, B2: { v: -5 },
      A3: { v: 'a' }, B3: { v: 5 },
      A4: { v: 'b' }, B4: { v: 9 },
      A5: { v: 'a' }, B5: { v: 0 },
      A6: { v: 'b' },
      A7: { v: 'b' }, B7: { v: 'n/a' },
    };
    const r = { col: 0, row: 0, width: 2, height: 7 };
    expect(made({ range: r, rows: 0, values: 1, summary: 'AVERAGE' }, cells).slice(1)).toEqual([['a', 0], ['b', 9], ['Grand total', 2.25]]);
    expect(made({ range: r, rows: 0, values: 1, summary: 'MIN' }, cells).slice(1, 3)).toEqual([['a', -5], ['b', 9]]);
    expect(made({ range: r, rows: 0, values: 1, summary: 'SUM' }, cells).slice(1, 3)).toEqual([['a', 0], ['b', 9]]);
    expect(made({ range: r, rows: 0, values: 1, summary: 'COUNT' }, cells).slice(1, 3)).toEqual([['a', 3], ['b', 3]]);
  });

  it('shows group labels in the format of the cells they come from (dates as dates)', () => {
    const cells: Record<string, SheetCell> = {
      A1: { v: 'Date' }, B1: { v: 'Category' }, C1: { v: 'Cost' },
      A2: { v: 46312, fmt: 'yyyy-mm-dd' }, B2: { v: 'Home' }, C2: { v: 1450, fmt: '$#,##0.00' },
      A3: { v: 46312, fmt: 'yyyy-mm-dd' }, B3: { v: 'Living' }, C3: { v: 300 },
      A4: { v: 46313, fmt: 'yyyy-mm-dd' }, B4: { v: 'Home' }, C4: { v: 120 },
      A5: { v: 46313, fmt: 'yyyy-mm-dd' }, B5: { v: 'Living' }, C5: { v: 60 },
    };
    const sheet = workbook(cells).file.sheets[0];
    const r = { col: 0, row: 0, width: 3, height: 5 };
    const down = pivotTable(sheet, { range: r, rows: 0, values: 2, summary: 'SUM' });
    expect(down.cells.A2).toEqual({ v: 46312, fmt: 'yyyy-mm-dd' });
    expect(down.cells.A3).toEqual({ v: 46313, fmt: 'yyyy-mm-dd' });
    expect(down.cells.A4).toEqual({ v: 'Grand total' });
    const across = pivotTable(sheet, { range: r, rows: 1, cols: 0, values: 2, summary: 'SUM' });
    expect([across.cells.B1, across.cells.C1]).toEqual([{ v: 46312, fmt: 'yyyy-mm-dd' }, { v: 46313, fmt: 'yyyy-mm-dd' }]);
    expect(across.cells.A2).toEqual({ v: 'Home' });
    const byCost = pivotTable(sheet, { range: r, rows: 2, values: 2, summary: 'COUNT' });
    expect(Object.values(byCost.cells).find((c) => c.v === 1450)).toEqual({ v: 1450, fmt: '$#,##0.00' });
    // The labels show as dates once on their sheet, and still match their rows.
    expect(made({ range: r, rows: 0, values: 2, summary: 'SUM' }, cells).slice(1, 3)).toEqual([[46312, 1750], [46313, 180]]);
    const wb = workbook(cells);
    const id = wb.addSheet('Pivot');
    wb.setCells(Object.entries(down.cells).map(([ref, c]) => ({ sheet: id, ref, content: c.f !== undefined ? { f: c.f } : { v: c.v as string | number }, fmt: c.fmt ?? null })));
    expect(shownCell(wb.file.sheets[1], 0, 1).text).toBe('2026-10-17');
  });

  it('works on a sheet whose name has a dot', () => {
    expect(made({ range, rows: 0, values: 2, summary: 'SUM' }, DATA, 'Sales.2026')[1]).toEqual(['Home', 1570]);
  });
});
