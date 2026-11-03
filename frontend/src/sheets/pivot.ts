// Pivot tables (DESIGN §6.21.17): a summary of a range on a new sheet, as Google Sheets' pivot
// table makes one: the distinct values of one column down the side, optionally those of another
// across the top, and a column's values summarized (sum, count, average, smallest, largest) where
// they meet, with grand totals. The summary is made of ordinary formulas over the source range, so
// it stays live as the data changes; the groups are those of the data when the table is made (make
// it again for new ones). A group matches its rows exactly, as in Google Sheets: its value is a
// criterion of `SUMIFS` and friends (fast: the engine caches them) only where that reads it as
// itself; `<18`, `>65` or `=x` would be comparisons, `Misc*` a wildcard and a text `1` would
// match the number 1, so those groups compare values (`=ARRAYFORMULA(SUM(IF(…=$A2, …)))`).
// Pure: the new sheet's cells.
import { columnLetters, toA1 } from './a1';
import { effectiveFormat, shownCell } from './display';
import { cellValue, type CellValue, type Sheet, type SheetCell } from './format';
import { typedInput } from './input';
import { absoluteRangeText, type CellRange } from './refs';
import { compareSortValues } from './sort';

export const PIVOT_SUMMARIES = ['SUM', 'COUNT', 'AVERAGE', 'MIN', 'MAX'] as const;
export type PivotSummary = (typeof PIVOT_SUMMARIES)[number];

export interface PivotOptions {
  /** The source range, its first row the headers. */
  range: CellRange;
  /** Columns (indexes in the sheet) whose values group the rows and, optionally, the columns. */
  rows: number;
  cols?: number;
  /** The column whose values are summarized. */
  values: number;
  summary: PivotSummary;
}

export interface PivotTable {
  cells: Record<string, SheetCell>;
  /** Rows (0-based) to show in bold: the header and the grand total. */
  boldRows: number[];
  width: number;
  height: number;
}

/** The column's header, or its letter. */
export function headerName(sheet: Sheet, range: CellRange, col: number): string {
  const text = shownCell(sheet, col, range.row).text.trim();
  return text || `Column ${columnLetters(col)}`;
}

/** A group: a distinct value, and the format of the cell it first comes from (its label's). */
interface Group {
  v: CellValue;
  fmt: string | undefined;
}

/** The distinct values of a column of the range's body, sorted as Google Sheets sorts them; blanks left out. */
function groups(sheet: Sheet, range: CellRange, col: number): Group[] {
  const seen = new Map<string, Group>();
  for (let row = range.row + 1; row < range.row + range.height; row++) {
    const v = cellValue(sheet.cells[toA1(col, row)]);
    if (v === null || v === '' || typeof v === 'object') continue;
    // The engine compares text without regard to case, so groups do too.
    const key = typeof v === 'string' ? `s${v.toLocaleLowerCase()}` : `${typeof v}${String(v)}`;
    if (!seen.has(key)) seen.set(key, { v, fmt: effectiveFormat(sheet, col, row) });
  }
  return [...seen.values()].sort((a, b) => compareSortValues(a.v, b.v));
}

/** Whether a criterion would read `text` as a number, date, time or boolean (`1`, ` 2 `, `10/17/2026`, `true`). */
function readsAsValue(text: string): boolean {
  return typeof typedInput(text).content?.v !== 'string' || (text.trim() !== '' && Number.isFinite(Number(text)));
}

/**
 * Whether a group's value, as a criterion, matches exactly its own rows: text without a leading
 * comparison sign, wildcards or the look of a value, and numbers and booleans in a column without
 * text that looks like one (a criterion 1 matches the text `1` too).
 */
function plainCriterion(v: CellValue, valueLikeText: boolean): boolean {
  if (typeof v !== 'string') return !valueLikeText;
  return !/^[<>=]/.test(v) && !/[*?~]/.test(v) && !readsAsValue(v);
}

/** A label cell: the group's value in the format of its source cell. */
const label = (g: Group): SheetCell => (g.fmt === undefined ? { v: g.v } : { v: g.v, fmt: g.fmt });

const NAMES: Record<PivotSummary, string> = { SUM: 'SUM', COUNT: 'COUNT', AVERAGE: 'AVERAGE', MIN: 'MIN', MAX: 'MAX' };

