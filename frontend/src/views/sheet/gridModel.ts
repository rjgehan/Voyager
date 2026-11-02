// Between the sheet model and Glide Data Grid (DESIGN §6.21.5): the grid's size, columns, frozen
// rows, cell contents and selections. Glide has frozen columns but no frozen top rows, so frozen
// rows are drawn in its (sticky) header below the column letters: the grid's own rows start at
// sheet row `frozenRows`. Sheet coordinates are 0-based column and row; grid rows are offset by
// the frozen rows.
import { CompactSelection, GridCellKind, type GridCell, type GridColumn, type GridSelection, type Theme } from '@glideapps/glide-data-grid';
import { columnLetters, MAX_COLUMNS, MAX_ROWS, toA1 } from '../../sheets/a1';
import { effectiveFormat, shownCell, type ShownCell } from '../../sheets/display';
import { usedExtent } from '../../sheets/edits';
import type { CellStyle } from '../../sheets/conditional';
import type { ValidationLook } from '../../sheets/validation';
import { filterView } from '../../sheets/filter';
import { cellText, type Sheet } from '../../sheets/format';
import type { CellRange } from '../../sheets/refs';

/** Height of the column letters above the frozen rows (taller on touch devices). */
export const HEADER_BAND = 26;
export const TOUCH_HEADER_BAND = 32;
export const DEFAULT_COLUMN_WIDTH = 100;
export const MIN_COLUMN_WIDTH = 32;
export const MAX_COLUMN_WIDTH = 800;
/** A new or small sheet still shows a sheet-sized grid, as Google Sheets does. */
const MIN_ROWS = 1000;
const MIN_COLUMNS = 26;
/** Room below and right of the used cells. */
const ROW_MARGIN = 100;
const COLUMN_MARGIN = 4;

export interface CellAt {
  col: number;
  row: number;
}

export interface SheetSelection {
  active: CellAt;
  range: CellRange;
}

/**
 * The rows the grid shows, as sheet rows (DESIGN §6.21.11): the same, unless the sheet's filter
 * hides rows of its range or sorts them. Selections are in the grid's (display) rows; edits go to
 * the sheet rows these map them to.
 */
export interface RowView {
  /** The filter hides or orders rows: display rows are not sheet rows. */
  active: boolean;
  /** Rows the filter hides. */
  hidden: number;
  sheetRow(displayRow: number): number;
  /** The display row of a sheet row, or null when the filter hides it. */
  displayRow(sheetRow: number): number | null;
}

export const IDENTITY_VIEW: RowView = { active: false, hidden: 0, sheetRow: (r) => r, displayRow: (r) => r };

/** The row view of a sheet's filter, with frozen rows (before `firstRow`) left as they are. */
export function rowView(sheet: Sheet, firstRow: number): RowView {
  const view = filterView(sheet, firstRow);
  if (!view) return IDENTITY_VIEW;
  const { start, end, rows } = view;
  const hidden = end - start + 1 - rows.length;
  const index = new Map(rows.map((r, i) => [r, i]));
  return {
    active: true,
    hidden,
    sheetRow: (d) => (d < start ? d : d < start + rows.length ? rows[d - start] : d + hidden),
    displayRow: (r) => {
      if (r < start) return r;
      if (r > end) return r - hidden;
      const i = index.get(r);
      return i === undefined ? null : start + i;
    },
  };
}

/** The sheet rows of display rows `range.row` to the end of `range`, in display order. */
export function sheetRows(view: RowView, range: CellRange): number[] {
  return Array.from({ length: range.height }, (_, i) => view.sheetRow(range.row + i));
}

/** The smallest sheet range that holds a display range (the range itself without a view). */
export function sheetRange(view: RowView, range: CellRange): CellRange {
  if (!view.active) return range;
  const rows = sheetRows(view, range);
  const top = Math.min(...rows);
  return { ...range, row: top, height: Math.max(...rows) - top + 1 };
}

/** A sheet range as the grid shows it, or null when its rows do not show together in order. */
export function displayRange(view: RowView, range: CellRange): CellRange | null {
  if (!view.active) return range;
  const first = view.displayRow(range.row);
  if (first === null) return null;
  for (let i = 1; i < range.height; i++) if (view.displayRow(range.row + i) !== first + i) return null;
  return { ...range, row: first };
}

