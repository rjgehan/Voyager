import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { Workbook } from './engine';
import { cellValue, formulaSheetName, parseSheet, type SheetFile } from './format';
import { fromExcelFormula, readWorkbook, toExcelFormula, writeWorkbook } from './xlsx';

function file(value: unknown): SheetFile {
  const result = parseSheet(JSON.stringify(value));
  if (!result.ok) throw new Error(result.error);
  return result.file;
}

const BUDGET = file({
  type: 'notesapp-sheet',
  version: 1,
  engine: 'hyperformula@3.5.0+1',
  sheets: [
    {
      id: 's1',
      name: 'Budget',
      cells: {
        A1: { v: 'Item' },
        B1: { v: 'Cost' },
        A2: { v: 'Rent' },
        B2: { v: 1450, fmt: '$#,##0.00' },
        A3: { v: 'Paid' },
        B3: { v: true },
        B4: { v: 46312, fmt: 'yyyy-mm-dd' },
        B10: { f: '=SUM(B2:B9)', c: 47762 },
        C1: { f: '=1/0', c: { e: '#DIV/0!' } },
        C2: { f: '=TEXTJOIN(", ", TRUE, A1:A3)', c: 'Item, Rent, Paid' },
        C3: { f: '="IFS(" & A1', c: 'IFS(Item' },
        D1: { f: '=SEQUENCE(3)', c: 1 },
        D2: { c: 2 },
        D3: { c: 3 },
        E1: { v: 0.25 },
      },
      cols: { A: { w: 180 }, E: { w: 60, fmt: '0%' } },
      rows: { '2': { h: 30 } },
      frozen: { rows: 1, cols: 0 },
    },
    { id: 's2', name: 'A very long sheet name that Excel cuts short', cells: { A1: { v: 5 } } },
    { id: 's3', name: 'Totals', cells: { A1: { f: "='A very long sheet name that Excel cuts short'!A1*2", c: 10 } } },
  ],
  named: { Total: 'Budget!$B$10', Rate: '0.2' },
});

describe('formulas', () => {
  it('adds the _xlfn. prefix to newer functions, outside strings and sheet names', () => {
    expect(toExcelFormula('=TEXTJOIN(",", TRUE, A1:A3)')).toBe('_xlfn.TEXTJOIN(",", TRUE, A1:A3)');
    expect(toExcelFormula('=SUM(A1) + ifs(A1>0, 1)')).toBe('SUM(A1) + _xlfn.ifs(A1>0, 1)');
    expect(toExcelFormula('="CONCAT(x)" & \'XLOOKUP(\'!A1')).toBe('"CONCAT(x)" & \'XLOOKUP(\'!A1');
    expect(toExcelFormula('=STDEV.S(A:A)')).toBe('_xlfn.STDEV.S(A:A)');
  });

  it('removes the prefixes on import', () => {
    expect(fromExcelFormula('_xlfn.TEXTJOIN(",",TRUE,A1:A3)')).toBe('=TEXTJOIN(",",TRUE,A1:A3)');
    expect(fromExcelFormula('_xlfn._xlws.FILTER(A1:A9,B1:B9>0)')).toBe('=FILTER(A1:A9,B1:B9>0)');
    expect(fromExcelFormula('"_xlfn.kept"&A1')).toBe('="_xlfn.kept"&A1');
  });
});

