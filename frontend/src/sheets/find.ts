// Find and replace in a spreadsheet (DESIGN §6.21.14), as Google Sheets does it: cells are found by
// the text they show (or by their formulas, with "Also search within formulas"), on the open sheet
// or on all sheets, optionally matching case or the entire cell, or as a regular expression.
// Replacing works on what the cell holds (its formula, or its value as typed: `1450` for
// `$1,450.00`), so a replaced number stays a number. Pure: matches and cell edits.
import { compareA1, parseA1, toA1 } from './a1';
import { effectiveFormat, shownCell } from './display';
import type { CellEdit } from './engine';
import { cellText, type Sheet, type SheetFile } from './format';
import { typedInput } from './input';

export interface FindOptions {
  query: string;
  matchCase?: boolean;
  /** The whole of the cell's text must match. */
  wholeCell?: boolean;
  /** Search the formulas of formula cells instead of their results. */
  formulas?: boolean;
  /** The query is a regular expression. */
  regex?: boolean;
  /** Every sheet, in tab order, rather than the open one. */
  allSheets?: boolean;
}

export interface FindMatch {
  sheet: string;
  col: number;
  row: number;
}

/** The pattern a search looks for, or null when there is none (an empty query, a broken expression). */
export function findPattern(opts: FindOptions): RegExp | null {
  if (opts.query === '') return null;
  const source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(opts.wholeCell ? `^(?:${source})$` : source, opts.matchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
}

/** The text a search looks at in a cell: its formula (with `formulas`), else the value as it shows. */
function searchedText(sheet: Sheet, col: number, row: number, opts: FindOptions): string {
  const cell = sheet.cells[toA1(col, row)];
  if (opts.formulas && cell?.f !== undefined) return cell.f;
  return shownCell(sheet, col, row).text;
}

const test = (re: RegExp, text: string) => {
  re.lastIndex = 0;
  return re.test(text);
};

/** Every cell that matches, sheet by sheet (the open one only, unless `allSheets`), row by row. */
export function findMatches(file: SheetFile, sheetId: string, opts: FindOptions): FindMatch[] {
  const re = findPattern(opts);
  if (!re) return [];
  const sheets = opts.allSheets ? file.sheets : file.sheets.filter((s) => s.id === sheetId);
  const out: FindMatch[] = [];
  for (const sheet of sheets) {
    const refs = Object.keys(sheet.cells).sort(compareA1);
    for (const ref of refs) {
      const at = parseA1(ref);
      if (!at) continue;
      const text = searchedText(sheet, at.col, at.row, opts);
      if (text !== '' && test(re, text)) out.push({ sheet: sheet.id, col: at.col, row: at.row });
    }
  }
  return out;
}

/**
 * The edit that replaces the query with `replacement` in a matching cell, or null when there is
 * nothing to replace in what the cell holds (a formula's result matched, but not its formula, or a
 * number matched as it shows but not as it is written). With a regular expression, `$1` in the
 * replacement is a group, as in Google Sheets.
 */
export function replaceEdit(file: SheetFile, match: FindMatch, opts: FindOptions, replacement: string): CellEdit | null {
  const re = findPattern(opts);
  const sheet = file.sheets.find((s) => s.id === match.sheet);
  if (!re || !sheet) return null;
  const ref = toA1(match.col, match.row);
  const cell = sheet.cells[ref];
  if (!cell || (cell.f === undefined && cell.v === undefined)) return null;
  if (cell.f !== undefined && !opts.formulas) return null;
  const fmt = effectiveFormat(sheet, match.col, match.row);
  const before = cell.f ?? cellText(cell, fmt);
  if (!test(re, before)) return null;
  re.lastIndex = 0;
  const literal = opts.regex ? replacement : replacement.replace(/\$/g, '$$$$');
  const after = before.replace(re, literal);
  if (after === before) return null;
  if (cell.f !== undefined) return after.startsWith('=') ? { sheet: sheet.id, ref, content: { f: after } } : { sheet: sheet.id, ref, content: typedInput(after).content };
  // A value is typed again, so `1500` stays a number; a plain-text cell keeps text.
  const typed = typedInput(after, { plainText: fmt === '@' });
  return { sheet: sheet.id, ref, content: typed.content };
}