export interface GridLayout {
  /** Height of the column letters; frozen rows are drawn below them. */
  headerBand: number;
  /** Rows (display rows: rows a filter hides are left out) and columns the grid shows, frozen ones included. */
  rows: number;
  cols: number;
  /** Frozen rows drawn in the header, possibly fewer than the file asks for when they would not fit. */
  frozenRows: number;
  frozenCols: number;
  frozenHeight: number;
  rowHeight(sheetRow: number): number;
  columnWidth(col: number): number;
  /** Display rows to sheet rows and back. */
  view: RowView;
}

export interface LayoutOptions {
  rowHeight: number;
  headerBand?: number;
  /** Rows and columns the user scrolled or moved into beyond the default size. */
  minRows: number;
  minCols: number;
  /** Frozen rows beyond this height stay in the grid (a phone in landscape). */
  maxFrozenHeight: number;
  /**
   * The rows a filter shows, as computed when the filter last changed (`rowView`): as in Google
   * Sheets, an edit does not hide or move its row until the filter is applied again.
   */
  view?: (frozenRows: number) => RowView;
}

export function gridLayout(sheet: Sheet, opts: LayoutOptions): GridLayout {
  const used = usedExtent(sheet);
  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, used.rows + 1 + ROW_MARGIN, opts.minRows, sheet.frozen.rows + 1));
  const cols = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, used.cols + 1 + COLUMN_MARGIN, opts.minCols, sheet.frozen.cols + 1));
  const rowHeight = (row: number) => sheet.rows[String(row + 1)]?.h ?? opts.rowHeight;
  const columnWidth = (col: number) => {
    const w = sheet.cols[columnLetters(col)]?.w;
    return w === undefined ? DEFAULT_COLUMN_WIDTH : Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, w));
  };
  let frozenRows = 0;
  let frozenHeight = 0;
  while (frozenRows < sheet.frozen.rows && frozenRows < rows - 1) {
    const next = frozenHeight + rowHeight(frozenRows);
    if (frozenRows > 0 && next > opts.maxFrozenHeight) break;
    frozenHeight = next;
    frozenRows++;
  }
  const view = opts.view ? opts.view(frozenRows) : rowView(sheet, frozenRows);
  return {
    headerBand: opts.headerBand ?? HEADER_BAND,
    rows: Math.max(frozenRows + 1, rows - view.hidden),
    cols,
    frozenRows,
    frozenCols: Math.min(sheet.frozen.cols, cols - 1),
    frozenHeight,
    rowHeight,
    columnWidth,
    view,
  };
}

/** The frozen row at `y` pixels below the column letters, or null below the frozen rows. */
export function frozenRowAt(layout: GridLayout, y: number): number | null {
  if (y < 0) return null;
  let top = 0;
  for (let r = 0; r < layout.frozenRows; r++) {
    top += layout.rowHeight(r);
    if (y < top) return r;
  }
  return null;
}

/** The top of frozen row `row`, in pixels below the column letters. */
export function frozenRowTop(layout: GridLayout, row: number): number {
  let top = 0;
  for (let r = 0; r < row; r++) top += layout.rowHeight(r);
  return top;
}

export function gridColumns(sheet: Sheet, layout: GridLayout, sizing: ReadonlyMap<number, number>, theme: { fontSize: number }): GridColumn[] {
  const columns: GridColumn[] = [];
  for (let col = 0; col < layout.cols; col++) {
    const letters = columnLetters(col);
    const bold = sheet.cols[letters]?.bold === true;
    columns.push({
      id: letters,
      title: letters,
      width: sizing.get(col) ?? layout.columnWidth(col),
      ...(bold ? { themeOverride: { baseFontStyle: `700 ${theme.fontSize}px` } } : {}),
    });
  }
  return columns;
}

/** Text colours: error results, and the colours a number format can ask for ([Red]). */
export type CellColors = Record<NonNullable<ShownCell['color']>, string>;

export interface CellOptions {
  /** Glide's own overlay editor opens on the cell (desktop); otherwise the formula bar edits it. */
  overlay: boolean;
  readonly: boolean;
  colors: CellColors;
  /** Conditional formatting of a cell (DESIGN §6.21.12), and what it needs to set a font. */
  styleAt?: ((col: number, row: number) => CellStyle | undefined) | null;
  fontSize?: number;
  /** Data validation of a cell (DESIGN §6.21.13): checkboxes show as Glide's checkboxes. */
  looks?: ((col: number, row: number) => ValidationLook | undefined) | null;
}

