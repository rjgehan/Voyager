// Data validation (DESIGN §6.21.13), as in Google Sheets: a range's cells take a value from a
// dropdown (its own items, or the values of a range on any sheet) or are checkboxes (TRUE or FALSE;
// empty is unchecked). Other input is marked as invalid, or refused when the validation is strict.
// When validations overlap, the newest one applies. Pure and engine-free, from cached values.
import { parseA1 } from './a1';
import { effectiveFormat, formatShown, shownCell } from './display';
import type { CellEdit } from './engine';
import { compareIds, sheetByName, type CachedValue, type Sheet, type SheetFile, type Validation } from './format';
import { typedInput } from './input';
import { parseRangeText, type CellRange } from './refs';

const inside = (r: CellRange, col: number, row: number) => col >= r.col && col < r.col + r.width && row >= r.row && row < r.row + r.height;

export interface CellValidation {
  id: string;
  validation: Validation;
}

/** The validation of each cell of a sheet (the newest that covers it), or null when the sheet has none. */
export function validations(sheet: Sheet): ((col: number, row: number) => CellValidation | undefined) | null {
  const items = Object.entries(sheet.validation ?? {})
    .sort(([a], [b]) => compareIds(b, a))
    .flatMap(([id, validation]) => {
      const parsed = validation.range ? parseRangeText(validation.range) : null;
      return parsed && parsed.sheet === null && validation.type ? [{ id, validation, range: parsed.range }] : [];
    });
  if (items.length === 0) return null;
  return (col, row) => {
    const hit = items.find((i) => inside(i.range, col, row));
    return hit ? { id: hit.id, validation: hit.validation } : undefined;
  };
}

/** At most this many cells of a source range are read for a dropdown's items. */
const SOURCE_CELLS = 5000;

/** The items of a dropdown: its own, or the values of its source range as they show, without repeats or blanks. */
export function dropdownItems(file: SheetFile, sheet: Sheet, v: Validation): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (text: string) => {
    if (text.trim() === '' || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  };
  if (v.type === 'list') for (const item of v.values ?? []) add(item);
  if (v.type === 'range' && v.source) {
    const parsed = parseRangeText(v.source);
    const from = parsed ? (parsed.sheet === null ? sheet : sheetByName(file, parsed.sheet)) : undefined;
    if (parsed && from) {
      const r = parsed.range;
      let n = 0;
      for (let row = r.row; row < r.row + r.height && n < SOURCE_CELLS; row++) {
        for (let col = r.col; col < r.col + r.width && n < SOURCE_CELLS; col++, n++) {
          add(shownCell(from, col, row).text);
        }
      }
    }
  }
  return out;
}

/** The value a dropdown item writes into a cell, as typed input reads it (`$5` is 5, `001` is 1, `true` TRUE). */
function itemValue(item: string): CachedValue | undefined {
  return typedInput(item).content?.v;
}

/**
 * Whether a cell holding `value` (and showing `shown`) holds the dropdown item `item`: it shows
 * as the item, or holds what the item writes (`$5` writes 5, which shows `$5.00`).
 */
export function holdsItem(item: string, value: CachedValue, shown: string): boolean {
  if (item === shown) return true;
  const v = itemValue(item);
  return v !== undefined && v === value;
}

/**
 * Whether a cell's value is valid under `v`: empty is; a dropdown's value must be one of its items
 * (as the value shows, or as the item reads when typed); a checkbox holds TRUE or FALSE.
 */
export function isValid(file: SheetFile, sheet: Sheet, v: Validation, value: CachedValue, shown: string): boolean {
  if (value === null || value === '') return true;
  if (v.type === 'checkbox') return typeof value === 'boolean';
  if (v.type === 'list' || v.type === 'range') return dropdownItems(file, sheet, v).some((item) => holdsItem(item, value, shown));
  return true;
}

/** What a cell shows under its validation: a checkbox (checked or not), a dropdown, and whether its value is invalid. */
export interface ValidationLook {
  kind: 'checkbox' | 'dropdown';
  checked?: boolean;
  invalid: boolean;
}

/** How each cell of a sheet looks under its validation, worked out once per state of the sheet. */
export function validationLooks(file: SheetFile, sheet: Sheet): ((col: number, row: number) => ValidationLook | undefined) | null {
  const at = validations(sheet);
  if (!at) return null;
  // Dropdown items per validation (as they show, and the values they write), read once.
  const items = new Map<string, { shown: Set<string>; values: Set<CachedValue> }>();
  return (col, row) => {
    const hit = at(col, row);
    if (!hit) return undefined;
    const { value, text: shown } = shownCell(sheet, col, row);
    const empty = value === null || value === '';
    if (hit.validation.type === 'checkbox') {
      return { kind: 'checkbox', checked: value === true, invalid: !empty && typeof value !== 'boolean' };
    }
    let set = items.get(hit.id);
    if (!set) {
      const list = dropdownItems(file, sheet, hit.validation);
      set = { shown: new Set(list), values: new Set(list.map(itemValue).filter((v) => v !== undefined)) };
      items.set(hit.id, set);
    }
    return { kind: 'dropdown', invalid: !empty && !set.shown.has(shown) && !set.values.has(value) };
  };
}

/** The validation in words, for lists: `Dropdown: Open, Done`, `Dropdown from Lists!A1:A5`, `Checkbox`. */
export function describeValidation(v: Validation): string {
  if (v.type === 'checkbox') return 'Checkbox';
  if (v.type === 'range') return `Dropdown from ${v.source ?? ''}`;
  if (v.type === 'list') return `Dropdown: ${(v.values ?? []).join(', ')}`;
  return 'Unknown validation';
}

/**
 * Whether a strict validation refuses typed input (`edit`, from typedEdit) in its cell, as Google
 * Sheets' "Reject the input": the spreadsheet view and the grids embedded in notes both ask.
 */
export function refusesInput(file: SheetFile, sheet: Sheet, edit: CellEdit): boolean {
  const at = parseA1(edit.ref);
  const value = edit.content?.v;
  if (!at || value === undefined) return false;
  const rule = validations(sheet)?.(at.col, at.row)?.validation;
  if (!rule?.strict) return false;
  return !isValid(file, sheet, rule, value, formatShown(value, edit.fmt ?? effectiveFormat(sheet, at.col, at.row)).text);
}
