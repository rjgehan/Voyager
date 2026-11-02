// Range operations of the grid (DESIGN §6.21.5): fill, copy, paste and clear, computed as cell
// edits that the Workbook applies as one undo step. Fill and pastes of this app's own copies bring
// the cells' number formats along; values typed or pasted as text bring the format they imply
// (`10%`) into cells without one (§6.21.8). Pure and engine-free (the CellEdit type is a type-only
// import), so they are tested without HyperFormula and the grid.
import { MAX_COLUMNS, MAX_ROWS, parseA1, toA1 } from './a1';
import { effectiveFormat, shownCell } from './display';
import type { CellEdit } from './engine';
import { cellValue, isCellError, type CellValue, type Sheet, type SheetCell } from './format';
import { typedInput } from './input';
import { formatKind, isDateKind, isGeneral } from './numfmt';
import { shiftFormula, type CellRange } from './refs';
import { numberSeries, seriesValue } from './series';
import { parseTsv, toTsv } from './tsv';

type Content = CellEdit['content'];

/**
 * The sheet row of a row of the grid. While a filter hides or sorts rows, the rows a range covers
 * on screen are not those of the sheet (DESIGN §6.21.11); without one, every row is itself.
 */
export type RowMap = (displayRow: number) => number;
const SAME: RowMap = (r) => r;

