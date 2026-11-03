// Formulas in notes (ROADMAP item 39, DESIGN §6.42): the note's tables as the sheets of one
// HyperFormula instance, with item 6's configuration, so every function behaves as it does in a
// `.sheet` file. A lazy chunk (load.ts), loaded only for notes that hold formulas. Results are never
// written into the note: they are computed from its text each time it changes.
import { CellValueDetailedType, DetailedCellError, HyperFormula, type CellValue, type ConfigParams, type RawCellContent } from 'hyperformula';
import { BUILT_IN_NAMES, engineConfig } from '../sheets/engine';
import { friendlyError } from '../sheets/functions';
import { LOADING } from '../sheets/links/noteFunctions';
import { ExternalSheets, type Rewritten } from '../sheets/links/noteRefs';
import { linkContext, linkStore, type ComputedTable, type LinkContext } from '../sheets/links/store';
import type { LinkValue } from '../sheets/links/values';
import { formatNumberWith, isGeneral } from '../sheets/numfmt';
import { engineInput, ERROR_HELP, formatAuto, isFormula, type FormulaDisplay, type FormulaModel } from './model';

/** The sheet the inline formulas live in: a name no block id can have (ids are letters, digits and dashes). */
const INLINE_SHEET = '_inline';

/** The formats of the result types the engine tells apart (the sheets' defaults, DESIGN §6.21.8). */
const TYPE_FORMATS: Partial<Record<string, string>> = {
  [CellValueDetailedType.NUMBER_DATE]: 'yyyy-mm-dd',
  [CellValueDetailedType.NUMBER_DATETIME]: 'yyyy-mm-dd h:mm',
  [CellValueDetailedType.NUMBER_TIME]: 'h:mm:ss AM/PM',
  [CellValueDetailedType.NUMBER_PERCENT]: '0.00%',
  [CellValueDetailedType.NUMBER_CURRENCY]: '$#,##0.00',
};

function errorDisplay(e: DetailedCellError, formula: string): FormulaDisplay {
  if (e.value === '#N/A' && e.message === LOADING) return loadingDisplay(formula);
  const help = friendlyError(e.value, formula, e.message || ERROR_HELP[e.value] || 'Error');
  return { text: e.value, className: 'cm-formula-error', title: `${help}\n${formula}`, hint: help };
}

/** A formula waiting for another file's values (ROADMAP item 42). */
function loadingDisplay(formula: string, what = ''): FormulaDisplay {
  return { text: '…', className: 'cm-formula-value cm-formula-loading', title: `Loading${what ? ` ${what}` : ''}…\n${formula}` };
}

/** How a formula that reads another file shows: loading, or an error whose cause the engine cannot know. */
function linkedDisplay(link: Rewritten | undefined, shown: FormulaDisplay | null, formula: string): FormulaDisplay | null {
  if (!link) return shown;
  if (link.waiting !== null) return loadingDisplay(formula, link.waiting);
  if (link.problem !== null && shown?.className === 'cm-formula-error') return { ...shown, title: `${link.problem}\n${formula}`, hint: link.problem };
  return shown;
}

/** A value as it shows: in the column's format, else the format of its type, else the Automatic one. */
export function displayValue(value: CellValue, type: string | null, fmt: string | undefined, formula: string | null): FormulaDisplay | null {
  const title = formula ?? undefined;
  if (value instanceof DetailedCellError) return errorDisplay(value, formula ?? '');
  if (value === null) return formula ? { text: '', className: 'cm-formula-value', title } : null;
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE', className: 'cm-formula-value', title };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { text: '#NUM!', className: 'cm-formula-error', title: `${ERROR_HELP['#NUM!']}\n${formula ?? ''}` };
    const format = fmt ?? (type ? TYPE_FORMATS[type] : undefined);
    const text = isGeneral(format) ? formatAuto(value) : formatNumberWith(value, format).text;
    return { text, className: 'cm-formula-value', title };
  }
  return { text: String(value), className: 'cm-formula-value', title };
}

