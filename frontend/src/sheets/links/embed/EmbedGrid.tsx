// The grid of a spreadsheet embedded in a note (ROADMAP item 42, DESIGN §6.47): an HTML table of
// the embedded sheet or range, in its number formats, that edits in place like the spreadsheet
// view (DESIGN §6.21.5) where the note can be written. A compact toolbar (undo, redo, bold rows,
// fill down, insert and delete rows, and Open full sheet), a one-line formula bar, and a cell editor
// over the cell: click or tap a cell to select it, type, double-click, Enter or F2 (or tap it
// again) to edit; Enter and Tab commit and move; Escape cancels. While a formula is typed, a click
// or tap on a cell puts its reference in (a second tap makes a range), and the function help of
// the spreadsheet view suggests functions. Copy, cut and paste use the spreadsheet's own clipboard
// format, so formulas move as in the view. Every change goes through the workbook: one undo step,
// saved and synced like an edit in the spreadsheet.
import { ArrowDownToLine, Bold, ExternalLink, FileSpreadsheet, Redo2, Rows3, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject, type TouchEvent } from 'react';
import { openPath } from '../../../features/navigation';
import { keyLabel } from '../../../features/platform';
import { noteRoute } from '../../../features/paths';
import { useFormulaAssist } from '../../../views/sheet/formulaAssist';
import { SheetChart } from '../../../views/sheet/SheetChart';
import { columnLetters, toA1 } from '../../a1';
import { conditionalStyles } from '../../conditional';
import { effectiveFormat, shownCell } from '../../display';
import { clearEdits, copyRange, fillDownEdits, pasteEdits, typedEdit } from '../../edits';
import type { CellEdit, Workbook } from '../../engine';
import { cellText, cellValue, compareIds, isCellError, sheetById, type Sheet, type SheetFile } from '../../format';
import { pickSlot, placeReference, spanOf, type PickedSlot } from '../../formulaText';
import { rangeText, type CellRange } from '../../refs';
import { resolveTarget, usedRange } from '../../target';
import { refusesInput } from '../../validation';
import { toast } from '../../../state/toasts';
import { setSheetClip, sheetClip } from '../../clipboard';

/** An embed shows at most this many rows and columns (as item 6b's); the spreadsheet has the rest. */
export const EMBED_ROWS = 100;
export const EMBED_COLUMNS = 26;
/** Room to type beyond the used cells of a whole sheet. */
const GROWTH = 1;
const DEFAULT_WIDTH = 96;

interface Props {
  path: string;
  subpath?: string;
  caption: string;
  /** The model to show: the workbook's, or the file's cached values until the workbook is needed. */
  model: SheetFile | null;
  workbook: Workbook | null;
  /** Changes with every change of the model. */
  version: number;
  editable: boolean;
  loading: boolean;
  problem: string | null;
  /** The engine chunk did not load: the values show, but nothing can be edited. */
  engineFailed: string | null;
  /** The workbook is needed (a cell was touched). */
  onWant(): void;
  /**
   * Saves edits the workbook never took, without the engine: its chunk did not load, or the embed
   * goes away before it arrives. False when they could not be kept.
   */
  keep(edits: CellEdit[]): boolean;
  /** Loads the engine again after it failed. */
  onRetry(): void;
}

interface At {
  col: number;
  row: number;
}

interface Editing extends At {
  sheet: string;
  /** Pointing at cells put this reference in last. */
  pick: PickedSlot | null;
}


const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

/** Where the table shows: the target's range, or the sheet's used range and a row and column to grow into. */
function shownRange(sheet: Sheet, range: CellRange | null, editable: boolean): { range: CellRange | null; full: CellRange | null } {
  if (range) return { range: { ...range, width: Math.min(range.width, EMBED_COLUMNS), height: Math.min(range.height, EMBED_ROWS) }, full: range };
  const used = usedRange(sheet);
  if (!used && !editable) return { range: null, full: null };
  const grow = editable ? GROWTH : 0;
  // An empty sheet still gives a few cells to start in.
  const width = (used?.width ?? 2) + grow;
  const height = (used?.height ?? 2) + grow;
  const full = { col: 0, row: 0, width, height };
  return { range: { col: 0, row: 0, width: Math.min(width, EMBED_COLUMNS), height: Math.min(height, EMBED_ROWS) }, full: used ?? full };
}

