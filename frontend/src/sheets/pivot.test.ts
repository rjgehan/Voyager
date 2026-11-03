import { describe, expect, it } from 'vitest';
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

function workbook(): Workbook {
  const parsed = parseSheet(JSON.stringify({ type: 'notesapp-sheet', version: 1, engine: '', sheets: [{ id: 's1', name: 'My data', cells: DATA }], named: {} }));
  if (!parsed.ok) throw new Error(parsed.error);
  return Workbook.open(parsed.file);
}

/** Puts a pivot table on a new sheet and returns its shown values, row by row. */
function made(opts: Parameters<typeof pivotTable>[1]): Array<Array<string | number | boolean | null>> {
  const wb = workbook();
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
});