/** Dataview's inline queries (`= this.file.name`) are not formulas: they stay as code. */
function looksLikeDataview(e: DetailedCellError): boolean {
  return e.value === '#ERROR!' || (e.value === '#NAME?' && /Named expression .*\..* not recognized/.test(e.message));
}

export interface NoteResults {
  /** What the formulas read from other files (ROADMAP item 42): store keys, so a change of one computes them again. */
  readonly reads: ReadonlySet<string>;
  /** A table cell's display, or null to show its Markdown. */
  cell(table: number, row: number, column: number): FormulaDisplay | null;
  /** An inline formula's display (`expression` with its `=`), or null to leave the code as it is. */
  inline(expression: string): FormulaDisplay | null;
  /** The engine's value of an expression, for scripts (ROADMAP 40b): numbers, text, booleans, null, or an error code. */
  evaluate(expression: string): unknown;
  /** A table's values as computed (row 0 is the header), for a spreadsheet's NOTETABLE (ROADMAP item 42). */
  values(table: number): LinkValue[][];
  destroy(): void;
}

const NO_READS: ReadonlySet<string> = new Set();

/**
 * Computes a note's formulas. The tables' sheets are built at once; inline formulas as they are asked
 * for. With a `context` (the note's path), formulas can read other files (ROADMAP item 42): notes
 * through NOTEPROP and friends, spreadsheets through `Budget.sheet!B10`; what they read is in `reads`.
 */