/** The font of a cell in bold or italic (its row's or column's bold included). */
export function cellFont(sheet: Sheet, col: number, row: number, style: CellStyle | undefined, fontSize: number): string | undefined {
  const bold = style?.bold === true || sheet.rows[String(row + 1)]?.bold === true || sheet.cols[columnLetters(col)]?.bold === true;
  if (!style?.bold && !style?.italic) return undefined;
  return `${style.italic ? 'italic ' : ''}${bold ? '700 ' : ''}${fontSize}px`;
}

/**
 * What the grid shows and edits for a cell: its value as text in its number format, and its
 * formula or value to edit (dates as dates, percentages as percentages).
 */
export function gridCell(sheet: Sheet, col: number, row: number, opts: CellOptions): GridCell {
  const cell = sheet.cells[toA1(col, row)];
  const shown = shownCell(sheet, col, row);
  const style = opts.styleAt?.(col, row);
  const look = opts.looks?.(col, row);
  if (look?.kind === 'checkbox' && !look.invalid) {
    // A checkbox cell: ticked for TRUE; the view toggles it on a click (Glide's own toggle is not used).
    return {
      kind: GridCellKind.Boolean,
      data: look.checked === true,
      allowOverlay: false,
      readonly: opts.readonly,
      contentAlign: 'center',
      ...(style?.bg ? { themeOverride: { bgCell: style.bg } } : {}),
    };
  }
  let themeOverride: Partial<Theme> | undefined = shown.color ? { textDark: opts.colors[shown.color] } : undefined;
  if (style) {
    // A rule's colours win over a number format's, never over an error's.
    themeOverride = { ...themeOverride };
    if (style.bg) themeOverride.bgCell = style.bg;
    if (style.color && shown.color !== 'error') themeOverride.textDark = style.color;
    const font = cellFont(sheet, col, row, style, opts.fontSize ?? 13);
    if (font) themeOverride.baseFontStyle = font;
  }
  return {
    kind: GridCellKind.Text,
    data: cellText(cell, effectiveFormat(sheet, col, row)),
    displayData: shown.text,
    allowOverlay: opts.overlay,
    readonly: opts.readonly,
    contentAlign: shown.align,
    copyData: shown.text,
    ...(themeOverride ? { themeOverride } : {}),
  };
}

// ---------- selections ----------

export const NO_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };

/** A sheet selection from Glide's: a column or row selected from its header becomes a range. */
export function fromGridSelection(sel: GridSelection, layout: GridLayout): SheetSelection | null {
  const f = layout.frozenRows;
  if (sel.current) {
    const [col, row] = sel.current.cell;
    const r = sel.current.range;
    return { active: { col, row: row + f }, range: { col: r.x, row: r.y + f, width: r.width, height: r.height } };
  }
  const columns = sel.columns;
  if (columns.length > 0) {
    const first = columns.first() ?? 0;
    const last = columns.last() ?? first;
    return { active: { col: first, row: 0 }, range: { col: first, row: 0, width: last - first + 1, height: layout.rows } };
  }
  const rows = sel.rows;
  if (rows.length > 0) {
    const first = rows.first() ?? 0;
    const last = rows.last() ?? first;
    return { active: { col: 0, row: first + f }, range: { col: 0, row: first + f, width: layout.cols, height: last - first + 1 } };
  }
  return null;
}

/** Glide's selection for a sheet selection; empty when the active cell is a frozen one. */
export function toGridSelection(s: SheetSelection, layout: GridLayout): GridSelection {
  const f = layout.frozenRows;
  if (s.active.row < f) return NO_SELECTION;
  const top = Math.max(s.range.row, f);
  const height = Math.max(1, s.range.row + s.range.height - top);
  return {
    current: {
      cell: [s.active.col, s.active.row - f],
      range: { x: s.range.col, y: top - f, width: s.range.width, height },
      rangeStack: [],
    },
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  };
}

/** A selection of one cell. */
export function cellSelection(col: number, row: number): SheetSelection {
  return { active: { col, row }, range: { col, row, width: 1, height: 1 } };
}

/** `sel` kept inside the grid's rows and columns (after a sheet shrank or another sheet opened). */
export function clampSelection(sel: SheetSelection, layout: GridLayout): SheetSelection {
  const col = Math.min(sel.active.col, layout.cols - 1);
  const row = Math.min(sel.active.row, layout.rows - 1);
  if (col === sel.active.col && row === sel.active.row && sel.range.col + sel.range.width <= layout.cols && sel.range.row + sel.range.height <= layout.rows) return sel;
  return cellSelection(col, row);
}
