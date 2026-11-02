import { describe, expect, it } from 'vitest';
import { emptySheet, type Sheet, type SheetCell, type SheetFile, type Validation } from './format';
import { describeValidation, dropdownItems, isValid, validationLooks, validations } from './validation';

function file(cells: Record<string, SheetCell>, validation: Record<string, Validation>): { file: SheetFile; sheet: Sheet } {
  const sheet: Sheet = { ...emptySheet('s1', 'Data'), cells, validation };
  const lists: Sheet = { ...emptySheet('s2', 'My lists'), cells: { A1: { v: 'High' }, A2: { v: 'Low' }, A3: { v: 'High' }, A4: { v: 0.5, fmt: '0%' } } };
  return { file: { type: 'notesapp-sheet', version: 2, engine: '', sheets: [sheet, lists], named: {} }, sheet };
}

describe('data validation', () => {
  const rules: Record<string, Validation> = {
    v1: { range: 'A1:A5', type: 'list', values: ['Open', 'Done', 'Open', ' '] },
    v2: { range: 'B1:B5', type: 'range', source: "'My lists'!A1:A5" },
    v3: { range: 'C1:C5', type: 'checkbox' },
    v4: { range: 'A3', type: 'checkbox' },
  };
  const { file: f, sheet } = file({ A1: { v: 'Open' }, A2: { v: 'Later' }, B1: { v: 'Low' }, B2: { v: '50%' }, C1: { v: true }, C2: { v: 'yes' } }, rules);

  it('finds the newest validation of a cell, and a dropdown’s items without repeats or blanks', () => {
    const at = validations(sheet)!;
    expect(at(0, 0)?.id).toBe('v1');
    expect(at(0, 2)?.id).toBe('v4');
    expect(at(3, 0)).toBeUndefined();
    expect(dropdownItems(f, sheet, rules.v1)).toEqual(['Open', 'Done']);
    // From a range on another sheet, as its values show.
    expect(dropdownItems(f, sheet, rules.v2)).toEqual(['High', 'Low', '50%']);
  });

  it('marks values that are not the dropdown’s, and checkboxes that hold something else', () => {
    expect(isValid(f, sheet, rules.v1, 'Open', 'Open')).toBe(true);
    expect(isValid(f, sheet, rules.v1, 'open', 'open')).toBe(false);
    expect(isValid(f, sheet, rules.v1, null, '')).toBe(true);
    expect(isValid(f, sheet, rules.v3, false, 'FALSE')).toBe(true);
    const look = validationLooks(f, sheet)!;
    expect(look(0, 0)).toEqual({ kind: 'dropdown', invalid: false });
    expect(look(0, 1)).toEqual({ kind: 'dropdown', invalid: true });
    expect(look(1, 1)).toEqual({ kind: 'dropdown', invalid: false });
    expect(look(2, 0)).toEqual({ kind: 'checkbox', checked: true, invalid: false });
    expect(look(2, 1)).toEqual({ kind: 'checkbox', checked: false, invalid: true });
    expect(look(2, 4)).toEqual({ kind: 'checkbox', checked: false, invalid: false });
    expect(look(5, 5)).toBeUndefined();
    expect(describeValidation(rules.v2)).toBe("Dropdown from 'My lists'!A1:A5");
  });
});
