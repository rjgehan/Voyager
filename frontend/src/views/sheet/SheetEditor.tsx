// The spreadsheet editor (DESIGN §6.21.5): title and toolbar, formula bar, grid and sheet tabs over
// one Workbook. Every change goes through the workbook (one undo step per action), which marks the
// session dirty (useSheetDocument), so autosave, drafts, conflicts and history work as for notes.
import type { DataEditorRef } from '@glideapps/glide-data-grid';
import {
  ArrowDownAZ,
  ArrowDownToLine,
  ArrowRightToLine,
  BetweenHorizontalStart,
  Bold,
  Check,
  ChartColumn,
  DecimalsArrowLeft,
  DecimalsArrowRight,
  Download,
  Funnel,
  Hash,
  ListChecks,
  PaintBucket,
  Import,
  MoveHorizontal,
  Redo2,
  Snowflake,
  Tag,
  Undo2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { SaveStatus } from '../../components/SaveStatus';
import { useBreakpoint } from '../../components/layout/useBreakpoint';
import { ContextMenu, type MenuEntry } from '../../components/overlays/ContextMenu';
import { pickFiles } from '../../features/attachments';
import { toastError } from '../../features/errors';
import { wantsNoteFocus } from '../../features/focus';
import { folderOf } from '../../features/paths';
import { isApple, keyLabel } from '../../features/platform';
import { columnLetters, parseA1, toA1 } from '../../sheets/a1';
import { setActiveSheet, type SheetActions } from '../../sheets/activeSheet';
import { guessChartOptions } from '../../sheets/charts';
import { columnFiltered, dataRegion, filterRange, looksLikeHeader } from '../../sheets/filter';
import type { Separator } from '../../sheets/csv';
import { effectiveFormat, formatShown, shownCell } from '../../sheets/display';
import { clearEdits, clipStillHolds, copyRange, fillDownEdits, fillEdits, fillRightEdits, pasteEdits, typedEdit, usedExtent, type SheetClip } from '../../sheets/edits';
import type { CellEdit, FormatEdit, Workbook } from '../../sheets/engine';
import {
  cellText,
  cellValue,
  isCellError,
  sameName,
  sheetById,
  sheetByName,
  sheetNameProblem,
  type ChartProps,
  type FilterColumn,
  type Sheet,
  type SheetFilter,
  type ValidationType,
} from '../../sheets/format';
import { dropdownItems, isValid, validationLooks, validations } from '../../sheets/validation';
import { changeDecimals, isGeneral } from '../../sheets/numfmt';
import { absoluteRangeText, parseRangeText, rangeText, type CellRange } from '../../sheets/refs';
import { typedInput } from '../../sheets/input';
import { resolveTarget, usedRange } from '../../sheets/target';
import { parseTsv } from '../../sheets/tsv';
import type { ImportedBook } from '../../sheets/xlsx';
import { confirmAction, promptText } from '../../state/dialogs';
import { toast } from '../../state/toasts';
import type { SessionSnapshot } from '../../sync/DocumentSession';
import { InlineTitle } from '../markdown/InlineTitle';
import { ChartsPane } from './ChartsPane';
import { FormulaBar, type EditTarget, type FormulaBarHandle, type Move } from './FormulaBar';
import { cellSelection, clampSelection, displayRange, gridLayout, HEADER_BAND, rowView, sheetRange, sheetRows, TOUCH_HEADER_BAND, type CellAt, type SheetSelection } from './gridModel';
import { ConditionalDialog } from './ConditionalDialog';
import { DropdownList } from './DropdownList';
import { ValidationDialog } from './ValidationDialog';
import { FilterMenu } from './FilterMenu';
import {
  addToWorkbook,
  baseName,
  bookToFile,
  createSheetFile,
  csvBook,
  exportCsv,
  exportXlsx,
  IMPORT_ACCEPT,
  importKind,
  readCsvFile,
  readWorkbookFile,
  type ImportKind,
} from './importExport';
import { ChartDialog, ColumnWidthDialog, ImportDialog, NamedRangesDialog, NumberFormatDialog, type ImportChoice } from './SheetDialogs';
import { useFormulaAssist } from './formulaAssist';
import { useReferencePicking } from './referencePicking';
import { SheetGrid, type GridFilter, type ScreenRect, type SheetGridHandlers } from './SheetGrid';
import { SheetTabs } from './SheetTabs';
import { useCoarsePointer, useSheetTheme } from './theme';

interface Props {
  path: string;
  snapshot: SessionSnapshot;
  workbook: Workbook;
  version: number;
}

/** Per file, while the page lives: the open sheet, each sheet's selection, and whether the charts pane is folded. */
const remembered = new Map<string, { sheetId: string; selections: ReadonlyMap<string, SheetSelection>; chartsOpen: boolean }>();

/** The last copy (or cut) made in any spreadsheet, so a paste in this app brings formulas, or moves the cut cells. */
let lastClip: SheetClip | null = null;

/** Until when a paste is Mod-Shift-V's: values only. */
let pasteValuesUntil = 0;

/** Escape drops a pending cut: a later paste copies. */
function dropPendingCut(): void {
  if (lastClip?.cut) lastClip = { ...lastClip, cut: undefined };
}

/** Rows at most that "Bold" changes in one go (a whole-column selection bolds columns instead). */
const BOLD_LIMIT = 5000;
/** Cells at most that a number format is set on one by one; whole columns or rows take a column or row format. */
const FORMAT_LIMIT = 10000;

type Dialog =
  | { kind: 'named' | 'width' | 'format' | 'conditional' }
  | { kind: 'validation'; start?: ValidationType }
  | { kind: 'chart'; id: string | null; initial: ChartProps }
  | { kind: 'import'; file: File; type: ImportKind; separator: Separator; text?: string; book?: ImportedBook };

/** The route's `#Summary` or `#Budget!A1:C3`, decoded. */
function decodeHash(hash: string): string | null {
  if (!hash || hash === '#') return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function step(at: CellAt, move: Move): CellAt {
  switch (move) {
    case 'down':
      return { col: at.col, row: at.row + 1 };
    case 'up':
      return { col: at.col, row: Math.max(0, at.row - 1) };
    case 'right':
      return { col: at.col + 1, row: at.row };
    case 'left':
      return { col: Math.max(0, at.col - 1), row: at.row };
    default:
      return at;
  }
}

interface ToolProps {
  title: string;
  hotkey?: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick(e: MouseEvent<HTMLButtonElement>): void;
  children: ReactNode;
}

function ToolButton({ title, hotkey, disabled, pressed, onClick, children }: ToolProps) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={title}
      title={hotkey ? `${title} (${keyLabel(hotkey)})` : title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SheetEditor({ path, snapshot, workbook, version }: Props) {
  const touch = useCoarsePointer();
  const theme = useSheetTheme(touch);
  const phone = useBreakpoint() === 'phone';
  const [sheetId, setSheetId] = useState(() => remembered.get(path)?.sheetId ?? workbook.file.sheets[0].id);
  const [selections, setSelections] = useState<ReadonlyMap<string, SheetSelection>>(() => remembered.get(path)?.selections ?? new Map());
  const [growth, setGrowth] = useState<ReadonlyMap<string, { rows: number; cols: number }>>(new Map());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [freezeMenu, setFreezeMenu] = useState<{ x: number; y: number } | null>(null);
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);
  const [linesMenu, setLinesMenu] = useState<{ x: number; y: number } | null>(null);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  /** The filter menu of a column, open under its button. */
  const [filterMenu, setFilterMenu] = useState<{ col: number; anchor: ScreenRect } | null>(null);
  /** A dropdown cell's list (sheet coordinates), open under the cell. */
  const [dropdown, setDropdown] = useState<{ at: CellAt; anchor: ScreenRect } | null>(null);
  const [validationMenu, setValidationMenu] = useState<{ x: number; y: number } | null>(null);
  /** The cut waiting to be pasted, shown with a dashed outline while it is still the last copy. */
  const [cutMark, setCutMark] = useState<SheetClip | null>(null);
  /** The range a formula being typed points at. */
  const [picked, setPicked] = useState<CellRange | null>(null);
  // On a phone the charts start folded, so the grid keeps its room.
  const [chartsOpen, setChartsOpen] = useState(() => remembered.get(path)?.chartsOpen ?? !phone);
  const location = useLocation();
  const [gridHeight, setGridHeight] = useState(600);
  const gridRef = useRef<DataEditorRef | null>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  const gridBox = useRef<HTMLDivElement>(null);
  const bar = useRef<FormulaBarHandle>(null);
  const editable = snapshot.loaded && snapshot.status !== 'readonly' && snapshot.status !== 'loading' && !snapshot.lossy;

  // The workbook's model is mutable; `version` changes with each change.
  const model = useMemo(() => ({ file: workbook.file, version }), [workbook, version]);
  const sheet: Sheet = sheetById(model.file, sheetId) ?? model.file.sheets[0];
  const grown = growth.get(sheet.id);
  // The rows a filter shows are worked out when the filter (or the sheet's rows) changes, not with
  // every edit: as in Google Sheets, a row does not vanish or move while it is being typed in.
  const viewKey = `${sheet.id}
${sheet.structure ?? ''}
${sheet.frozen.rows}
${JSON.stringify(sheet.filter ?? null)}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when the filter changed
  const filterRows = useMemo(() => rowView(sheet, sheet.frozen.rows), [viewKey]);
  const layout = useMemo(
    () =>
      gridLayout(sheetById(model.file, sheetId) ?? model.file.sheets[0], {
        rowHeight: touch ? 32 : 24,
        headerBand: touch ? TOUCH_HEADER_BAND : HEADER_BAND,
        minRows: grown?.rows ?? 0,
        minCols: grown?.cols ?? 0,
        // Frozen rows take at most half the grid (a phone in landscape).
        maxFrozenHeight: gridHeight / 2,
        view: () => filterRows,
      }),
    [model, sheetId, touch, grown, gridHeight, filterRows],
  );
  const view = layout.view;
  /** The display rows of a range as sheet rows, for edits (undefined without a filter view). */
  const rowAt = view.active ? view.sheetRow : undefined;
  const selection = clampSelection(selections.get(sheet.id) ?? cellSelection(0, 0), layout);
  /** The active cell in the sheet (the selection is in the grid's rows). */
  const activeAt: CellAt = { col: selection.active.col, row: view.sheetRow(selection.active.row) };
  const activeRef = toA1(activeAt.col, activeAt.row);
  const activeCell = sheet.cells[activeRef];
  const activeValue = cellValue(activeCell);
  const activeFormat = effectiveFormat(sheet, activeAt.col, activeAt.row);
  /** The selection's range in the sheet (the smallest that holds its rows, with a filter view). */
  const selectedRange = sheetRange(view, selection.range);
  // How data validation shows cells (checkboxes, dropdowns, invalid values), with every change.
  const looks = useMemo(() => validationLooks(model.file, sheetById(model.file, sheetId) ?? model.file.sheets[0]), [model, sheetId]);
  const single = selection.range.width === 1 && selection.range.height === 1;
  const wholeColumns = selection.range.row === 0 && selection.range.height >= layout.rows;
  const wholeRows = !wholeColumns && selection.range.col === 0 && selection.range.width >= layout.cols;

  // A click or drag on cells while a formula is typed inserts references into it.
  useReferencePicking({ gridBox, gridRef, portalRef, barInput: () => bar.current?.editingInput() ?? null, layout: () => layout, onPick: setPicked });
  // Typing `=SU` suggests functions; inside a call, its signature shows.
  useFormulaAssist({ portalRef, barInput: () => bar.current?.editingInput() ?? null });

  useEffect(() => {
    remembered.set(path, { sheetId: sheet.id, selections, chartsOpen });
  }, [path, sheet.id, selections, chartsOpen]);

  useLayoutEffect(() => {
    const el = gridBox.current;
    if (!el) return;
    const measure = () => setGridHeight(el.clientHeight || 600);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---------- operations ----------
  // Plain functions: the model is mutable, so memoizing on it would go stale.

  const focusGrid = () => {
    if (!touch) gridRef.current?.focus();
  };

  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      toast(errorText(e), { kind: 'error' });
    }
  };

  const select = (sel: SheetSelection, id = sheet.id) => setSelections((m) => new Map(m).set(id, sel));

  const setCells = (edits: CellEdit[], opts: { implyFormats?: boolean } = {}) => {
    if (edits.length > 0) run(() => workbook.setCells(edits, opts));
  };

  /** The text the formula bar edits for a cell: its formula, or its value as typed (dates as dates). */
  const editText = (s: Sheet, at: CellAt) => cellText(s.cells[toA1(at.col, at.row)], effectiveFormat(s, at.col, at.row));

  /** A grid cell (display row) as a sheet cell. */
  const toSheet = (at: CellAt): CellAt => ({ col: at.col, row: view.sheetRow(at.row) });

  /** Edits a grid cell in the formula bar; the bar's target is the sheet cell. */
  const edit = (at: CellAt, initial?: string) => {
    const target = toSheet(at);
    bar.current?.edit({ ...target, sheet: sheet.id }, editText(sheet, target), initial);
  };

  const commit = (target: EditTarget, text: string, move: Move) => {
    const s = sheetById(workbook.file, target.sheet);
    if (!s) return;
    // Typed input brings the format it implies (`10%`, `=TODAY()`) into a cell without one.
    if (text !== editText(s, target)) {
      const typed = typedEdit(s, target.col, target.row, text);
      // A strict validation refuses other input, as Google Sheets' "Reject the input".
      const rule = validations(s)?.(target.col, target.row)?.validation;
      const value = typed.content?.v;
      if (rule?.strict && value !== undefined && !isValid(workbook.file, s, rule, value, formatShown(value, typed.fmt ?? effectiveFormat(s, target.col, target.row)).text)) {
        toast(`“${text}” is not one of the values ${toA1(target.col, target.row)} takes.`, { kind: 'error' });
        if (!touch) focusGrid();
        return;
      }
      run(() => workbook.setCells([typed], { implyFormats: true }));
    }
    if (move === 'none' || s.id !== sheet.id) return;
    // Moves go along the grid's rows (with a filter view, the rows it shows).
    const next = step({ col: target.col, row: view.displayRow(target.row) ?? selection.active.row }, move);
    select(cellSelection(next.col, next.row));
    // On a phone the keyboard stays up for the next cell; elsewhere the grid takes the keys again.
    if (touch && editable) {
      const at = toSheet(next);
      bar.current?.edit({ ...at, sheet: s.id }, editText(s, at));
    } else focusGrid();
  };

  const undo = () => {
    workbook.undo();
  };
  const redo = () => {
    workbook.redo();
  };
  const fillDown = () => setCells(fillDownEdits(sheet, selection.range, rowAt));
  const fillRight = () => setCells(fillRightEdits(sheet, selection.range, rowAt));

  /** Bold rows; with whole columns selected, bold columns. */
  const toggleBold = () => {
    const r = selection.range;
    run(() =>
      workbook.transact(() => {
        if (wholeColumns) {
          const keys = Array.from({ length: Math.min(r.width, 1000) }, (_, i) => columnLetters(r.col + i));
          const all = keys.every((k) => sheet.cols[k]?.bold === true);
          for (const k of keys) {
            const props = { ...sheet.cols[k] };
            if (all) delete props.bold;
            else props.bold = true;
            workbook.setColumn(sheet.id, k, props);
          }
          return;
        }
        const keys = Array.from({ length: Math.min(r.height, BOLD_LIMIT) }, (_, i) => String(view.sheetRow(r.row + i) + 1));
        const all = keys.every((k) => sheet.rows[k]?.bold === true);
        for (const k of keys) {
          const props = { ...sheet.rows[k] };
          if (all) delete props.bold;
          else props.bold = true;
          workbook.setRow(sheet.id, k, props);
        }
      }),
    );
  };

  const setFrozen = (rows: number, cols: number) => run(() => workbook.setFrozen(sheet.id, { rows, cols }));

  // ---------- inserting and deleting rows and columns ----------

  /** The selected rows (the active cell's row when whole columns are selected), and columns likewise. */
  const rowSpan = wholeColumns ? { at: activeAt.row, count: 1 } : { at: selectedRange.row, count: selection.range.height };
  const colSpan = wholeRows ? { at: selection.active.col, count: 1 } : { at: selection.range.col, count: selection.range.width };
  const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  const rowsLabel =
    rowSpan.count === 1 ? `row ${rowSpan.at + 1}` : view.active && !wholeColumns ? `${rowSpan.count} rows` : `rows ${rowSpan.at + 1}–${rowSpan.at + rowSpan.count}`;
  const colsLabel = colSpan.count === 1 ? `column ${columnLetters(colSpan.at)}` : `columns ${columnLetters(colSpan.at)}–${columnLetters(colSpan.at + colSpan.count - 1)}`;
  // With a filter view, rows are inserted above the first selected row's sheet row or below the last's.
  const insertRows = (below: boolean) =>
    run(() => {
      if (!view.active || wholeColumns) workbook.insertRows(sheet.id, rowSpan.at + (below ? rowSpan.count : 0), rowSpan.count);
      else workbook.insertRows(sheet.id, below ? view.sheetRow(selection.range.row + selection.range.height - 1) + 1 : view.sheetRow(selection.range.row), rowSpan.count);
    });
  const insertColumns = (right: boolean) => run(() => workbook.insertColumns(sheet.id, colSpan.at + (right ? colSpan.count : 0), colSpan.count));
  const deleteRows = () =>
    run(() => {
      if (!view.active || wholeColumns) {
        workbook.deleteRows(sheet.id, rowSpan.at, rowSpan.count);
        return;
      }
      // The selected rows as the filter shows them: deleted from the bottom up, as one step.
      const rows = [...new Set(sheetRows(view, selection.range))].sort((a, b) => b - a);
      workbook.transact(() => {
        for (const r of rows) workbook.deleteRows(sheet.id, r, 1);
      });
    });
  const deleteColumns = () => run(() => workbook.deleteColumns(sheet.id, colSpan.at, colSpan.count));
  const lineItems: MenuEntry[] = [
    { id: 'rowsAbove', label: `Insert ${plural(rowSpan.count, 'row', 'rows')} above`, run: () => insertRows(false) },
    { id: 'rowsBelow', label: `Insert ${plural(rowSpan.count, 'row', 'rows')} below`, run: () => insertRows(true) },
    { id: 'colsLeft', label: `Insert ${plural(colSpan.count, 'column', 'columns')} left`, run: () => insertColumns(false) },
    { id: 'colsRight', label: `Insert ${plural(colSpan.count, 'column', 'columns')} right`, run: () => insertColumns(true) },
    'separator',
    { id: 'deleteRows', label: `Delete ${rowsLabel}`, danger: true, run: deleteRows },
    { id: 'deleteCols', label: `Delete ${colsLabel}`, danger: true, run: deleteColumns },
  ];

  const setWidths = (cols: number[], width: number | null) => {
    run(() =>
      workbook.transact(() => {
        for (const col of cols) {
          const key = columnLetters(col);
          const props = { ...sheet.cols[key] };
          if (width === null) delete props.w;
          else props.w = width;
          workbook.setColumn(sheet.id, key, props);
        }
      }),
    );
  };

  // ---------- number formats ----------

  /** The selection for messages: `B3`, `A1:C4`, `columns B–D`, `rows 2–5`. */
  const selectionLabel = (() => {
    const r = selection.range;
    if (wholeColumns) return r.width === 1 ? `column ${columnLetters(r.col)}` : `columns ${columnLetters(r.col)}–${columnLetters(r.col + r.width - 1)}`;
    if (wholeRows) return r.height === 1 ? `row ${activeAt.row + 1}` : `rows ${selectedRange.row + 1}–${selectedRange.row + selectedRange.height}`;
    return single ? activeRef : rangeText(selectedRange);
  })();

  /**
   * Sets the number format of the selection (undefined: Automatic) as one undo step: whole columns
   * or rows get a column or row format (and their cells lose their own), other selections a format
   * per cell. Automatic on a cell whose row or column has a format stores `General`, which wins.
   */
  const applyFormat = (fmt: string | undefined) => {
    const r = selection.range;
    const rows = view.active ? new Set(sheetRows(view, r)) : null;
    const inRange = (ref: string) => {
      const at = parseA1(ref);
      if (at === null || at.col < r.col || at.col >= r.col + r.width) return false;
      return rows ? rows.has(at.row) : at.row >= r.row && at.row < r.row + r.height;
    };
    run(() =>
      workbook.transact(() => {
        if (wholeColumns || wholeRows) {
          const keys = wholeColumns
            ? Array.from({ length: Math.min(r.width, 1000) }, (_, i) => columnLetters(r.col + i))
            : Array.from({ length: Math.min(r.height, BOLD_LIMIT) }, (_, i) => String(view.sheetRow(r.row + i) + 1));
          for (const key of keys) {
            const props = { ...(wholeColumns ? sheet.cols[key] : sheet.rows[key]) };
            if (fmt === undefined) delete props.fmt;
            else props.fmt = fmt;
            if (wholeColumns) workbook.setColumn(sheet.id, key, props);
            else workbook.setRow(sheet.id, key, props);
          }
          const own: FormatEdit[] = Object.entries(sheet.cells)
            .filter(([ref, c]) => c.fmt !== undefined && inRange(ref))
            .map(([ref]) => ({ sheet: sheet.id, ref, fmt: null }));
          workbook.setFormats(own);
          return;
        }
        if (r.width * r.height > FORMAT_LIMIT) throw new Error(`Select whole columns or rows to format more than ${FORMAT_LIMIT.toLocaleString('en-US')} cells.`);
        const edits: FormatEdit[] = [];
        for (let d = r.row; d < r.row + r.height; d++) {
          const row = view.sheetRow(d);
          for (let col = r.col; col < r.col + r.width; col++) {
            const ref = toA1(col, row);
            const inherited = sheet.rows[String(row + 1)]?.fmt ?? sheet.cols[columnLetters(col)]?.fmt;
            const next = fmt ?? (isGeneral(inherited) ? null : 'General');
            if ((sheet.cells[ref]?.fmt ?? null) !== next) edits.push({ sheet: sheet.id, ref, fmt: next });
          }
        }
        workbook.setFormats(edits);
      }),
    );
  };

  const changeSelectionDecimals = (delta: 1 | -1) => {
    const next = changeDecimals(activeFormat, delta, typeof activeValue === 'number' ? activeValue : null);
    if (next === null) toast('Dates, times and text have no decimal places to change.');
    else applyFormat(next);
  };

  // ---------- charts ----------

  const insertChart = () => {
    // A single cell charts the sheet's data; a selection charts itself.
    const range = single ? (usedRange(sheet) ?? selectedRange) : selectedRange;
    setDialog({ kind: 'chart', id: null, initial: { type: 'bar', range: rangeText(range), ...guessChartOptions(sheet, range) } });
  };

  const saveChart = (id: string | null, props: ChartProps) => {
    setDialog(null);
    run(() => {
      if (id === null) workbook.addChart(sheet.id, props);
      else workbook.setChart(sheet.id, id, props);
    });
    setChartsOpen(true);
  };

  const deleteChart = async (id: string) => {
    const chart = sheet.charts[id];
    if (!chart) return;
    const ok = await confirmAction({
      title: `Delete the chart${chart.title ? ` “${chart.title}”` : ''}?`,
      message: 'Undo brings it back.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) run(() => workbook.setChart(sheet.id, id, null));
  };

  // ---------- data validation: checkboxes and dropdowns ----------

  /** Ticks or unticks a checkbox cell (sheet coordinates). */
  const toggleCheckbox = (at: CellAt) => {
    if (!editable) return;
    const v = cellValue(sheet.cells[toA1(at.col, at.row)]);
    setCells([{ sheet: sheet.id, ref: toA1(at.col, at.row), content: { v: v !== true } }]);
  };

  /** Space: the selection's checkboxes all ticked, or all unticked when they all were (one undo step). */
  const toggleSelectionCheckboxes = () => {
    if (!editable || !looks) return;
    const r = selection.range;
    const cells: CellAt[] = [];
    for (let d = r.row; d < r.row + Math.min(r.height, 10000); d++) {
      const row = view.sheetRow(d);
      for (let col = r.col; col < r.col + r.width; col++) {
        const look = looks(col, row);
        if (look?.kind === 'checkbox' && !look.invalid) cells.push({ col, row });
      }
    }
    const tick = !cells.every((c) => cellValue(sheet.cells[toA1(c.col, c.row)]) === true);
    setCells(cells.map((c) => ({ sheet: sheet.id, ref: toA1(c.col, c.row), content: { v: tick } })));
  };

  /** Inserts checkboxes on the selection (Google Sheets' Insert > Checkbox): a checkbox validation. */
  const insertCheckboxes = () => run(() => workbook.addItem('validation', sheet.id, { range: rangeText(selectedRange), type: 'checkbox' }));

  const dropdownRule = dropdown ? validations(sheet)?.(dropdown.at.col, dropdown.at.row)?.validation : undefined;
  const pickDropdown = (item: string) => {
    if (!dropdown) return;
    const { at } = dropdown;
    setDropdown(null);
    run(() => workbook.setCells([typedEdit(sheet, at.col, at.row, item)], { implyFormats: true }));
    focusGrid();
  };

  const validationItems: MenuEntry[] = [
    { id: 'checkbox', label: 'Insert checkboxes', run: insertCheckboxes },
    { id: 'dropdown', label: 'Insert dropdown…', run: () => setDialog({ kind: 'validation', start: 'list' }) },
    'separator',
    { id: 'rules', label: 'Data validation rules…', run: () => setDialog({ kind: 'validation' }) },
  ];

  // ---------- sorting and filters ----------

  const filter = sheet.filter;
  const fRange = filterRange(filter);
  const activeLetters = columnLetters(activeAt.col);

  /** What a sort or a new filter takes: the selection, or the data around a single cell (as in Google Sheets). */
  const dataRange = (): CellRange => (single ? dataRegion(sheet, activeAt.col, activeAt.row) : selectedRange);

  /** Sort range: the selected rows (or the data around the cell, below its header) by the active column. */
  const sortRangeBy = (desc: boolean) => {
    let range = dataRange();
    if (single && looksLikeHeader(sheet, range)) range = { ...range, row: range.row + 1, height: range.height - 1 };
    if (range.height < 2) {
      toast('Select the rows to sort, or a cell in a table of data.');
      return;
    }
    run(() => workbook.sortRange(sheet.id, range, [{ col: activeAt.col, desc }]));
  };

  /** Sort sheet: every used row below the frozen ones, by the active column. */
  const sortSheetBy = (desc: boolean) => {
    const used = usedExtent(sheet);
    const top = sheet.frozen.rows;
    if (used.rows < top + 1) {
      toast('There are no rows below the frozen ones to sort.');
      return;
    }
    run(() => workbook.sortRange(sheet.id, { col: 0, row: top, width: used.cols + 1, height: used.rows - top + 1 }, [{ col: activeAt.col, desc }]));
  };

  /** Creates a filter on the data (its first row holds the buttons), or removes the sheet's. */
  const toggleFilter = () => {
    setFilterMenu(null);
    if (filter) {
      run(() => workbook.setFilter(sheet.id, null));
      return;
    }
    run(() => workbook.setFilter(sheet.id, { range: rangeText(dataRange()), cols: {} }));
  };

  const setFilterColumn = (col: number, column: FilterColumn | null) => {
    if (!filter) return;
    const cols = { ...filter.cols };
    const key = columnLetters(col);
    if (column) cols[key] = column;
    else delete cols[key];
    run(() => workbook.setFilter(sheet.id, { ...filter, cols }));
  };

  const sortFilter = (col: number, desc: boolean) => {
    if (!filter) return;
    const next: SheetFilter = { ...filter, sort: desc ? { col: columnLetters(col), desc: true } : { col: columnLetters(col) } };
    run(() => workbook.setFilter(sheet.id, next));
  };

  const clearFilterConditions = () => {
    if (!filter) return;
    const next: SheetFilter = { cols: {} };
    if (filter.range !== undefined) next.range = filter.range;
    if (filter.extra) next.extra = filter.extra;
    run(() => workbook.setFilter(sheet.id, next));
  };

  /** Opens the filter menu of the active column, under its button (from the toolbar or the palette). */
  const openColumnFilter = (fallback?: ScreenRect) => {
    if (!filter || !fRange) return;
    const col = Math.max(fRange.col, Math.min(fRange.col + fRange.width - 1, activeAt.col));
    const shown = view.displayRow(fRange.row);
    const bounds = shown !== null && shown >= layout.frozenRows ? gridRef.current?.getBounds(col, shown - layout.frozenRows) : undefined;
    const box = gridBox.current?.getBoundingClientRect();
    setFilterMenu({ col, anchor: bounds ?? fallback ?? { x: box?.left ?? 0, y: box?.top ?? 0, width: 100, height: 0 } });
  };

  const filterOn = filter !== undefined && (filter.sort !== undefined || Object.values(filter.cols).some(columnFiltered));
  const filterKey = JSON.stringify(filter ?? null);
  const gridFilter = useMemo<GridFilter | null>(() => {
    if (!filter || !fRange) return null;
    const on = new Set<number>();
    for (let col = fRange.col; col < fRange.col + fRange.width; col++) {
      const letters = columnLetters(col);
      if (columnFiltered(filter.cols[letters]) || filter.sort?.col === letters) on.add(col);
    }
    return { row: fRange.row, col: fRange.col, width: fRange.width, on };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the filter's text says when it changed
  }, [filterKey]);

  const sortRangeLabel = (() => {
    let range = dataRange();
    if (single && looksLikeHeader(sheet, range)) range = { ...range, row: range.row + 1, height: Math.max(1, range.height - 1) };
    return rangeText(range);
  })();
  const sortItems: MenuEntry[] = [
    { id: 'filter', label: filter ? 'Remove filter' : 'Create a filter', run: toggleFilter },
    ...(filter && fRange ? [{ id: 'filterColumn', label: `Filter column ${columnLetters(Math.max(fRange.col, Math.min(fRange.col + fRange.width - 1, activeAt.col)))}…`, run: () => openColumnFilter(sortMenu ? { x: sortMenu.x, y: sortMenu.y - 4, width: 0, height: 0 } : undefined) }] : []),
    ...(filterOn ? [{ id: 'clearFilter', label: 'Clear the filter’s conditions and sort', run: clearFilterConditions }] : []),
    'separator',
    { id: 'rangeAsc', label: `Sort range ${sortRangeLabel} by column ${activeLetters}, A → Z`, run: () => sortRangeBy(false) },
    { id: 'rangeDesc', label: `Sort range ${sortRangeLabel} by column ${activeLetters}, Z → A`, run: () => sortRangeBy(true) },
    { id: 'sheetAsc', label: `Sort sheet by column ${activeLetters}, A → Z`, run: () => sortSheetBy(false) },
    { id: 'sheetDesc', label: `Sort sheet by column ${activeLetters}, Z → A`, run: () => sortSheetBy(true) },
  ];

  // ---------- import and export ----------

  const startImport = async () => {
    const [file] = await pickFiles({ accept: IMPORT_ACCEPT, multiple: false });
    if (!file) return;
    const type = importKind(file.name);
    if (!type) {
      toast('Choose a CSV, TSV or Excel file to import.', { kind: 'error' });
      return;
    }
    try {
      if (type === 'csv') {
        const { text, separator } = await readCsvFile(file);
        setDialog({ kind: 'import', file, type, separator, text });
      } else setDialog({ kind: 'import', file, type, separator: ',', book: await readWorkbookFile(file) });
    } catch (e) {
      toastError(e, `Could not read ${file.name}`);
    }
  };

  const finishImport = async (d: Extract<Dialog, { kind: 'import' }>, choice: ImportChoice) => {
    setDialog(null);
    const book = d.type === 'csv' ? csvBook(d.file.name, d.text ?? '', choice.separator, choice.convert) : d.book;
    if (!book) return;
    const report = (skipped: string[]) =>
      toast([`Imported “${d.file.name}”.`, ...skipped.slice(0, 3)].join(' '), { timeout: skipped.length > 0 ? 10000 : 4000 });
    if (choice.target === 'sheet') {
      try {
        const { sheetId: id, skipped } = addToWorkbook(workbook, book);
        if (id) setSheetId(id);
        report(skipped);
      } catch (e) {
        toast(errorText(e), { kind: 'error' });
      }
      return;
    }
    try {
      await createSheetFile(folderOf(path), baseName(d.file.name), bookToFile(book));
      report(book.skipped);
    } catch (e) {
      toastError(e, `Could not import ${d.file.name}`);
    }
  };

  const exportItems: MenuEntry[] = [
    { id: 'csv', label: `Download “${sheet.name}” as CSV`, run: () => exportCsv(path, workbook.file, sheet) },
    {
      id: 'xlsx',
      label: 'Download as Excel (.xlsx)',
      run: () => void exportXlsx(path, workbook.file).catch((e: unknown) => toastError(e, 'Could not export the workbook')),
    },
  ];

  // The new sheet takes the keys at once, as in Google Sheets.
  const addSheet = () => {
    run(() => setSheetId(workbook.addSheet()));
    focusGrid();
  };

  const renameSheet = async (id: string) => {
    const current = sheetById(workbook.file, id);
    if (!current) return;
    const name = await promptText({
      title: 'Rename sheet',
      label: 'Name',
      value: current.name,
      confirmLabel: 'Rename',
      validate: (v) => (v === current.name ? null : sheetNameProblem(v, workbook.file, id)),
    });
    if (name !== null && name !== current.name) run(() => workbook.renameSheet(id, name));
  };

  const deleteSheet = async (id: string) => {
    const target = sheetById(workbook.file, id);
    if (!target || workbook.file.sheets.length <= 1) return;
    const ok = await confirmAction({
      title: `Delete sheet “${target.name}”?`,
      message: 'Formulas that refer to it will show #REF!. Undo brings it back.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const index = workbook.file.sheets.findIndex((s) => s.id === id);
    run(() => workbook.removeSheet(id));
    const sheets = workbook.file.sheets;
    if (!sheetById(workbook.file, id) && id === sheet.id) setSheetId(sheets[Math.min(index, sheets.length - 1)].id);
  };

  /** The name box: a cell, a range (on another sheet too) or a named range. */
  const goTo = (text: string): boolean => {
    const file = workbook.file;
    const name = Object.keys(file.named).find((n) => sameName(n, text.trim()));
    const target = parseRangeText(name !== undefined ? file.named[name] : text);
    if (!target) return false;
    const dest = target.sheet !== null ? sheetByName(file, target.sheet) : sheet;
    if (!dest) return false;
    showRange(dest, target.range);
    // The grid scrolls to the new selection itself.
    focusGrid();
    return true;
  };

  /** Opens sheet `dest` with `r` (sheet rows) selected. */
  const showRange = (dest: Sheet, sheetR: CellRange) => {
    setSheetId(dest.id);
    // On this sheet, a filter view may show the rows elsewhere, or hide them.
    let r = sheetR;
    if (dest.id === sheet.id && view.active) {
      const shown = displayRange(view, sheetR);
      if (shown) r = shown;
      else {
        const first = view.displayRow(sheetR.row);
        r = { ...sheetR, row: first ?? Math.max(0, view.displayRow(sheetR.row + sheetR.height) ?? sheetR.row), height: 1 };
        if (first === null) toast(`Row ${sheetR.row + 1} is hidden by the filter.`);
      }
    }
    select({ active: { col: r.col, row: r.row }, range: r }, dest.id);
    // The selection may lie beyond the rows the grid has shown so far.
    setGrowth((m) => {
      const g = m.get(dest.id);
      return new Map(m).set(dest.id, { rows: Math.max(g?.rows ?? 0, r.row + r.height + 100), cols: Math.max(g?.cols ?? 0, r.col + r.width + 4) });
    });
  };

  // A link or embed that opened `Budget.sheet#Summary` or `#Budget!A1:C3` (DESIGN §6.21.7).
  const hashTarget = decodeHash(location.hash);
  const followHash = useRef<(text: string) => void>(() => {});
  useLayoutEffect(() => {
    followHash.current = (text) => {
      const t = resolveTarget(workbook.file, text);
      if (!t) return;
      if (t.range) showRange(t.sheet, t.range);
      else setSheetId(t.sheet.id);
    };
  });
  useEffect(() => {
    if (hashTarget !== null) followHash.current(hashTarget);
  }, [hashTarget, path]);

  // ---------- the clipboard (frozen cells included, so not Glide's) ----------

  const latest = useRef({ path, workbook, sheet, selection, editable, setCells, select, view });
  useLayoutEffect(() => {
    latest.current = { path, workbook, sheet, selection, editable, setCells, select, view };
  });

  useEffect(() => {
    const focused = () => !!gridBox.current?.contains(document.activeElement) && !bar.current?.isEditing();
    const copy = (e: ClipboardEvent, cut: boolean) => {
      if (!focused() || !e.clipboardData) return;
      const { path: source, sheet: s, selection: sel, editable: canEdit, view: v } = latest.current;
      const clip = copyRange(s, sel.range, v.active ? v.sheetRow : undefined);
      e.clipboardData.setData('text/plain', clip.text);
      e.preventDefault();
      // A cut moves the cells when it is pasted in this spreadsheet, as in Google Sheets and Excel;
      // until then they stay, marked (pasted elsewhere, the cut is a copy).
      lastClip = cut && canEdit ? { ...clip, cut: { source, sheet: s.id } } : clip;
      setCutMark(lastClip.cut ? lastClip : null);
    };
    const onCopy = (e: ClipboardEvent) => copy(e, false);
    const onCut = (e: ClipboardEvent) => copy(e, true);
    const onPaste = (e: ClipboardEvent) => {
      if (!focused() || !e.clipboardData) return;
      const { path: here, workbook: wb, sheet: s, selection: sel, editable: canEdit, setCells: apply, select: choose, view: v } = latest.current;
      e.preventDefault();
      if (!canEdit) return;
      const text = e.clipboardData.getData('text/plain');
      // Mod-Shift-V: the values only, without formulas or formats (Google Sheets' Paste values only).
      const valuesOnly = Date.now() < pasteValuesUntil;
      pasteValuesUntil = 0;
      const clip = lastClip;
      if (clip?.cut && clip.text === text && !valuesOnly) {
        setCutMark(null);
        const from = clip.cut.source === here ? sheetById(wb.file, clip.cut.sheet) : undefined;
        if (from && clipStillHolds(from, clip)) {
          // The cells go to the sheet row the grid shows first (with a filter view, it may differ).
          const range: CellRange = { ...clip.range, col: sel.range.col, row: v.sheetRow(sel.range.row) };
          try {
            wb.moveCells({ sheet: from.id, range: clip.range }, { sheet: s.id, col: range.col, row: range.row });
          } catch (err) {
            toast(errorText(err), { kind: 'error' });
            return;
          }
          // Pasting again copies the moved cells from their new place.
          const moved = sheetById(wb.file, s.id);
          lastClip = moved ? { ...copyRange(moved, range), text: clip.text } : null;
          const shown = displayRange(v, range) ?? { ...range, row: sel.range.row, height: 1 };
          choose({ active: { col: shown.col, row: shown.row }, range: shown });
          return;
        }
        // The cut cells changed meanwhile (or are in another spreadsheet): an ordinary paste.
        lastClip = { ...clip, cut: undefined };
      }
      const own = lastClip !== null && lastClip.text === text;
      // Values only: this app's copy as its values; other text as typed, without the formats it implies.
      const values = valuesOnly
        ? own && lastClip?.values
          ? lastClip.values
          : parseTsv(text).map((line) => line.map((field) => typedInput(field).content?.v ?? (field === '' ? null : field)))
        : undefined;
      const { edits, range } = pasteEdits(s, sel.range, text, lastClip, { rowAt: v.active ? v.sheetRow : undefined, values });
      // Text from elsewhere is typed input: its formulas imply formats as typed ones do.
      apply(edits, { implyFormats: !own && !valuesOnly });
      choose({ active: { col: range.col, row: range.row }, range });
    };
    // Mod-Shift-V is a paste event like any other: the key says to paste values only.
    const onKey = (e: KeyboardEvent) => {
      const mod = isApple ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v' && focused()) pasteValuesUntil = Date.now() + 1000;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  // ---------- palette commands, focus ----------

  const actions = useRef<Omit<SheetActions, 'path'> | null>(null);
  useLayoutEffect(() => {
    actions.current = {
      editable: () => editable,
      undo,
      redo,
      fillDown,
      fillRight,
      toggleBoldRows: toggleBold,
      freezeRows: () => setFrozen(activeAt.row + 1, sheet.frozen.cols),
      freezeColumns: () => setFrozen(sheet.frozen.rows, activeAt.col + 1),
      unfreeze: () => setFrozen(0, 0),
      addSheet,
      insertRowsAbove: () => insertRows(false),
      insertRowsBelow: () => insertRows(true),
      insertColumnsLeft: () => insertColumns(false),
      insertColumnsRight: () => insertColumns(true),
      deleteRows,
      deleteColumns,
      openNamedRanges: () => setDialog({ kind: 'named' }),
      openColumnWidth: () => setDialog({ kind: 'width' }),
      openNumberFormat: () => setDialog({ kind: 'format' }),
      increaseDecimals: () => changeSelectionDecimals(1),
      decreaseDecimals: () => changeSelectionDecimals(-1),
      insertChart,
      importFile: () => void startImport(),
      exportCsv: () => exportCsv(path, workbook.file, sheet),
      exportXlsx: () => void exportXlsx(path, workbook.file).catch((e: unknown) => toastError(e, 'Could not export the workbook')),
      sortRangeAsc: () => sortRangeBy(false),
      sortRangeDesc: () => sortRangeBy(true),
      sortSheetAsc: () => sortSheetBy(false),
      sortSheetDesc: () => sortSheetBy(true),
      toggleFilter,
      openConditionalFormatting: () => setDialog({ kind: 'conditional' }),
      insertCheckboxes,
      insertDropdown: () => setDialog({ kind: 'validation', start: 'list' }),
      openDataValidation: () => setDialog({ kind: 'validation' }),
    };
  });
  useEffect(() => {
    const call = (name: Exclude<keyof SheetActions, 'path' | 'editable'>) => () => actions.current?.[name]();
    return setActiveSheet({
      path,
      editable: () => actions.current?.editable() ?? false,
      undo: call('undo'),
      redo: call('redo'),
      fillDown: call('fillDown'),
      fillRight: call('fillRight'),
      toggleBoldRows: call('toggleBoldRows'),
      freezeRows: call('freezeRows'),
      freezeColumns: call('freezeColumns'),
      unfreeze: call('unfreeze'),
      addSheet: call('addSheet'),
      insertRowsAbove: call('insertRowsAbove'),
      insertRowsBelow: call('insertRowsBelow'),
      insertColumnsLeft: call('insertColumnsLeft'),
      insertColumnsRight: call('insertColumnsRight'),
      deleteRows: call('deleteRows'),
      deleteColumns: call('deleteColumns'),
      openNamedRanges: call('openNamedRanges'),
      openColumnWidth: call('openColumnWidth'),
      openNumberFormat: call('openNumberFormat'),
      increaseDecimals: call('increaseDecimals'),
      decreaseDecimals: call('decreaseDecimals'),
      insertChart: call('insertChart'),
      importFile: call('importFile'),
      exportCsv: call('exportCsv'),
      exportXlsx: call('exportXlsx'),
      sortRangeAsc: call('sortRangeAsc'),
      sortRangeDesc: call('sortRangeDesc'),
      sortSheetAsc: call('sortSheetAsc'),
      sortSheetDesc: call('sortSheetDesc'),
      toggleFilter: call('toggleFilter'),
      openConditionalFormatting: call('openConditionalFormatting'),
      insertCheckboxes: call('insertCheckboxes'),
      insertDropdown: call('insertDropdown'),
      openDataValidation: call('openDataValidation'),
    });
  }, [path]);

  // A keyboard navigation (or Enter in a new spreadsheet's title) lands in the grid. So does an
  // opening that leaves the focus nowhere during its first moments (the new file's title it was
  // named in goes away, and the view it replaced may take and drop the focus meanwhile), so that
  // typing goes into A1 as in Google Sheets. Glide draws its canvas only once it has measured
  // itself, so the focus is tried again for a while.
  useEffect(() => {
    const requested = wantsNoteFocus();
    if (touch && !requested) return;
    const nowhere = () => document.activeElement === null || document.activeElement === document.body;
    let timer = 0;
    let tries = 0;
    const attempt = () => {
      if (nowhere()) gridRef.current?.focus();
      if (++tries < 30) timer = window.setTimeout(attempt, 50);
    };
    if (requested) gridRef.current?.focus();
    attempt();
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened file
  }, [path]);

  const handlers: SheetGridHandlers = {
    onSelect: (sel) => select(sel),
    onEdit: edit,
    onCommit: (at, text) => commit({ ...toSheet(at), sheet: sheet.id }, text, 'none'),
    onClear: (range) => setCells(clearEdits(sheet, range, rowAt)),
    onFill: (source, dest) => setCells(fillEdits(sheet, source, dest, { handle: true, rowAt })),
    onFilterButton: (col, rect) => setFilterMenu({ col, anchor: rect }),
    onFreeze: (axis, count) => setFrozen(axis === 'rows' ? count : sheet.frozen.rows, axis === 'cols' ? count : sheet.frozen.cols),
    onToggleCheckbox: toggleCheckbox,
    onToggleSelection: toggleSelectionCheckboxes,
    onDropdown: (at, rect) => setDropdown({ at, anchor: rect }),
    onUndo: undo,
    onRedo: redo,
    onEscape: () => {
      dropPendingCut();
      setCutMark(null);
    },
    onFillDown: fillDown,
    onFillRight: fillRight,
    onToggleBold: toggleBold,
    onColumnWidth: (col, width) => setWidths([col], width),
    onContextMenu: (x, y) => {
      if (editable) setLinesMenu({ x, y });
    },
    onGrow: (rows, cols) =>
      setGrowth((m) => {
        const g = m.get(sheet.id);
        if (g && g.rows >= rows && g.cols >= cols) return m;
        return new Map(m).set(sheet.id, { rows: Math.max(g?.rows ?? 0, rows), cols: Math.max(g?.cols ?? 0, cols) });
      }),
  };

  // ---------- render ----------

  const widthColumns: number[] = Array.from({ length: Math.min(selection.range.width, 200) }, (_, i) => selection.range.col + i);
  const widthLabel = widthColumns.length === 1 ? columnLetters(widthColumns[0]) : `${columnLetters(widthColumns[0])}–${columnLetters(widthColumns[widthColumns.length - 1])}`;
  const boldOn = wholeColumns ? sheet.cols[columnLetters(selection.range.col)]?.bold === true : sheet.rows[String(selection.range.row + 1)]?.bold === true;
  // Google Sheets' View > Freeze: none, 1, 2, or up to the active cell's row or column; the current one ticked.
  const tick = (on: boolean) => (on ? <Check size={14} aria-hidden /> : <span className="sheet-menu-blank" aria-hidden />);
  const upToRow = activeAt.row + 1;
  const upToCol = activeAt.col + 1;
  const rowChoice = (n: number, label: string): MenuEntry => ({ id: `rows${n}`, label, icon: tick(sheet.frozen.rows === n), run: () => setFrozen(n, sheet.frozen.cols) });
  const colChoice = (n: number, label: string): MenuEntry => ({ id: `cols${n}`, label, icon: tick(sheet.frozen.cols === n), run: () => setFrozen(sheet.frozen.rows, n) });
  const freezeItems: MenuEntry[] = [
    rowChoice(0, 'No rows'),
    rowChoice(1, '1 row'),
    rowChoice(2, '2 rows'),
    ...(upToRow > 2 ? [rowChoice(upToRow, `Up to row ${upToRow}`)] : []),
    'separator',
    colChoice(0, 'No columns'),
    colChoice(1, '1 column'),
    colChoice(2, '2 columns'),
    ...(upToCol > 2 ? [colChoice(upToCol, `Up to column ${columnLetters(activeAt.col)}`)] : []),
  ];
  /** A toolbar action, after which the grid takes the keys again. */
  const tool = (action: 'undo' | 'redo' | 'bold' | 'down' | 'right') => {
    ({ undo, redo, bold: toggleBold, down: fillDown, right: fillRight })[action]();
    focusGrid();
  };

  return (
    <div className="sheet-view">
      <header className="sheet-header">
        <InlineTitle key={path} path={path} editable={editable} label="Spreadsheet title" onEnter={() => gridRef.current?.focus()} />
        {!phone && <SaveStatus snapshot={snapshot} />}
      </header>
      <div className="sheet-toolbar" role="toolbar" aria-label="Spreadsheet">
        <ToolButton title="Undo" hotkey="Mod-z" disabled={!editable || !workbook.canUndo()} onClick={() => tool('undo')}>
          <Undo2 size={16} />
        </ToolButton>
        <ToolButton title="Redo" hotkey="Mod-Shift-z" disabled={!editable || !workbook.canRedo()} onClick={() => tool('redo')}>
          <Redo2 size={16} />
        </ToolButton>
        <span className="sheet-toolbar-sep" aria-hidden />
        <ToolButton title={wholeColumns ? 'Bold columns' : 'Bold rows'} hotkey="Mod-b" disabled={!editable} pressed={boldOn} onClick={() => tool('bold')}>
          <Bold size={16} />
        </ToolButton>
        <ToolButton title="Fill down" hotkey="Mod-d" disabled={!editable} onClick={() => tool('down')}>
          <ArrowDownToLine size={16} />
        </ToolButton>
        <ToolButton title="Fill right" hotkey="Mod-r" disabled={!editable} onClick={() => tool('right')}>
          <ArrowRightToLine size={16} />
        </ToolButton>
        <span className="sheet-toolbar-sep" aria-hidden />
        <ToolButton
          title="Freeze rows or columns"
          disabled={!editable}
          pressed={sheet.frozen.rows > 0 || sheet.frozen.cols > 0}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setFreezeMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <Snowflake size={16} />
        </ToolButton>
        <ToolButton title="Column width" disabled={!editable} onClick={() => setDialog({ kind: 'width' })}>
          <MoveHorizontal size={16} />
        </ToolButton>
        <ToolButton
          title="Insert or delete rows and columns"
          disabled={!editable}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setLinesMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <BetweenHorizontalStart size={16} />
        </ToolButton>
        <span className="sheet-toolbar-sep" aria-hidden />
        <ToolButton title="Decrease decimal places" disabled={!editable} onClick={() => changeSelectionDecimals(-1)}>
          <DecimalsArrowLeft size={16} />
        </ToolButton>
        <ToolButton title="Increase decimal places" disabled={!editable} onClick={() => changeSelectionDecimals(1)}>
          <DecimalsArrowRight size={16} />
        </ToolButton>
        <ToolButton title="Number format" disabled={!editable} pressed={!isGeneral(activeFormat)} onClick={() => setDialog({ kind: 'format' })}>
          <Hash size={16} />
        </ToolButton>
        <span className="sheet-toolbar-sep" aria-hidden />
        <ToolButton
          title="Sort and filter"
          disabled={!editable}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setSortMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <ArrowDownAZ size={16} />
        </ToolButton>
        <ToolButton title={filter ? 'Remove filter' : 'Create a filter'} disabled={!editable} pressed={filter !== undefined} onClick={toggleFilter}>
          <Funnel size={16} />
        </ToolButton>
        <ToolButton title="Conditional formatting" pressed={Object.keys(sheet.conditional ?? {}).length > 0} onClick={() => setDialog({ kind: 'conditional' })}>
          <PaintBucket size={16} />
        </ToolButton>
        <ToolButton
          title="Checkboxes and dropdowns"
          pressed={Object.keys(sheet.validation ?? {}).length > 0}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (editable) setValidationMenu({ x: r.left, y: r.bottom + 4 });
            else setDialog({ kind: 'validation' });
          }}
        >
          <ListChecks size={16} />
        </ToolButton>
        <span className="sheet-toolbar-sep" aria-hidden />
        <ToolButton title="Insert chart" disabled={!editable} onClick={insertChart}>
          <ChartColumn size={16} />
        </ToolButton>
        <ToolButton title="Named ranges" onClick={() => setDialog({ kind: 'named' })}>
          <Tag size={16} />
        </ToolButton>
        <span className="sheet-toolbar-sep" aria-hidden />
        <ToolButton title="Import CSV or Excel" disabled={!snapshot.loaded} onClick={() => void startImport()}>
          <Import size={16} />
        </ToolButton>
        <ToolButton
          title="Download as CSV or Excel"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setExportMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <Download size={16} />
        </ToolButton>
      </div>
      <FormulaBar
        ref={bar}
        label={single ? activeRef : rangeText(selectedRange)}
        active={activeAt}
        sheet={sheet.id}
        text={cellText(activeCell, activeFormat)}
        editable={editable}
        touch={touch}
        error={isCellError(activeValue) ? workbook.errorMessage(sheet.id, activeRef) : null}
        onCommit={commit}
        onCancel={focusGrid}
        onGoTo={goTo}
      />
      <div ref={gridBox} className="sheet-grid-box">
        <SheetGrid
          sheet={sheet}
          layout={layout}
          looks={looks}
          filter={gridFilter}
          version={version}
          selection={selection}
          editable={editable}
          touch={touch}
          theme={theme}
          handlers={handlers}
          picked={picked && displayRange(view, picked)}
          marked={cutMark !== null && cutMark === lastClip && cutMark.cut?.sheet === sheet.id && cutMark.cut.source === path ? displayRange(view, cutMark.range) : null}
          gridRef={gridRef}
          portalRef={portalRef}
        />
      </div>
      <ChartsPane
        sheet={sheet}
        editable={editable}
        open={chartsOpen}
        onToggle={() => setChartsOpen((o) => !o)}
        onEdit={(id) => setDialog({ kind: 'chart', id, initial: sheet.charts[id] })}
        onDelete={(id) => void deleteChart(id)}
      />
      <SheetTabs
        sheets={model.file.sheets}
        activeId={sheet.id}
        editable={editable}
        onSelect={(id, pointer) => {
          setSheetId(id);
          if (pointer) focusGrid();
        }}
        onAdd={addSheet}
        onRename={(id) => void renameSheet(id)}
        onDelete={(id) => void deleteSheet(id)}
        onMove={(id, index) => run(() => workbook.moveSheet(id, index))}
      />
      <div ref={portalRef} className="sheet-portal" />
      {freezeMenu && <ContextMenu x={freezeMenu.x} y={freezeMenu.y} label="Freeze" items={freezeItems} onClose={() => setFreezeMenu(null)} />}
      {exportMenu && <ContextMenu x={exportMenu.x} y={exportMenu.y} label="Download" items={exportItems} onClose={() => setExportMenu(null)} />}
      {linesMenu && <ContextMenu x={linesMenu.x} y={linesMenu.y} label="Rows and columns" items={lineItems} onClose={() => setLinesMenu(null)} />}
      {sortMenu && <ContextMenu x={sortMenu.x} y={sortMenu.y} label="Sort and filter" items={sortItems} onClose={() => setSortMenu(null)} />}
      {filterMenu && filter && (
        <FilterMenu
          key={`${filterMenu.col}`}
          sheet={sheet}
          filter={filter}
          col={filterMenu.col}
          anchor={filterMenu.anchor}
          phone={phone}
          editable={editable}
          onApply={(column) => {
            setFilterMenu(null);
            setFilterColumn(filterMenu.col, column);
            focusGrid();
          }}
          onSort={(desc) => {
            setFilterMenu(null);
            sortFilter(filterMenu.col, desc);
            focusGrid();
          }}
          onClose={() => setFilterMenu(null)}
        />
      )}
      {dialog?.kind === 'named' && (
        <NamedRangesDialog
          workbook={workbook}
          editable={editable}
          selectionRef={absoluteRangeText(sheet.name, selectedRange)}
          onGoTo={(name) => {
            setDialog(null);
            goTo(name);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {validationMenu && <ContextMenu x={validationMenu.x} y={validationMenu.y} label="Checkboxes and dropdowns" items={validationItems} onClose={() => setValidationMenu(null)} />}
      {dropdown && dropdownRule && (
        <DropdownList
          items={dropdownItems(workbook.file, sheet, dropdownRule)}
          current={shownCell(sheet, dropdown.at.col, dropdown.at.row).text}
          cell={toA1(dropdown.at.col, dropdown.at.row)}
          anchor={dropdown.anchor}
          phone={phone}
          onPick={pickDropdown}
          onClose={() => setDropdown(null)}
        />
      )}
      {dialog?.kind === 'validation' && (
        <ValidationDialog workbook={workbook} sheet={sheet} selection={rangeText(selectedRange)} editable={editable} start={dialog.start} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'conditional' && (
        <ConditionalDialog workbook={workbook} sheet={sheet} selection={rangeText(selectedRange)} editable={editable} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'width' && (
        <ColumnWidthDialog
          label={widthLabel}
          width={layout.columnWidth(selection.active.col)}
          onApply={(width) => {
            setDialog(null);
            setWidths(widthColumns, width);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'format' && (
        <NumberFormatDialog
          current={activeFormat}
          value={activeValue}
          target={selectionLabel}
          onApply={(fmt) => {
            setDialog(null);
            applyFormat(fmt);
            focusGrid();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'chart' && (
        <ChartDialog sheet={sheet} initial={dialog.initial} editing={dialog.id !== null} onSave={(props) => saveChart(dialog.id, props)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog
          fileName={dialog.file.name}
          kind={dialog.type}
          separator={dialog.separator}
          sheetCount={dialog.book?.sheets.length}
          canAddSheets={editable}
          onImport={(choice) => void finishImport(dialog, choice)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
