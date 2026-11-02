// A note's formulas reading spreadsheets (ROADMAP item 42, DESIGN §6.45): `Budget.sheet!B10`,
// `SUM(Budget.sheet!B2:B9)`, `'Budget.sheet#Summary'!A1`, `Budget.sheet!Total` (a named range).
// The note's engine (formulas/engine.ts) gets each spreadsheet sheet a formula reads as a hidden
// sheet of values (the workbook's when it is open on this device, else the file's cached values),
// and each such reference rewritten to it, so ranges, lookups and sums work as on any sheet.
// A file that does not exist is `#REF!`, a missing named range `#NAME?`, and a spreadsheet whose
// values come (through any chain of files) from this note `#CYCLE!`. Part of the engine's chunk.
import type { RawCellContent } from 'hyperformula';
import { columnLetters, toA1 } from '../a1';
import { effectiveFormat } from '../display';
import { isCellError, sameName, sheetByName, type Sheet } from '../format';
import { parseRangeText } from '../refs';
import type { LinkContext, LinkStore } from './store';
import { externalRefs, rewriteExternalRefs, type ExternalRef } from './syntax';

/** A formula with its references to spreadsheets rewritten for the engine. */
export interface Rewritten {
  text: string;
  /** A spreadsheet it reads is still loading (its name), or null. */
  waiting: string | null;
  /** Why a reference could not be followed, for the hover text; null when all could. */
  problem: string | null;
  /** For a formula that is one reference to one cell, that cell's number format. */
  format?: string;
}

/** A hidden sheet's name: a spreadsheet's path and sheet name, which no table of a note can have. */
const hiddenName = (path: string, sheet: string) => `${path}#${sheet}`;
const quoted = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** A sheet's values as the engine takes them: text stays text, errors stay errors. */
function sheetValues(sheet: Sheet): RawCellContent[][] {
  let rows = 0;
  let cols = 0;
  const cells: Array<[number, number, RawCellContent]> = [];
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const m = /^([A-Z]+)([0-9]+)$/.exec(ref);
    if (!m) continue;
    const value = cell.f !== undefined ? (cell.c ?? null) : (cell.v ?? cell.c ?? null);
    if (value === null) continue;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    const row = Number(m[2]) - 1;
    col -= 1;
    const input: RawCellContent = isCellError(value) ? `=${value.e}` : typeof value === 'string' ? `'${value}` : value;
    cells.push([row, col, input]);
    rows = Math.max(rows, row + 1);
    cols = Math.max(cols, col + 1);
  }
  // A sheet with a far-away cell is not worth a dense block of millions of empty cells.
  if (rows * cols > 2_000_000) return [];
  const out: RawCellContent[][] = Array.from({ length: rows }, () => new Array<RawCellContent>(cols).fill(null));
  for (const [r, c, v] of cells) out[r][c] = v;
  return out;
}

export class ExternalSheets {
  private readonly store: LinkStore;
  private readonly context: LinkContext;
  /** Hidden sheets by name, with whether the engine has them yet. */
  private readonly hidden = new Map<string, { values: RawCellContent[][]; given: boolean }>();

  constructor(store: LinkStore, context: LinkContext) {
    this.store = store;
    this.context = context;
  }

  /** Whether a formula refers to a spreadsheet at all (most do not, and are left alone). */
  static reads(formula: string): boolean {
    return /\.sheet/i.test(formula) && externalRefs(formula).length > 0;
  }

  /** `formula` with its references to spreadsheets pointing at hidden sheets (or errors). */
  rewrite(formula: string): Rewritten {
    if (!ExternalSheets.reads(formula)) return { text: formula, waiting: null, problem: null };
    const out: Rewritten = { text: formula, waiting: null, problem: null };
    const refs = externalRefs(formula);
    out.text = this.store.track(this.context.reads, () => rewriteExternalRefs(formula, (ref) => this.follow(ref, out)));
    // `=Budget.sheet!B10` shows in B10's number format.
    const single = refs.length === 1 && formula.trim().slice(1).trim() === formula.slice(refs[0].from, refs[0].to).trim();
    if (single && out.problem === null && out.waiting === null) out.format = this.formatOf(refs[0]);
    return out;
  }

  /** Hidden sheets the engine does not have yet; they are then marked as given. */
  takeNew(): Array<[string, RawCellContent[][]]> {
    const out: Array<[string, RawCellContent[][]]> = [];
    for (const [name, h] of this.hidden) {
      if (h.given) continue;
      h.given = true;
      out.push([name, h.values]);
    }
    return out;
  }

  private follow(ref: ExternalRef, out: Rewritten): string {
    const from = this.context.path();
    const path = this.store.resolveSheet(ref.file, from);
    if (!path) {
      out.problem ??= `There is no spreadsheet “${ref.file}”.`;
      return '#REF!';
    }
    if (from !== null && this.store.reaches(path, from)) {
      out.problem ??= `“${ref.file}” reads this note’s values, so this note cannot read its values.`;
      return '#CYCLE!';
    }
    const loaded = this.store.sheet(path);
    if (loaded.status === 'loading') {
      out.waiting ??= ref.file;
      return '#N/A';
    }
    if (!loaded.value) {
      out.problem ??= loaded.status === 'missing' ? `There is no spreadsheet “${ref.file}”.` : `“${ref.file}” cannot be read: ${loaded.message ?? 'unknown error'}.`;
      return '#REF!';
    }
    const file = loaded.value;
    let sheet = ref.sheet === null ? file.sheets[0] : sheetByName(file, ref.sheet);
    if (!sheet) {
      out.problem ??= `“${ref.file}” has no sheet “${ref.sheet}”.`;
      return '#REF!';
    }
    let target = ref.target;
    if (!/^\$?[A-Za-z]{1,3}\$?[0-9]|^\$?[A-Za-z]{1,3}:|^\$?[0-9]{1,7}:/.test(target)) {
      // A named range of the spreadsheet: its range (or constant) in its place.
      const name = Object.keys(file.named).find((n) => sameName(n, target));
      const expression = name === undefined ? undefined : file.named[name];
      const range = expression === undefined ? null : parseRangeText(expression);
      if (range) {
        sheet = range.sheet === null ? file.sheets[0] : sheetByName(file, range.sheet);
        if (!sheet) {
          out.problem ??= `The named range “${target}” of “${ref.file}” refers to a sheet it does not have.`;
          return '#REF!';
        }
        const r = range.range;
        target = r.width === 1 && r.height === 1 ? toA1(r.col, r.row) : `${toA1(r.col, r.row)}:${columnLetters(r.col + r.width - 1)}${r.row + r.height}`;
      } else if (expression !== undefined && /^\s*-?[0-9.]+(?:[eE][+-]?[0-9]+)?\s*$/.test(expression)) {
        return `(${expression.trim()})`;
      } else {
        out.problem ??= `“${ref.file}” has no named range “${target}”.`;
        return '#NAME?';
      }
    }
    const name = hiddenName(path, sheet.name);
    if (!this.hidden.has(name)) this.hidden.set(name, { values: sheetValues(sheet), given: false });
    return `${quoted(name)}!${target}`;
  }

  private formatOf(ref: ExternalRef): string | undefined {
    const path = this.store.resolveSheet(ref.file, this.context.path());
    const file = path ? this.store.sheet(path).value : null;
    const sheet = file ? (ref.sheet === null ? file.sheets[0] : sheetByName(file, ref.sheet)) : undefined;
    const at = parseRangeText(ref.target);
    if (!sheet || !at || at.range.width !== 1 || at.range.height !== 1) return undefined;
    return effectiveFormat(sheet, at.range.col, at.range.row);
  }
}