/** The pivot table's cells for a new sheet. */
export function pivotTable(sheet: Sheet, opts: PivotOptions): PivotTable {
  const { range } = opts;
  const body = { ...range, row: range.row + 1, height: Math.max(1, range.height - 1) };
  const column = (col: number) => absoluteRangeText(sheet.name, { ...body, col, width: 1 });
  const values = column(opts.values);
  const byRow = column(opts.rows);
  const byCol = opts.cols !== undefined ? column(opts.cols) : null;
  /**
   * The summary of the values whose rows match `criteria` (a range, a cell holding its group, and
   * whether that group is a plain criterion). Text and empty values are left out, as SUMIFS and
   * AVERAGEIF leave them out; a count counts the group's rows.
   */
  const summary = (criteria: Array<[string, string, boolean]>): string => {
    if (criteria.length === 0) {
      const all = { SUM: `SUM(${values})`, COUNT: `COUNTA(${byRow})`, AVERAGE: `AVERAGE(${values})`, MIN: `MIN(${values})`, MAX: `MAX(${values})` }[opts.summary];
      return `=${all}`;
    }
    if (criteria.every(([, , plain]) => plain)) {
      const pairs = criteria.map(([r, c]) => `${r}, ${c}`).join(', ');
      if (opts.summary === 'COUNT') return `=COUNTIFS(${pairs})`;
      if (opts.summary === 'AVERAGE') {
        // HyperFormula has AVERAGEIF but no AVERAGEIFS: two criteria divide a sum by a count of the
        // values present. An average of nothing is no error in a pivot table: the cell stays empty.
        const [[r, c]] = criteria;
        const f = criteria.length === 1 ? `AVERAGEIF(${r}, ${c}, ${values})` : `SUMIFS(${values}, ${pairs})/COUNTIFS(${pairs}, ${values}, "<>")`;
        return `=IFERROR(${f}, "")`;
      }
      const fn = { SUM: 'SUMIFS', MIN: 'MINIFS', MAX: 'MAXIFS' }[opts.summary];
      return `=${fn}(${values}, ${pairs})`;
    }
    // Compared exactly; an error in the range matches nothing.
    const match = criteria.map(([r, c]) => `IFERROR(${r}=${c}, FALSE)`).join('*');
    if (opts.summary === 'COUNT') return `=ARRAYFORMULA(SUM(IF(${match}, 1, 0)))`;
    const numbers = `IF((${match})*ISNUMBER(${values}), ${values}, "")`;
    if (opts.summary === 'SUM') return `=ARRAYFORMULA(SUM(${numbers}))`;
    // An average of nothing is no error in a pivot table: the cell stays empty.
    if (opts.summary === 'AVERAGE') return `=IFERROR(ARRAYFORMULA(AVERAGE(${numbers})), "")`;
    return `=ARRAYFORMULA(${opts.summary}(${numbers}))`;
  };
  const rowGroups = groups(sheet, range, opts.rows);
  const colGroups = opts.cols !== undefined ? groups(sheet, range, opts.cols) : [];
  const plain = (all: Group[]) => {
    const valueLikeText = all.some((g) => typeof g.v === 'string' && readsAsValue(g.v));
    return all.map((g) => plainCriterion(g.v, valueLikeText));
  };
  const rowPlain = plain(rowGroups);
  const colPlain = plain(colGroups);
  const fmt = sheet.cells[toA1(opts.values, body.row)]?.fmt ?? sheet.cols[columnLetters(opts.values)]?.fmt;
  const valueFmt = opts.summary === 'COUNT' ? undefined : fmt;
  const cells: Record<string, SheetCell> = {};
  const put = (col: number, row: number, cell: SheetCell) => {
    cells[toA1(col, row)] = valueFmt && cell.f !== undefined ? { ...cell, fmt: valueFmt } : cell;
  };
  put(0, 0, { v: headerName(sheet, range, opts.rows) });
  const valueTitle = `${NAMES[opts.summary]} of ${headerName(sheet, range, opts.values)}`;
  const across = byCol !== null ? colGroups : [];
  const width = 1 + (byCol !== null ? across.length + 1 : 1);
  if (byCol === null) put(1, 0, { v: valueTitle });
  else {
    across.forEach((g, j) => put(1 + j, 0, label(g)));
    put(1 + across.length, 0, { v: 'Grand total' });
  }
  rowGroups.forEach((g, i) => {
    const row = 1 + i;
    const key = `$A${row + 1}`;
    put(0, row, label(g));
    if (byCol === null) put(1, row, { f: summary([[byRow, key, rowPlain[i]]]) });
    else {
      across.forEach((_, j) => put(1 + j, row, { f: summary([[byRow, key, rowPlain[i]], [byCol, `${columnLetters(1 + j)}$1`, colPlain[j]]]) }));
      put(1 + across.length, row, { f: summary([[byRow, key, rowPlain[i]]]) });
    }
  });
  const total = 1 + rowGroups.length;
  put(0, total, { v: 'Grand total' });
  if (byCol === null) put(1, total, { f: summary([]) });
  else {
    across.forEach((_, j) => put(1 + j, total, { f: summary([[byCol, `${columnLetters(1 + j)}$1`, colPlain[j]]]) }));
    put(1 + across.length, total, { f: summary([]) });
  }
  return { cells, boldRows: [0, total], width, height: total + 1 };
}