describe('a round trip through .xlsx', () => {
  const book = readWorkbook(writeWorkbook(BUDGET));

  it('keeps values, formulas, cached results and number formats', () => {
    const [budget] = book.sheets;
    expect(budget.name).toBe('Budget');
    expect(budget.cells.A1).toEqual({ v: 'Item' });
    expect(budget.cells.B2).toEqual({ v: 1450, fmt: '$#,##0.00' });
    expect(budget.cells.B3).toEqual({ v: true });
    expect(budget.cells.B4).toEqual({ v: 46312, fmt: 'yyyy-mm-dd' });
    expect(budget.cells.B10).toEqual({ f: '=SUM(B2:B9)', c: 47762 });
    expect(budget.cells.C1).toEqual({ f: '=1/0', c: { e: '#DIV/0!' } });
    expect(budget.cells.C2).toEqual({ f: '=TEXTJOIN(", ", TRUE, A1:A3)', c: 'Item, Rent, Paid' });
    expect(budget.cells.C3).toEqual({ f: '="IFS(" & A1', c: 'IFS(Item' });
    // A column's format is written on its cells.
    expect(budget.cells.E1).toEqual({ v: 0.25, fmt: '0%' });
  });

  it('keeps array formulas and the values they spill into', () => {
    const [budget] = book.sheets;
    // Excel stores a spilling formula as an array formula, which comes back inside ARRAYFORMULA
    // (it computes the same); the formula beside it does not.
    expect(budget.cells.D1).toEqual({ f: '=ARRAYFORMULA(SEQUENCE(3))', c: 1 });
    expect(budget.cells.D2).toEqual({ c: 2 });
    expect(budget.cells.D3).toEqual({ c: 3 });
    expect(budget.cells.C2.f).toBe('=TEXTJOIN(", ", TRUE, A1:A3)');
    const wb = Workbook.open(file({ type: 'notesapp-sheet', version: 1, engine: '', sheets: book.sheets.map((s, i) => ({ id: `s${i + 1}`, ...s })), named: book.named }));
    expect([1, 2, 3].map((r) => cellValue(wb.cell('s1', `D${r}`)))).toEqual([1, 2, 3]);
  });

  it('keeps column widths, row heights and named ranges', () => {
    const [budget] = book.sheets;
    expect(budget.cols.A).toEqual({ w: 180 });
    expect(budget.cols.E).toEqual({ w: 60 });
    expect(budget.rows['2']).toEqual({ h: 30 });
    expect(book.named).toEqual({ Total: 'Budget!$B$10', Rate: '0.2' });
  });

  it('cuts sheet names to 31 characters and points formulas at the new name', () => {
    expect(book.sheets.map((s) => s.name)).toEqual(['Budget', 'A very long sheet name that Exc', 'Totals']);
    expect(book.sheets[2].cells.A1).toEqual({ f: "='A very long sheet name that Exc'!A1*2", c: 10 });
  });
});

describe('array formulas from Excel', () => {
  const asFile = (book: ReturnType<typeof readWorkbook>) =>
    file({ type: 'notesapp-sheet', version: 1, engine: '', sheets: book.sheets.map((s, i) => ({ id: `s${i + 1}`, ...s })), named: book.named });
  /** A workbook as Excel writes legacy {=…} array formulas and Excel 365's dynamic ones. */
  function excelBook(): Uint8Array {
    const ws = XLSX.utils.aoa_to_sheet([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
    ws.D1 = { t: 'n', v: 32, f: 'SUM(A1:A3*B1:B3)', F: 'D1:D1' };
    ws.D5 = { t: 'n', v: 6, f: 'MAX(IF(A1:A3>1,B1:B3))', F: 'D5:D5' };
    ws.E5 = { t: 'n', v: 32, f: 'SUM(A1:A3*B1:B3)', F: 'E5:E5', D: true };
    ws.F1 = { t: 'n', v: 4, f: 'A1:A3*B1:B3', F: 'F1:F3', D: true };
    ws.F2 = { t: 'n', v: 10, F: 'F1:F3' };
    ws.F3 = { t: 'n', v: 18, F: 'F1:F3' };
    ws['!ref'] = 'A1:F5';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  }

  it('imports them as ARRAYFORMULA, as Google Sheets does, so they compute what Excel showed', () => {
    const book = readWorkbook(excelBook());
    const cells = book.sheets[0].cells;
    expect(cells.D1).toEqual({ f: '=ARRAYFORMULA(SUM(A1:A3*B1:B3))', c: 32 });
    expect(cells.D5).toEqual({ f: '=ARRAYFORMULA(MAX(IF(A1:A3>1,B1:B3)))', c: 6 });
    expect(cells.E5).toEqual({ f: '=ARRAYFORMULA(SUM(A1:A3*B1:B3))', c: 32 });
    expect(cells.F1).toEqual({ f: '=ARRAYFORMULA(A1:A3*B1:B3)', c: 4 });
    expect(cells.F2).toEqual({ c: 10 });
    const wb = Workbook.open(asFile(book));
    const value = (ref: string) => cellValue(wb.cell('s1', ref));
    expect([value('D1'), value('D5'), value('E5'), value('F1'), value('F2'), value('F3')]).toEqual([32, 6, 32, 4, 10, 18]);
  });

  it('exports ARRAYFORMULA as an Excel array formula, which Excel computes the same', () => {
    const out = XLSX.read(writeWorkbook(asFile(readWorkbook(excelBook()))), { type: 'array', cellFormula: true });
    const ws = out.Sheets.Data;
    expect([ws.D1.f, ws.D1.F]).toEqual(['SUM(A1:A3*B1:B3)', 'D1:D1']);
    expect([ws.F1.f, ws.F1.F]).toEqual(['A1:A3*B1:B3', 'F1:F3']);
    // Anywhere in a formula: the whole formula becomes an array formula.
    const pivot = file({
      type: 'notesapp-sheet',
      version: 1,
      engine: '',
      sheets: [{ id: 's1', name: 'P', cells: { A1: { f: '=IFERROR(ARRAYFORMULA(AVERAGE(IF(B1:B3>0, B1:B3, ""))), "")', c: 2 }, B1: { v: 2 } } }],
      named: {},
    });
    const cell = XLSX.read(writeWorkbook(pivot), { type: 'array', cellFormula: true }).Sheets.P.A1;
    expect([cell.f, cell.F]).toEqual(['IFERROR(AVERAGE(IF(B1:B3>0, B1:B3, "")), "")', 'A1:A1']);
    // Text that only looks like the function is kept.
    expect(toExcelFormula('="ARRAYFORMULA(x)"&A1')).toBe('"ARRAYFORMULA(x)"&A1');
  });
});

describe('importing workbooks made elsewhere', () => {
  it('reports what it leaves out and repairs sheet names', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Score'],
      ['Ada', 0.9],
    ]);
    ws['!merges'] = [{ s: { c: 0, r: 0 }, e: { c: 1, r: 0 } }];
    ws.C1 = { t: 'e', v: 0x2a, w: '#N/A' };
    ws['!ref'] = 'A1:C2';
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[1]]), 'data2');
    wb.Workbook = { Names: [{ Name: 'Local', Ref: 'Data!$A$1', Sheet: 0 }, { Name: 'Scores', Ref: 'Data!$B$2:$B$9' }] };
    const book = readWorkbook(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer));
    expect(book.sheets[0].cells).toEqual({ A1: { v: 'Name' }, B1: { v: 'Score' }, A2: { v: 'Ada' }, B2: { v: 0.9 }, C1: { v: '#N/A' } });
    expect(book.named).toEqual({ Scores: 'Data!$B$2:$B$9' });
    expect(book.skipped).toEqual(['Merged cells are shown unmerged.', 'The name “Local” belongs to one sheet and was left out.']);
  });

  it('refuses what is not a workbook', () => {
    expect(() => readWorkbook(new TextEncoder().encode('\u0000\u0001 not a workbook'))).toThrow();
  });
});