/** What a copy put on the clipboard, kept so a paste in this app brings formulas, not values. */
export interface SheetClip {
  /** The text/plain TSV written to the clipboard; a paste with the same text is this clip. */
  text: string;
  range: CellRange;
  /** Row-major contents of the copied range (null for empty cells). */
  cells: Content[][];
  /** The copied cells' own number formats. */
  formats?: Array<Array<string | undefined>>;
  /** The sheet row of each copied row, when they were not `range`'s rows in order (a filtered view). */
  rows?: number[];
  /** The copied values as they are (numbers as numbers), for Paste values only. */
  values?: Array<Array<CellValue | null>>;
  /**
   * Set for a cut: the workbook (`source`, its path) and sheet it came from. Pasting it in that
   * workbook moves the cells (Workbook.moveCells) while they still hold what was cut.
   */
  cut?: { source: string; sheet: string };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function contentOf(cell: SheetCell | undefined): Content {
  if (!cell) return null;
  if (cell.f !== undefined) return { f: cell.f };
  if (cell.v !== undefined) return { v: cell.v };
  return null;
}

/**
 * What a copy or fill takes from a cell: its formula or value, and for a cell that only shows what
 * an array formula spilled into it, that value (an error as its text), so it pastes as it shows.
 */
export function copiedContent(cell: SheetCell | undefined): Content {
  if (cell?.f === undefined && cell?.v === undefined && cell?.c !== undefined && cell.c !== null) return { v: isCellError(cell.c) ? cell.c.e : cell.c };
  return contentOf(cell);
}

export const sameContent = (a: Content, b: Content) => (a?.f ?? null) === (b?.f ?? null) && (a?.v ?? null) === (b?.v ?? null);

function within(col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < MAX_COLUMNS && row < MAX_ROWS;
}

function inRange(col: number, row: number, r: CellRange): boolean {
  return col >= r.col && col < r.col + r.width && row >= r.row && row < r.row + r.height;
}

/** `content` moved from (row, col) to (row + dRow, col + dCol): formulas shift their references. */
function moved(content: Content, dRow: number, dCol: number): Content {
  if (content?.f !== undefined) return { f: shiftFormula(content.f, dRow, dCol) };
  return content;
}

/** Only the edits that change something, so an unchanged cell never enters the undo history. */
function changed(sheet: Sheet, edits: CellEdit[]): CellEdit[] {
  return edits.filter((e) => {
    const cell = sheet.cells[e.ref];
    return !sameContent(contentOf(cell), e.content) || (e.fmt !== undefined && (e.fmt ?? undefined) !== cell?.fmt);
  });
}

/** `edit` with the cell format `fmt` (undefined: none), when the target cell's own format differs. */
function withFormat(sheet: Sheet, edit: CellEdit, fmt: string | undefined): CellEdit {
  return fmt === sheet.cells[edit.ref]?.fmt ? edit : { ...edit, fmt: fmt ?? null };
}

/**
 * What typing or pasting `text` into a cell makes of it: the format the text implies (`10%`) is
 * set when no format applies to the cell yet, and a plain-text cell (`@`) takes the text as it is.
 */
export function typedEdit(sheet: Sheet, col: number, row: number, text: string): CellEdit {
  const fmt = effectiveFormat(sheet, col, row);
  const typed = typedInput(text, { plainText: fmt === '@' });
  const edit: CellEdit = { sheet: sheet.id, ref: toA1(col, row), content: typed.content };
  if (typed.fmt !== undefined && isGeneral(fmt)) edit.fmt = typed.fmt;
  return edit;
}

/**
 * Fills `dest` (which contains `source`) by repeating `source` across it, as the fill handle,
 * Fill down and Fill right do: formulas shift their relative references, values are copied (numbers that step evenly continue
 * as a series), and empty source cells clear their targets.
 */
export function fillEdits(sheet: Sheet, source: CellRange, dest: CellRange, opts: { handle?: boolean; rowAt?: RowMap } = {}): CellEdit[] {
  const edits: CellEdit[] = [];
  // Ranges are the grid's rows; cells are the sheet's (the same without a filter view).
  const rowAt = opts.rowAt ?? SAME;
  // Numbers that step evenly along the fill continue as a series (1, 2 → 3, 4), as in Google Sheets;
  // so does text ending in such numbers (Item 1, Item 2 → Item 3). Dragged by the fill handle, a
  // single date steps a day and a single "Item 1" steps by one (Fill down copies them).
  const down = dest.height > source.height;
  const across = !down && dest.width > source.width;
  const seriesOf = new Map<number, LineSeries | null>();
  const series = (line: number) => {
    if (!seriesOf.has(line)) {
      const cells: Array<SheetCell | undefined> = [];
      const length = down ? source.height : source.width;
      for (let i = 0; i < length; i++) cells.push(sheet.cells[down ? toA1(line, rowAt(source.row + i)) : toA1(source.col + i, rowAt(line))]);
      const first = down ? { col: line, row: rowAt(source.row) } : { col: source.col, row: rowAt(line) };
      seriesOf.set(line, down || across ? lineSeries(cells, opts.handle === true && isDateKind(formatKind(effectiveFormat(sheet, first.col, first.row)))) : null);
    }
    return seriesOf.get(line)!;
  };
  for (let row = dest.row; row < dest.row + dest.height; row++) {
    for (let col = dest.col; col < dest.col + dest.width; col++) {
      if (inRange(col, row, source) || !within(col, row)) continue;
      const srcRow = rowAt(source.row + mod(row - source.row, source.height));
      const srcCol = source.col + mod(col - source.col, source.width);
      const to = rowAt(row);
      const from = sheet.cells[toA1(srcCol, srcRow)];
      const run = series(down ? col : row);
      const index = down ? row - source.row : col - source.col;
      const content = run && (run.single === undefined || opts.handle) ? { v: run.at(index) } : moved(copiedContent(from), to - srcRow, col - srcCol);
      const edit = { sheet: sheet.id, ref: toA1(col, to), content };
      edits.push(withFormat(sheet, edit, from?.fmt));
    }
  }
  return changed(sheet, edits);
}

interface LineSeries {
  /** The value at `index` along the fill (0 is the first source cell). */
  at(index: number): number | string;
  /** A series from one cell (a date, `Item 1`), which only the fill handle continues. */
  single?: true;
}

/**
 * The series a line of source cells continues, or null: evenly stepping numbers (or dates), text
 * ending in evenly stepping numbers with the same text before them (`Item 1`, `Item 2`), and with
 * `dates`, one date (by a day) or one such text (by one). Formulas never make a series.
 */
function lineSeries(cells: ReadonlyArray<SheetCell | undefined>, dates: boolean): LineSeries | null {
  if (cells.some((c) => c?.f !== undefined)) return null;
  const values = cells.map((c) => c?.v);
  if (values.every((v) => typeof v === 'number')) {
    const nums = values as number[];
    const run = numberSeries(nums);
    if (run) return { at: (i) => seriesValue(run, i) };
    if (nums.length === 1 && dates) return { at: (i) => nums[0] + i, single: true };
    return null;
  }
  if (!values.every((v) => typeof v === 'string')) return null;
  const parts = (values as string[]).map((v) => /^(.*?)(\d+)$/.exec(v));
  if (parts.some((p) => p === null)) return null;
  const prefix = parts[0]![1];
  if (parts.some((p) => p![1] !== prefix)) return null;
  const width = parts[0]![2].length;
  const nums = parts.map((p) => Number(p![2]));
  const text = (n: number) => prefix + String(Math.max(0, Math.round(n))).padStart(width, '0');
  const run = numberSeries(nums);
  if (run) return { at: (i) => text(seriesValue(run, i)) };
  // One cell: only the fill handle steps it (and not a bare number written as text, such as a code).
  if (nums.length === 1 && prefix.trim() !== '') return { at: (i) => text(nums[0] + i), single: true };
  return null;
}

/**
 * Fill down: the top row of `range` into the rest of it; for a single row, the row above into
 * it (Mod-D in Google Sheets). Fill right is the same along columns.
 */
export function fillDownEdits(sheet: Sheet, range: CellRange, rowAt?: RowMap): CellEdit[] {
  if (range.height > 1) return fillEdits(sheet, { ...range, height: 1 }, range, { rowAt });
  if (range.row === 0) return [];
  return fillEdits(sheet, { ...range, row: range.row - 1, height: 1 }, { ...range, row: range.row - 1, height: 2 }, { rowAt });
}

export function fillRightEdits(sheet: Sheet, range: CellRange, rowAt?: RowMap): CellEdit[] {
  if (range.width > 1) return fillEdits(sheet, { ...range, width: 1 }, range, { rowAt });
  if (range.col === 0) return [];
  return fillEdits(sheet, { ...range, col: range.col - 1, width: 1 }, { ...range, col: range.col - 1, width: 2 }, { rowAt });
}

/** Clears every cell of `range` that holds something (formatting and unknown keys stay). */
export function clearEdits(sheet: Sheet, range: CellRange, rowAt?: RowMap): CellEdit[] {
  const edits: CellEdit[] = [];
  const rows = rowAt ? new Set(Array.from({ length: range.height }, (_, i) => rowAt(range.row + i))) : null;
  // A large range (a whole column) is cleared from the cells that exist, not cell by cell.
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    // A value an array formula spilled into belongs to that formula.
    if (cell.v === undefined && cell.f === undefined) continue;
    const at = parseA1(ref);
    if (!at) continue;
    const inside = rows ? rows.has(at.row) && at.col >= range.col && at.col < range.col + range.width : inRange(at.col, at.row, range);
    if (inside) edits.push({ sheet: sheet.id, ref, content: null });
  }
  return edits;
}