export function computeNote(model: FormulaModel, context?: LinkContext): NoteResults {
  const external = context ? new ExternalSheets(linkStore(), context) : null;
  /** Formulas that read spreadsheets, as rewritten for the engine (by the formula's text). */
  const links = new Map<string, Rewritten>();
  const input = (text: string): RawCellContent => {
    const raw = engineInput(text);
    if (!external || typeof raw !== 'string' || !raw.startsWith('=') || !ExternalSheets.reads(raw)) return raw;
    let link = links.get(raw);
    if (!link) {
      link = external.rewrite(raw);
      links.set(raw, link);
    }
    return link.text;
  };
  const sheets: Record<string, RawCellContent[][]> = {};
  model.tables.forEach((t) => {
    sheets[t.name] = t.rows.map((row) => row.map(input));
  });
  for (const [name, values] of external?.takeNew() ?? []) sheets[name] = values;
  sheets[INLINE_SHEET] = [];
  const config: Partial<ConfigParams> = context ? { ...engineConfig(), context } : engineConfig();
  let hf: HyperFormula | null;
  try {
    hf = HyperFormula.buildFromSheets(sheets, config, [...BUILT_IN_NAMES]);
  } catch (e) {
    // A name the engine refuses, say: every formula shows as typed rather than breaking the note.
    console.warn('[formulas] building the note’s sheets failed', e);
    hf = null;
  }
  const ids = model.tables.map((t) => hf?.getSheetId(t.name) ?? -1);
  const inlineId = hf?.getSheetId(INLINE_SHEET) ?? -1;
  const inlineRows = new Map<string, number>();
  const inlineShown = new Map<string, FormulaDisplay | null>();

  /** Spreadsheet sheets an inline formula reads that the engine does not have yet. */
  const addHidden = (engine: HyperFormula) => {
    for (const [name, values] of external?.takeNew() ?? []) {
      engine.addSheet(name);
      const id = engine.getSheetId(name);
      if (id !== undefined) engine.setSheetContent(id, values);
    }
  };

  const inlineRow = (engine: HyperFormula, expression: string): number => {
    let row = inlineRows.get(expression);
    if (row === undefined) {
      row = inlineRows.size;
      inlineRows.set(expression, row);
      const content = input(expression);
      addHidden(engine);
      engine.setCellContents({ sheet: inlineId, row, col: 0 }, [[content]]);
    }
    return row;
  };

  const linkOf = (formula: string | null) => (formula ? links.get(formula) : undefined);

  return {
    reads: context?.reads ?? NO_READS,
    cell(table, row, column) {
      const t = model.tables[table];
      if (!hf || !t || ids[table] < 0) return null;
      const text = t.rows[row]?.[column] ?? '';
      const formula = isFormula(text) ? text.trim() : null;
      const link = linkOf(formula);
      const fmt = row > 0 ? (t.formats[column] ?? link?.format) : undefined;
      // Plain cells show their Markdown, unless their column has a format (39b) or an array result spilled into them.
      if (!formula && text.trim() !== '' && fmt === undefined) return null;
      const address = { sheet: ids[table], row, col: column };
      const value = hf.getCellValue(address);
      if (!formula && (text.trim() === '' ? value === null : typeof value !== 'number')) return null;
      return linkedDisplay(link, displayValue(value, hf.getCellValueDetailedType(address), fmt, formula), formula ?? '');
    },
    inline(expression) {
      if (!hf || inlineId < 0) return null;
      if (inlineShown.has(expression)) return inlineShown.get(expression)!;
      let shown: FormulaDisplay | null;
      try {
        const address = { sheet: inlineId, row: inlineRow(hf, expression), col: 0 };
        const value = hf.getCellValue(address);
        const link = linkOf(expression);
        shown =
          value instanceof DetailedCellError && looksLikeDataview(value) && !link
            ? null
            : linkedDisplay(link, displayValue(value, hf.getCellValueDetailedType(address), link?.format, expression), expression);
      } catch {
        shown = null;
      }
      inlineShown.set(expression, shown);
      return shown;
    },
    evaluate(expression) {
      if (!hf || inlineId < 0) return null;
      const value = hf.getCellValue({ sheet: inlineId, row: inlineRow(hf, expression), col: 0 });
      return value instanceof DetailedCellError ? { error: value.value, message: value.message } : value;
    },
    values(table) {
      const t = model.tables[table];
      const engine = hf;
      if (!engine || !t || ids[table] < 0) return [];
      const width = Math.max(0, ...t.rows.map((r) => r.length));
      return t.rows.map((_, row) =>
        Array.from({ length: width }, (_, col) => {
          const address = { sheet: ids[table], row, col };
          return linkValue(engine.getCellValue(address), engine.getCellValueDetailedType(address));
        }),
      );
    },
    destroy() {
      hf?.destroy();
      hf = null;
    },
  };
}

/** An engine value as a value another file reads (dates as dates, errors with their message). */
function linkValue(value: CellValue, type: string): LinkValue {
  if (value instanceof DetailedCellError) return { error: value.value, message: value.message || ERROR_HELP[value.value] || '' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { error: '#NUM!', message: ERROR_HELP['#NUM!'] };
    if (type === CellValueDetailedType.NUMBER_DATE) return { date: value, time: false };
    if (type === CellValueDetailedType.NUMBER_DATETIME) return { date: value, time: true };
  }
  return value;
}

/** A note's tables as its formulas compute them, for a spreadsheet's NOTETABLE (the link store's TableComputer). */
export function computeTables(model: FormulaModel, context: LinkContext): ComputedTable[] {
  const results = computeNote(model, context);
  try {
    return model.tables.map((t, i) => ({ name: t.name, rows: results.values(i) }));
  } finally {
    results.destroy();
  }
}

export const engineVersion = HyperFormula.version;

export { functionCatalog } from '../sheets/functions';

/** The context a note's computation gets (ROADMAP item 42): its path, and what it reads. */
export function noteLinkContext(path: () => string | null): LinkContext {
  return linkContext(path);
}

/** Hears which store keys changed (another file a note's formulas read), throttled. */
export function onLinksChanged(fn: (keys: ReadonlySet<string>) => void): () => void {
  return linkStore().subscribe(fn);
}
