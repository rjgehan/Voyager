// A sheet's filter (DESIGN §6.21.11): which rows of its range show, and in which order, as the view
// shows them. The range's first row holds the filter buttons; the rows below it (its body) are
// hidden when a column's condition or hidden values exclude them, and shown in the order of the
// filter's sort. Nothing moves in the file: the view maps its rows to the sheet's (gridModel.ts).
// Also the data region around a cell, which "Create a filter" and the sorts take from a single cell,
// as Google Sheets does. Pure and engine-free.
import { columnIndex, parseA1, toA1 } from './a1';
import { meetsCondition } from './conditions';
import { shownCell } from './display';
import { cellValue, type CachedValue, type FilterColumn, type Sheet, type SheetFilter } from './format';
import { parseRangeText, type CellRange } from './refs';
import { compareSortValues, sortRows } from './sort';

/** The filter's range on its sheet, or null when it has none it can use. */
export function filterRange(filter: SheetFilter | undefined): CellRange | null {
  if (!filter?.range) return null;
  const parsed = parseRangeText(filter.range);
  return parsed && parsed.sheet === null ? parsed.range : null;
}

/** Whether a column's conditions let a cell show. */
function columnShows(column: FilterColumn, value: CachedValue, shown: string): boolean {
  if (column.hide && column.hide.length > 0 && column.hide.includes(shown)) return false;
  return meetsCondition(column, value, shown);
}

/** Whether the filter lets sheet row `row` (of its body) show. */
export function rowShows(sheet: Sheet, filter: SheetFilter, row: number): boolean {
  for (const [letters, column] of Object.entries(filter.cols)) {
    const col = columnIndex(letters);
    if (col < 0) continue;
    const { value, text } = shownCell(sheet, col, row);
    if (!columnShows(column, value, text)) return false;
  }
  return true;
}

/** Whether a filter column hides anything or has a condition (its button shows it is on). */
export function columnFiltered(column: FilterColumn | undefined): boolean {
  return !!column && ((column.hide?.length ?? 0) > 0 || column.when !== undefined);
}

export interface FilterView {
  /** First and last sheet row of the body the view orders (frozen rows are never filtered). */
  start: number;
  end: number;
  /** The body's rows that show, in the order they show. */
  rows: number[];
}

/**
 * The rows of the filter's body as the view shows them, from sheet row `firstRow` at the earliest
 * (the first row below the frozen ones), or null when the filter hides and orders nothing.
 */
export function filterView(sheet: Sheet, firstRow = 0): FilterView | null {
  const filter = sheet.filter;
  const range = filterRange(filter);
  if (!filter || !range) return null;
  const sort = filter.sort ? columnIndex(filter.sort.col) : -1;
  const filtered = Object.values(filter.cols).some(columnFiltered);
  if (!filtered && sort < 0) return null;
  const start = Math.max(range.row + 1, firstRow);
  const end = range.row + range.height - 1;
  if (end < start) return null;
  let rows: number[] = [];
  for (let row = start; row <= end; row++) if (!filtered || rowShows(sheet, filter, row)) rows.push(row);
  if (sort >= 0) rows = sortRows(sheet, rows, [{ col: sort, desc: filter.sort?.desc === true }]);
  return { start, end, rows };
}

export interface FilterValue {
  /** The value as it shows (`""` for blanks), which `hide` lists. */
  text: string;
  value: CachedValue;
  /** How many rows of the body hold it. */
  count: number;
}

/**
 * The distinct values of column `col` in the filter's body, as they show, in sort order (blanks
 * last), for "Filter by values". Rows other columns hide are counted too, as in Google Sheets.
 */