export function EmbedGrid(props: Props) {
  const { path, subpath, caption, model, workbook, editable, version } = props;
  const frame = useRef<HTMLDivElement>(null);
  /** Prefix of the cells' ids, which the grid's aria-activedescendant names. */
  const cellIds = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  /** The cell editor: a one-row textarea, so a cell's line breaks survive an edit. */
  const input = useRef<HTMLTextAreaElement>(null);
  /** The id of the sheet picked in a whole-file embed, so a rename keeps it (a delete falls back to the first). */
  const [sheetChoice, setSheetChoice] = useState<string | null>(null);
  const [chosen, setActive] = useState<At>({ col: 0, row: 0 });
  const [chosenAnchor, setAnchor] = useState<At>({ col: 0, row: 0 });
  const [editing, setEditingState] = useState<Editing | null>(null);
  /** The edit under way, as the handlers of this very event see it (a blur follows a hide at once). */
  const editingNow = useRef<Editing | null>(null);
  /** The text the cell editor opened with (null when a typed key replaced it). */
  const editStart = useRef<string | null>(null);
  const setEditing = (e: Editing | null) => {
    editingNow.current = e;
    setEditingState(e);
  };
  const [picked, setPicked] = useState<CellRange | null>(null);
  /** Edits typed before the workbook was ready, applied once it is. */
  const pending = useRef<CellEdit[]>([]);
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const pickedSheet = model && sheetChoice !== null ? (sheetById(model, sheetChoice) ?? null) : null;
  const target = model ? (pickedSheet ? { sheet: pickedSheet, range: null } : resolveTarget(model, subpath)) : null;
  const sheet = target?.sheet ?? null;
  const { range, full } = sheet ? shownRange(sheet, target?.range ?? null, editable) : { range: null, full: null };
  // The selection is always in the shown range (it starts at its first cell).
  const inside = (a: At) => range !== null && a.col >= range.col && a.col < range.col + range.width && a.row >= range.row && a.row < range.row + range.height;
  const start: At = { col: range?.col ?? 0, row: range?.row ?? 0 };
  const active = inside(chosen) ? chosen : start;
  const anchor = inside(chosen) && inside(chosenAnchor) ? chosenAnchor : active;
  const selection = spanOf(active, anchor);

  /** Typed edits that could not be kept (the file cannot be read either). */
  const [lost, setLost] = useState(false);
  const keep = useRef(props.keep);
  useEffect(() => {
    keep.current = props.keep;
  });
  const failed = props.engineFailed !== null || props.problem !== null;

  // Typed before the workbook loaded: applied now, as one undo step. When the engine fails
  // instead, they are saved without it, so a typed value is never dropped.
  useEffect(() => {
    if (pending.current.length === 0) return;
    if (workbook) {
      const edits = pending.current;
      pending.current = [];
      try {
        workbook.setCells(edits, { implyFormats: true });
      } catch (e) {
        console.error('[links] an embed edit failed', e);
      }
    } else if (failed) {
      const edits = pending.current;
      pending.current = [];
      if (!keep.current(edits)) setLost(true);
    }
  }, [workbook, failed]);

  // Leaving before the engine arrived (the note scrolled the embed away): the edits are saved now.
  useEffect(
    () => () => {
      if (pending.current.length === 0) return;
      const edits = pending.current;
      pending.current = [];
      keep.current(edits);
    },
    [],
  );

  const open = (e?: MouseEvent) => {
    e?.stopPropagation();
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return;
    e?.preventDefault();
    openPath(path, pickedSheet?.name ?? subpath ?? null);
  };

  // ---------- editing ----------

  const editText = (s: Sheet, at: At) => cellText(s.cells[toA1(at.col, at.row)], effectiveFormat(s, at.col, at.row));

  /** Puts the cell editor over cell `at` and focuses it (inside the gesture, so a phone's keyboard opens). */
  const startEdit = (at: At, initial?: string) => {
    if (!editable || !sheet || !range) return;
    props.onWant();
    const td = table.current?.querySelector<HTMLElement>(`td[data-cell="${at.col}:${at.row}"]`);
    const el = input.current;
    if (!td || !el) return;
    el.style.left = `${td.offsetLeft}px`;
    el.style.top = `${td.offsetTop}px`;
    el.style.minWidth = `${Math.max(td.offsetWidth, 120)}px`;
    el.style.height = `${td.offsetHeight}px`;
    el.value = initial ?? editText(sheet, at);
    // What the editor showed of the cell: only a change from it is written.
    editStart.current = initial === undefined ? el.value : null;
    el.hidden = false;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
    setActive(at);
    setAnchor(at);
    setEditing({ ...at, sheet: sheet.id, pick: null });
  };

  const apply = (edits: CellEdit[]) => {
    if (edits.length === 0) return;
    if (!workbook) {
      pending.current.push(...edits);
      props.onWant();
      return;
    }
    try {
      workbook.setCells(edits, { implyFormats: true });
    } catch (e) {
      console.error('[links] an embed edit failed', e);
    }
  };

  const stopEdit = () => {
    setEditing(null);
    setPicked(null);
    const el = input.current;
    if (el) el.hidden = true;
  };

  /**
   * Writes the editor's text into the cell it edits, if it changed from what the editor started
   * with (a typed first key always counts): opening a cell and leaving it writes nothing, even when
   * another device changed the cell meanwhile.
   */
  const commit = (move: 'down' | 'up' | 'right' | 'left' | 'none', leaving = false): boolean => {
    const el = input.current;
    const at = editingNow.current;
    if (!at || !el || !model) return true;
    const s = sheetById(model, at.sheet);
    const text = el.value;
    const changed = text !== editStart.current;
    const typed = s && changed && text !== editText(s, at) ? typedEdit(s, at.col, at.row, text) : null;
    // A strict validation refuses other input, as in the spreadsheet view (Google Sheets' "Reject
    // the input"): the editor stays open on the text, unless the focus left it.
    if (s && typed && refusesInput(model, s, typed)) {
      toast(`“${text}” is not one of the values ${toA1(at.col, at.row)} takes.`, { kind: 'error' });
      if (leaving) stopEdit();
      else el.focus({ preventScroll: true });
      return false;
    }
    stopEdit();
    if (typed) apply([typed]);
    if (move !== 'none') moveTo(step(at, move), false);
    if (!coarse()) table.current?.focus({ preventScroll: true });
    return true;
  };

  const cancel = () => {
    stopEdit();
    table.current?.focus({ preventScroll: true });
  };

  const step = (at: At, move: 'down' | 'up' | 'right' | 'left'): At => {
    if (!range) return at;
    const col = at.col + (move === 'right' ? 1 : move === 'left' ? -1 : 0);
    const row = at.row + (move === 'down' ? 1 : move === 'up' ? -1 : 0);
    return { col: Math.min(range.col + range.width - 1, Math.max(range.col, col)), row: Math.min(range.row + range.height - 1, Math.max(range.row, row)) };
  };

  const moveTo = (at: At, extend: boolean) => {
    setActive(at);
    if (!extend) setAnchor(at);
  };

  /** While a formula is typed with the caret where a reference can go, a cell pointed at goes in. */
  const point = (at: At, gesture: 'click' | 'tap' | 'extend'): boolean => {
    const el = input.current;
    const editing = editingNow.current;
    if (!editing || !el || !el.value.startsWith('=')) return false;
    const where = { sheet: null, col: at.col, row: at.row };
    const slot = pickSlot(el.value, el.selectionStart ?? el.value.length, editing.pick, where, gesture);
    if (!slot) return false;
    const placed = placeReference(el.value, slot.start, slot.end, slot.anchor, where);
    el.value = placed.value;
    el.setSelectionRange(placed.caret, placed.caret);
    setEditing({ ...editing, pick: placed.pick });
    setPicked(placed.range);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  // ---------- pointer and keys ----------

  const cellAt = (e: { target: EventTarget | null }): At | null => {
    const td = (e.target as HTMLElement | null)?.closest?.('td[data-cell]');
    if (!td) return null;
    const [col, row] = (td.getAttribute('data-cell') ?? '').split(':').map(Number);
    return Number.isFinite(col) && Number.isFinite(row) ? { col, row } : null;
  };

  const onMouseDown = (e: MouseEvent) => {
    const at = cellAt(e);
    if (!at || e.button !== 0) return;
    if (!editable) return;
    // The note's editor must not take the press (the widget ignores its events, this keeps it so).
    e.stopPropagation();
    if (editingNow.current && point(at, e.shiftKey ? 'extend' : 'click')) {
      e.preventDefault();
      return;
    }
    if (editingNow.current && !commit('none')) {
      e.preventDefault();
      return;
    }
    props.onWant();
    moveTo(at, e.shiftKey);
  };

  const onDoubleClick = (e: MouseEvent) => {
    const at = cellAt(e);
    if (at && editable) startEdit(at);
  };

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY, moved: false } : null;
  };

  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (touch.current && t && Math.hypot(t.clientX - touch.current.x, t.clientY - touch.current.y) > 8) touch.current.moved = true;
  };

  const onTouchEnd = (e: TouchEvent) => {
    const at = cellAt(e);
    const tap = touch.current && !touch.current.moved;
    touch.current = null;
    if (!at || !tap || !editable) return;
    // No mouse events follow: the editor keeps the focus, and the keyboard stays up.
    e.preventDefault();
    e.stopPropagation();
    if (editingNow.current && point(at, 'tap')) return;
    if (editingNow.current && !commit('none')) return;
    const again = active.col === at.col && active.row === at.row && selection.width === 1 && selection.height === 1;
    if (again) startEdit(at);
    else {
      props.onWant();
      moveTo(at, false);
    }
  };

  const onTableKeyDown = (e: KeyboardEvent) => {
    if (!editable || !sheet || editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const arrows: Record<string, 'down' | 'up' | 'right' | 'left'> = { ArrowDown: 'down', ArrowUp: 'up', ArrowRight: 'right', ArrowLeft: 'left' };
    if (arrows[key] && !mod) {
      handled();
      moveTo(step(active, arrows[key]), e.shiftKey);
    } else if (key === 'Tab') {
      handled();
      moveTo(step(active, e.shiftKey ? 'left' : 'right'), false);
    } else if ((key === 'Enter' || key === 'F2') && !mod) {
      handled();
      startEdit(active);
    } else if ((key === 'Delete' || key === 'Backspace') && !mod) {
      handled();
      apply(clearEdits(sheet, selection));
    } else if (mod && key.toLowerCase() === 'z') {
      handled();
      if (e.shiftKey) workbook?.redo();
      else workbook?.undo();
    } else if (mod && key.toLowerCase() === 'y') {
      handled();
      workbook?.redo();
    } else if (mod && key.toLowerCase() === 'd') {
      handled();
      apply(fillDownEdits(sheet, selection));
    } else if (mod && key.toLowerCase() === 'b') {
      handled();
      toggleBold();
    } else if (key === 'Escape') {
      handled();
      table.current?.blur();
    } else if (key.length === 1 && !mod && !e.altKey) {
      // Typing over a cell replaces it, as in a spreadsheet.
      handled();
      startEdit(active, key);
    }
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && (e.altKey || e.ctrlKey || e.metaKey)) {
      // A line break inside the cell, as in Google Sheets.
      e.preventDefault();
      e.currentTarget.setRangeText('\n', e.currentTarget.selectionStart, e.currentTarget.selectionEnd, 'end');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(e.shiftKey ? 'up' : 'down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commit(e.shiftKey ? 'left' : 'right');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  // ---------- the clipboard ----------

  const onCopy = (e: ClipboardEvent, cut: boolean) => {
    if (!sheet || editing || !e.clipboardData) return;
    const clip = copyRange(sheet, selection);
    e.clipboardData.setData('text/plain', clip.text);
    e.preventDefault();
    e.stopPropagation();
    // Shared with the spreadsheet view (sheets/clipboard.ts), so a paste there brings the formulas too.
    setSheetClip(clip);
    if (cut && editable) apply(clearEdits(sheet, selection));
  };

  const onPaste = (e: ClipboardEvent) => {
    if (!sheet || editing || !editable || !e.clipboardData) return;
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData('text/plain');
    const { edits, range: pasted } = pasteEdits(sheet, selection, text, sheetClip());
    apply(edits);
    setActive({ col: pasted.col, row: pasted.row });
    setAnchor({ col: pasted.col + pasted.width - 1, row: pasted.row + pasted.height - 1 });
  };

  // ---------- toolbar ----------

  const run = (fn: (wb: Workbook) => void) => {
    if (!workbook) {
      props.onWant();
      return;
    }
    try {
      fn(workbook);
    } catch (e) {
      console.error('[links] an embed action failed', e);
    }
    if (!coarse()) table.current?.focus({ preventScroll: true });
  };

  const toggleBold = () =>
    run((wb) => {
      if (!sheet) return;
      const keys = Array.from({ length: Math.min(selection.height, 1000) }, (_, i) => String(selection.row + i + 1));
      const all = keys.every((k) => sheet.rows[k]?.bold === true);
      wb.transact(() => {
        for (const k of keys) {
          const p = { ...sheet.rows[k] };
          if (all) delete p.bold;
          else p.bold = true;
          wb.setRow(sheet.id, k, p);
        }
      });
    });

  const insertRow = () => run((wb) => sheet && wb.insertRows(sheet.id, selection.row + selection.height, 1));
  const deleteRows = () => run((wb) => sheet && wb.deleteRows(sheet.id, selection.row, selection.height));

  // ---------- render ----------

  const value = sheet ? cellValue(sheet.cells[toA1(active.col, active.row)]) : null;
  const errorHint = sheet && workbook && isCellError(value) ? workbook.errorMessage(sheet.id, toA1(active.col, active.row)) : null;
  const charts = sheet && !target?.range && !pickedSheet && !subpath ? Object.entries(sheet.charts).sort(([a], [b]) => compareIds(a, b)) : [];
  const sheets = model?.sheets ?? [];
  // Conditional formatting of the shown sheet (DESIGN §6.21.12), worked out once per render.
  const styleAt = sheet ? conditionalStyles(sheet) : null;

  let body: ReactNode;
  if (props.problem) body = <div className="markdown-embed-empty">{props.problem}</div>;
  else if (!model) body = <div className="embed-loading">{props.loading ? 'Loading…' : 'Could not load this spreadsheet.'}</div>;
  else if (!target || !sheet) body = <div className="markdown-embed-empty">“{subpath}” is not a sheet, named range or range in this spreadsheet.</div>;
  else if (!range) body = <div className="markdown-embed-empty">This sheet is empty.</div>;
  else {
    const inSel = (col: number, row: number) => col >= selection.col && col < selection.col + selection.width && row >= selection.row && row < selection.row + selection.height;
    const inPicked = (col: number, row: number) => picked !== null && col >= picked.col && col < picked.col + picked.width && row >= picked.row && row < picked.row + picked.height;
    body = (
      <div className="sheet-embed-scroll sheet-live-scroll" ref={scroller}>
        <table
          ref={table}
          className={`sheet-embed-table sheet-live-table${editable ? ' is-editable' : ''}`}
          tabIndex={editable ? 0 : undefined}
          aria-label={caption}
          // Editable, it is a grid whose cells can be selected (a plain table's cells cannot);
          // the active cell is announced as the focused grid's active descendant.
          role={editable ? 'grid' : undefined}
          aria-multiselectable={editable ? true : undefined}
          aria-activedescendant={editable ? `${cellIds}-${active.col}-${active.row}` : undefined}
          onKeyDown={onTableKeyDown}
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onCopy={(e) => onCopy(e, false)}
          onCut={(e) => onCopy(e, true)}
          onPaste={onPaste}
        >
          <colgroup>
            {editable && <col className="sheet-live-rowhead" />}
            {Array.from({ length: range.width }, (_, j) => (
              <col key={j} style={{ width: `${sheet.cols[columnLetters(range.col + j)]?.w ?? (editable ? DEFAULT_WIDTH : undefined)}px` }} />
            ))}
          </colgroup>
          {editable && (
            <thead>
              <tr>
                <th className="sheet-live-corner" aria-hidden />
                {Array.from({ length: range.width }, (_, j) => (
                  <th key={j} scope="col" className={selection.col <= range.col + j && range.col + j < selection.col + selection.width ? 'is-current' : undefined}>
                    {columnLetters(range.col + j)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {Array.from({ length: range.height }, (_, i) => {
              const row = range.row + i;
              const boldRow = sheet.rows[String(row + 1)]?.bold === true;
              return (
                <tr key={row} className={boldRow ? 'is-bold' : undefined}>
                  {editable && (
                    <th scope="row" className={selection.row <= row && row < selection.row + selection.height ? 'is-current' : undefined}>
                      {row + 1}
                    </th>
                  )}
                  {Array.from({ length: range.width }, (_, j) => {
                    const col = range.col + j;
                    const shown = shownCell(sheet, col, row);
                    const bold = !boldRow && sheet.cols[columnLetters(col)]?.bold === true;
                    const isActive = editable && active.col === col && active.row === row;
                    const classes = [
                      `align-${shown.align}`,
                      shown.color ? `is-${shown.color}` : '',
                      bold ? 'is-bold' : '',
                      editable && inSel(col, row) ? 'is-selected' : '',
                      isActive ? 'is-active' : '',
                      inPicked(col, row) ? 'is-picked' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    // Conditional formatting, as the grid and the read-only embed show it (DESIGN §6.21.12).
                    const style = styleAt?.(col, row);
                    const css = style
                      ? {
                          background: style.bg,
                          color: shown.color === 'error' ? undefined : style.color,
                          fontWeight: style.bold ? 700 : undefined,
                          fontStyle: style.italic ? ('italic' as const) : undefined,
                        }
                      : undefined;
                    return (
                      <td
                        key={col}
                        id={editable ? `${cellIds}-${col}-${row}` : undefined}
                        data-cell={`${col}:${row}`}
                        className={classes}
                        style={css}
                        aria-selected={editable ? inSel(col, row) : undefined}
                      >
                        {shown.text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {editable && (
          <textarea
            ref={input}
            className="sheet-live-input"
            rows={1}
            hidden
            aria-label="Cell"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            onKeyDown={onInputKeyDown}
            onBlur={() => {
              // A press on a cell that points at it keeps the focus; anything else ends the edit.
              if (editingNow.current) commit('none', true);
            }}
          />
        )}
      </div>
    );
  }

  const label = selection.width === 1 && selection.height === 1 ? toA1(active.col, active.row) : rangeText(selection);
  return (
    <div
      ref={frame}
      className={`markdown-embed sheet-embed sheet-live-embed${editable ? ' is-editable' : ''}`}
      data-source={path}
      title={editable ? undefined : 'Open the spreadsheet'}
      onClick={editable ? undefined : open}
    >
      <div className="sheet-live-head">
        <a className="markdown-embed-title internal-link" data-href={path + (subpath ? '#' + subpath : '')} href={noteRoute(path, subpath)} onClick={open}>
          <FileSpreadsheet size={14} aria-hidden />
          <span>{caption}</span>
        </a>
        {editable && sheets.length > 1 && !subpath && (
          <select className="sheet-live-sheets" aria-label="Sheet" value={sheet?.id ?? ''} onChange={(e) => setSheetChoice(e.target.value)}>
            {sheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {editable && (
          <div className="sheet-live-toolbar" role="toolbar" aria-label="Spreadsheet">
            <Tool title="Undo" hotkey="Mod-z" disabled={!workbook?.canUndo()} onClick={() => run((wb) => wb.undo())}>
              <Undo2 size={15} />
            </Tool>
            <Tool title="Redo" hotkey="Mod-Shift-z" disabled={!workbook?.canRedo()} onClick={() => run((wb) => wb.redo())}>
              <Redo2 size={15} />
            </Tool>
            <Tool title="Bold rows" hotkey="Mod-b" onClick={toggleBold}>
              <Bold size={15} />
            </Tool>
            <Tool title="Fill down" hotkey="Mod-d" onClick={() => sheet && apply(fillDownEdits(sheet, selection))}>
              <ArrowDownToLine size={15} />
            </Tool>
            <Tool title="Insert a row below" onClick={insertRow}>
              <Rows3 size={15} />
            </Tool>
            <Tool title={selection.height === 1 ? `Delete row ${selection.row + 1}` : `Delete rows ${selection.row + 1}–${selection.row + selection.height}`} onClick={deleteRows}>
              <Trash2 size={15} />
            </Tool>
          </div>
        )}
        <button type="button" className="icon-button sheet-live-open" title="Open full sheet" aria-label="Open full sheet" onClick={(e) => open(e)}>
          <ExternalLink size={15} aria-hidden />
          <span className="sheet-live-open-label">Open full sheet</span>
        </button>
      </div>
      {editable && model && sheet && range && (
        <div className="sheet-live-bar" aria-live="polite">
          <span className="sheet-live-name">{label}</span>
          <span className="sheet-live-text">{sheet ? editText(sheet, active) : ''}</span>
          {errorHint && <span className="sheet-live-error">{errorHint}</span>}
        </div>
      )}
      {props.engineFailed && (
        <p className="sheet-embed-note">
          The spreadsheet engine could not be loaded, so this grid is read-only for now.{' '}
          <button type="button" className="link-button" onClick={props.onRetry}>
            Try again
          </button>
        </p>
      )}
      {lost && (
        <p className="sheet-embed-note sheet-live-error" role="alert">
          The change you typed could not be saved. Open the spreadsheet to make it there.
        </p>
      )}
      {body}
      {range && full && (full.height > range.height || full.width > range.width) && (
        <p className="sheet-embed-note">
          Showing {rangeText(range)} of {rangeText(full)}. Open the spreadsheet for the rest.
        </p>
      )}
      {charts.length > 0 && sheet && (
        <div className="sheet-embed-charts">
          {charts.map(([id, chart]) => (
            <SheetChart key={`${id}:${version}`} sheet={sheet} chart={chart} height={180} />
          ))}
        </div>
      )}
      {editable && workbook && <Assist frame={frame} />}
    </div>
  );
}

/** The spreadsheet view's function help, on the cell editor (only once the workbook is in). */
function Assist({ frame }: { frame: RefObject<HTMLDivElement | null> }) {
  const none = useCallback(() => null, []);
  useFormulaAssist({ portalRef: frame, barInput: none });
  return null;
}

function Tool({ title, hotkey, disabled, onClick, children }: { title: string; hotkey?: string; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="icon-button"
      title={hotkey ? `${title} (${keyLabel(hotkey)})` : title}
      aria-label={title}
      disabled={disabled}
      // The selection's cell keeps the focus.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
