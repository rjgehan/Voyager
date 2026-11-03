// Google Sheets' keyboard shortcuts that need more than a binding (DESIGN §6.21.16): F4 cycling a
// reference through its absolute and relative forms while a formula is edited, Mod-Arrow jumping to
// the edge of the data, and Mod-; and Mod-Shift-; typing the date and the time. Pure.

/** A cell reference in a formula: an optional sheet, a cell, and an optional second cell of a range. */
const REFERENCE = /(?:(?:'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Za-z]{1,3}\$?[0-9]{1,7}(?::\$?[A-Za-z]{1,3}\$?[0-9]{1,7})?/y;
const CELL = /(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})/g;
const WORD = /[A-Za-z0-9_.$]/;

/** The references of a formula with where they start and end, strings left out. */
function references(formula: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let inString = false;
  for (let i = 0; i < formula.length; ) {
    const ch = formula[i];
    if (ch === '"') {
      inString = !inString;
      i++;
      continue;
    }
    if (inString || (i > 0 && WORD.test(formula[i - 1]) && formula[i - 1] !== '$')) {
      i++;
      continue;
    }
    REFERENCE.lastIndex = i;
    const m = REFERENCE.exec(formula);
    // Not a reference when a word or a call goes on (`A1B`, `LOG10(`).
    if (m && !WORD.test(formula[i + m[0].length] ?? '') && formula[i + m[0].length] !== '(') {
      out.push({ start: i, end: i + m[0].length });
      i += m[0].length;
    } else i++;
  }
  return out;
}

/** The next form of a cell reference, as F4 steps them: A1 → $A$1 → A$1 → $A1 → A1. */
function nextForm(colAbs: boolean, rowAbs: boolean): [boolean, boolean] {
  if (!colAbs && !rowAbs) return [true, true];
  if (colAbs && rowAbs) return [false, true];
  if (!colAbs && rowAbs) return [true, false];
  return [false, false];
}

/**
 * F4 in a formula, as in Google Sheets and Excel: the reference the caret is in (or just after)
 * steps to its next form, both cells of a range alike; the caret goes to the reference's end.
 * Null when the caret is at no reference.
 */
export function cycleReference(text: string, caret: number): { text: string; caret: number } | null {
  if (!text.startsWith('=')) return null;
  const ref = references(text).find((r) => caret >= r.start && caret <= r.end);
  if (!ref) return null;
  const part = text.slice(ref.start, ref.end);
  const bang = part.lastIndexOf('!');
  const prefix = bang >= 0 ? part.slice(0, bang + 1) : '';
  const cells = part.slice(prefix.length);
  const first = /^(\$?)[A-Za-z]{1,3}(\$?)/.exec(cells);
  const [col, row] = nextForm(first?.[1] === '$', first?.[2] === '$');
  const next = prefix + cells.replace(CELL, (_m, _c, letters: string, _r, digits: string) => `${col ? '$' : ''}${letters}${row ? '$' : ''}${digits}`);
  return { text: text.slice(0, ref.start) + next + text.slice(ref.end), caret: ref.start + next.length };
}

/**
 * Where Mod-Arrow goes from `at` along one line of cells, as in Google Sheets: through filled cells
 * to the last one before a gap, or across a gap to the next filled cell, or else to the edge.
 * `filled(i)` says whether position `i` of the line holds something; `last` is the line's last.
 */
export function dataEdge(at: number, step: 1 | -1, last: number, filled: (i: number) => boolean): number {
  const next = at + step;
  if (next < 0 || next > last) return at;
  if (filled(at) && filled(next)) {
    let i = next;
    while (i + step >= 0 && i + step <= last && filled(i + step)) i += step;
    return i;
  }
  for (let i = next; i >= 0 && i <= last; i += step) if (filled(i)) return i;
  return step > 0 ? last : 0;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today as Mod-; types it (ISO, which typed input reads as a date). */
export function dateText(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The time as Mod-Shift-; types it. */
export function timeText(now = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