/**
 * The last used row and column of a sheet (-1 when empty). With `values`, only cells that show
 * something count, not cells that only hold a format.
 */
export function usedExtent(sheet: Sheet, opts: { values?: boolean } = {}): { rows: number; cols: number } {
  let rows = -1;
  let cols = -1;
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (opts.values && cell.v === undefined && cell.f === undefined && cell.c === undefined) continue;
    const at = parseA1(ref);
    if (!at) continue;
    if (at.row > rows) rows = at.row;
    if (at.col > cols) cols = at.col;
  }
  return { rows, cols };
}

/**
 * The copy of `range`: TSV of the values as shown (for other programs) and the contents (for
 * this app). A selection reaching past the used cells (a whole column) is cut to them.
 */
export function copyRange(sheet: Sheet, selection: CellRange, rowAt?: RowMap): SheetClip {
  const used = usedExtent(sheet);
  let height = Math.max(1, Math.min(selection.height, used.rows - selection.row + 1));
  if (rowAt) {
    // In a filter view, rows past the used ones come last too: cut the selection after the last used one.
    height = selection.height;
    while (height > 1 && rowAt(selection.row + height - 1) > used.rows) height--;
  }
  const range: CellRange = { ...selection, width: Math.max(1, Math.min(selection.width, used.cols - selection.col + 1)), height };
  const rows = rowAt ? Array.from({ length: height }, (_, i) => rowAt(range.row + i)) : null;
  // Rows that are the range's own, in order, need no list.
  const contiguous = !rows || rows.every((r, i) => r === rows[0] + i);
  const shown: string[][] = [];
  const cells: Content[][] = [];
  const formats: Array<Array<string | undefined>> = [];
  const values: Array<Array<CellValue | null>> = [];
  for (let i = 0; i < range.height; i++) {
    const row = rows ? rows[i] : range.row + i;
    const texts: string[] = [];
    const contents: Content[] = [];
    const fmts: Array<string | undefined> = [];
    const raw: Array<CellValue | null> = [];
    for (let col = range.col; col < range.col + range.width; col++) {
      const cell = sheet.cells[toA1(col, row)];
      texts.push(shownCell(sheet, col, row).text);
      contents.push(copiedContent(cell));
      fmts.push(cell?.fmt);
      const v = cellValue(cell);
      raw.push(v === null ? null : isCellError(v) ? v.e : v);
    }
    shown.push(texts);
    cells.push(contents);
    formats.push(fmts);
    values.push(raw);
  }
  const clip: SheetClip = { text: toTsv(shown), range: rows && contiguous ? { ...range, row: rows[0] } : range, cells, formats, values };
  if (rows && !contiguous) clip.rows = rows;
  return clip;
}