export function filterValues(sheet: Sheet, filter: SheetFilter, col: number): FilterValue[] {
  const range = filterRange(filter);
  if (!range) return [];
  const byText = new Map<string, FilterValue>();
  for (let row = range.row + 1; row < range.row + range.height; row++) {
    const { value, text } = shownCell(sheet, col, row);
    const seen = byText.get(text);
    if (seen) seen.count++;
    else byText.set(text, { text, value, count: 1 });
  }
  return [...byText.values()].sort((a, b) => compareSortValues(a.value, b.value) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
}

/**
 * The data region around a cell: the rectangle of cells that touch one another (diagonals too)
 * through cells that show something, grown from the cell, as Google Sheets and Excel take a filter's
 * or a sort's range from a single cell. A cell with nothing around it is its own region. The used
 * cells are indexed by row and by column, so each step of growth looks up one row or column of
 * the rectangle's border: the time follows the number of cells, not their rows times the cells.
 */
export function dataRegion(sheet: Sheet, col: number, row: number): CellRange {
  const byRow = new Map<number, number[]>();
  const byCol = new Map<number, number[]>();
  const add = (index: Map<number, number[]>, key: number, value: number) => {
    const list = index.get(key);
    if (list) list.push(value);
    else index.set(key, [value]);
  };
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const at = parseA1(ref);
    const v = cellValue(cell);
    if (!at || v === null || v === '') continue;
    add(byRow, at.row, at.col);
    add(byCol, at.col, at.row);
  }
  for (const list of byRow.values()) list.sort((a, b) => a - b);
  for (const list of byCol.values()) list.sort((a, b) => a - b);
  /** The smallest and largest entry of a sorted list within [lo, hi], or null. */
  const span = (list: number[] | undefined, lo: number, hi: number): [number, number] | null => {
    if (!list) return null;
    const first = (bound: number) => {
      let a = 0;
      let b = list.length;
      while (a < b) {
        const m = (a + b) >> 1;
        if (list[m] < bound) a = m + 1;
        else b = m;
      }
      return a;
    };
    const i = first(lo);
    if (i >= list.length || list[i] > hi) return null;
    return [list[i], list[first(hi + 1) - 1]];
  };
  let c1 = col;
  let r1 = row;
  let c2 = col;
  let r2 = row;
  for (let grew = true; grew; ) {
    grew = false;
    for (let s = span(byRow.get(r1 - 1), c1 - 1, c2 + 1); s; s = span(byRow.get(r1 - 1), c1 - 1, c2 + 1)) {
      r1--;
      [c1, c2] = [Math.min(c1, s[0]), Math.max(c2, s[1])];
      grew = true;
    }
    for (let s = span(byRow.get(r2 + 1), c1 - 1, c2 + 1); s; s = span(byRow.get(r2 + 1), c1 - 1, c2 + 1)) {
      r2++;
      [c1, c2] = [Math.min(c1, s[0]), Math.max(c2, s[1])];
      grew = true;
    }
    for (let s = span(byCol.get(c1 - 1), r1 - 1, r2 + 1); s; s = span(byCol.get(c1 - 1), r1 - 1, r2 + 1)) {
      c1--;
      [r1, r2] = [Math.min(r1, s[0]), Math.max(r2, s[1])];
      grew = true;
    }
    for (let s = span(byCol.get(c2 + 1), r1 - 1, r2 + 1); s; s = span(byCol.get(c2 + 1), r1 - 1, r2 + 1)) {
      c2++;
      [r1, r2] = [Math.min(r1, s[0]), Math.max(r2, s[1])];
      grew = true;
    }
  }
  return { col: c1, row: r1, width: c2 - c1 + 1, height: r2 - r1 + 1 };
}

/**
 * Whether the first row of `range` looks like a header: text above at least one column whose
 * next row is not text (a number, a date), as Google Sheets guesses "Data has header row".
 */
export function looksLikeHeader(sheet: Sheet, range: CellRange): boolean {
  if (range.height < 2) return false;
  let text = 0;
  let differs = false;
  for (let col = range.col; col < range.col + range.width; col++) {
    const top = cellValue(sheet.cells[toA1(col, range.row)]);
    const next = cellValue(sheet.cells[toA1(col, range.row + 1)]);
    if (typeof top === 'string' && top !== '') text++;
    if (typeof top === 'string' && top !== '' && typeof next !== 'string' && next !== null) differs = true;
    if (top !== null && typeof top !== 'string') return false;
  }
  return text > 0 && differs;
}