describe('sheet names Excel cannot take', () => {
  it('points formulas at the right sheet when one cut name takes another sheet’s name', () => {
    const long = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const cut = long.slice(0, 31);
    const book = readWorkbook(
      writeWorkbook(
        file({
          type: 'notesapp-sheet',
          version: 1,
          engine: '',
          sheets: [
            { id: 's1', name: long, cells: { A1: { v: 1 } } },
            { id: 's2', name: cut, cells: { A1: { v: 2 } } },
            { id: 's3', name: 'Sum', cells: { A1: { f: `='${long}'!A1*10+'${cut}'!A1`, c: 12 } } },
          ],
          named: { First: `'${long}'!$A$1`, Second: `'${cut}'!$A$1` },
        }),
      ),
    );
    const names = book.sheets.map((s) => s.name);
    const [a, b] = names.map(formulaSheetName);
    expect(names[0]).toBe(cut);
    expect(names[1]).not.toBe(cut);
    expect(book.sheets[2].cells.A1.f).toBe(`=${a}!A1*10+${b}!A1`);
    expect(book.named).toEqual({ First: `${a}!$A$1`, Second: `${b}!$A$1` });
  });

  it('exports a sheet named History, which Excel reserves, under another name', () => {
    for (const reserved of ['History', 'history', 'HISTORY']) {
      const book = readWorkbook(
        writeWorkbook(
          file({
            type: 'notesapp-sheet',
            version: 1,
            engine: '',
            sheets: [
              { id: 's1', name: reserved, cells: { A1: { v: 1 } } },
              { id: 's2', name: 'Sum', cells: { A1: { f: `=${reserved}!A1*10`, c: 10 } } },
            ],
          }),
        ),
      );
      expect(book.sheets[0].name).toBe(`${reserved} (2)`);
      expect(cellValue(book.sheets[0].cells.A1)).toBe(1);
      expect(book.sheets[1].cells.A1.f).toBe(`=${formulaSheetName(`${reserved} (2)`)}!A1*10`);
    }
  });

  it('drops an apostrophe the 31-character cut leaves at the end of a name', () => {
    const name = 'A'.repeat(30) + "'s data";
    const book = readWorkbook(
      writeWorkbook(file({ type: 'notesapp-sheet', version: 1, engine: '', sheets: [{ id: 's1', name, cells: { A1: { v: 1 } } }] })),
    );
    expect(book.sheets[0].name).toBe('A'.repeat(30));
  });
});