/** Whether the copied range of `sheet` still holds what `clip` took from it (a cut moves only then). */
export function clipStillHolds(sheet: Sheet, clip: SheetClip): boolean {
  const r = clip.range;
  // Rows a filter view picked out are copied, never moved.
  if (clip.rows) return false;
  for (let i = 0; i < r.height; i++) {
    for (let j = 0; j < r.width; j++) {
      const cell = sheet.cells[toA1(r.col + j, r.row + i)];
      if (!sameContent(copiedContent(cell), clip.cells[i]?.[j] ?? null) || cell?.fmt !== clip.formats?.[i]?.[j]) return false;
    }
  }
  return true;
}

/**
 * The edits a paste of `text` at `target` makes. A paste of this app's own copy (`clip`, same
 * text) brings its formulas, shifted to the new place; any other text is read as typed input,
 * cell by cell. When `target` is a larger range that the pasted block divides evenly, the block is
 * repeated across it, as Google Sheets does.
 */
export function pasteEdits(
  sheet: Sheet,
  target: CellRange,
  text: string,
  clip: SheetClip | null,
  opts: { rowAt?: RowMap; values?: Array<Array<CellValue | null>> } = {},
): { edits: CellEdit[]; range: CellRange } {
  const rowAt = opts.rowAt ?? SAME;
  const own = clip !== null && clip.text === text;
  const block: Array<Array<Content | string>> = own ? clip.cells : parseTsv(text);
  const height = block.length;
  const width = Math.max(0, ...block.map((r) => r.length));
  if (height === 0 || width === 0) return { edits: [], range: { ...target, width: 1, height: 1 } };
  const tile = target.width % width === 0 && target.height % height === 0;
  const range: CellRange = {
    col: target.col,
    row: target.row,
    width: tile ? target.width : width,
    height: tile ? target.height : height,
  };
  const edits: CellEdit[] = [];
  for (let row = range.row; row < range.row + range.height; row++) {
    const to = rowAt(row);
    for (let col = range.col; col < range.col + range.width; col++) {
      if (!within(col, to)) continue;
      const i = (row - range.row) % height;
      const j = (col - range.col) % width;
      const item = block[i][j] ?? null;
      if (opts.values) {
        // Paste values only: the values as they are, no formulas and no formats.
        const v = opts.values[i]?.[j] ?? null;
        edits.push({ sheet: sheet.id, ref: toA1(col, to), content: v === null || v === '' ? null : { v } });
      } else if (own) {
        const from = clip.rows ? clip.rows[i] : clip.range.row + i;
        const content = moved(item as Content, to - from, col - (clip.range.col + j));
        const edit = { sheet: sheet.id, ref: toA1(col, to), content };
        edits.push(clip.formats ? withFormat(sheet, edit, clip.formats[i]?.[j]) : edit);
      } else edits.push(typedEdit(sheet, col, to, (item as string | null) ?? ''));
    }
  }
  return { edits: changed(sheet, edits), range };
}
