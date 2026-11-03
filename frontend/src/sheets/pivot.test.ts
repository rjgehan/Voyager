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
