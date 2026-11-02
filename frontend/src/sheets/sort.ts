// Sorting rows (DESIGN §6.21.11), as Google Sheets orders values: numbers (dates and times are
// numbers) before text, text without regard to case and in natural order of its digits, then
// FALSE before TRUE, then errors; empty cells always last, whichever the direction. The sort is
// stable, so rows with equal keys keep their order. Shared by "Sort range" (which moves the cells,
// Workbook.sortRange) and a filter's sort (which only orders the rows the view shows). Pure.
import { toA1 } from './a1';
import { cellValue, isCellError, type CachedValue, type Sheet } from './format';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function rank(v: CachedValue): number {
  if (typeof v === 'number') return 0;
  if (typeof v === 'string') return 1;
  if (typeof v === 'boolean') return 2;
  return 3;
}

const isBlank = (v: CachedValue | undefined) => v === null || v === undefined || v === '';

/** Compares two values in ascending order (or descending with `desc`), blanks last either way. */
export function compareSortValues(a: CachedValue | undefined, b: CachedValue | undefined, desc = false): number {
  const ba = isBlank(a);
  const bb = isBlank(b);
  if (ba || bb) return ba === bb ? 0 : ba ? 1 : -1;
  const x = a as CachedValue;
  const y = b as CachedValue;
  let order = rank(x) - rank(y);
  if (order === 0) {
    if (typeof x === 'number' && typeof y === 'number') order = x - y;
    else if (typeof x === 'string' && typeof y === 'string') order = collator.compare(x, y);
    else if (typeof x === 'boolean' && typeof y === 'boolean') order = Number(x) - Number(y);
    else if (isCellError(x) && isCellError(y)) order = collator.compare(x.e, y.e);
  }
  return desc ? -order : order;
}

/** `rows` (sheet row indexes) in the order of the values of columns `keys` (the first key first). */
export function sortRows(sheet: Sheet, rows: readonly number[], keys: ReadonlyArray<{ col: number; desc?: boolean }>): number[] {
  const values = new Map<number, CachedValue[]>();
  for (const row of rows) values.set(row, keys.map((k) => cellValue(sheet.cells[toA1(k.col, row)])));
  return rows
    .map((row, i) => ({ row, i }))
    .sort((p, q) => {
      const a = values.get(p.row) as CachedValue[];
      const b = values.get(q.row) as CachedValue[];
      for (let k = 0; k < keys.length; k++) {
        const c = compareSortValues(a[k], b[k], keys[k].desc === true);
        if (c !== 0) return c;
      }
      return p.i - q.i;
    })
    .map((x) => x.row);
}
