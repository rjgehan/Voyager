import { describe, expect, it } from 'vitest';
import { emptySheet, type Sheet, type SheetCell, type SheetFile, type Validation } from './format';
import { describeValidation, dropdownItems, holdsItem, isValid, validationLooks, validations } from './validation';

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

  it('takes an item that reads as a number, date or boolean as the value it writes ($5 is 5 shown $5.00)', () => {
    const items: Record<string, Validation> = {
      v1: { range: 'B2:B6', type: 'list', values: ['$5', '$10', '1.0', '001', 'true'] },
      v2: { range: 'C2', type: 'list', values: ['5'] },
      v3: { range: 'D2', type: 'range', source: "'My lists'!A4" },
    };
    // What picking each item (or typing it) writes into a General cell.
    const { file: g, sheet: s } = file({ B2: { v: 5, fmt: '$#,##0.00' }, B3: { v: 1 }, B4: { v: true }, B5: { v: 7 }, C2: { v: 5 }, D2: { v: 0.5, fmt: '0%' } }, items);
    s.cols.C = { fmt: '0.00' };
    const look = validationLooks(g, s)!;
    expect(look(1, 1)).toEqual({ kind: 'dropdown', invalid: false });
    expect(look(1, 2)).toEqual({ kind: 'dropdown', invalid: false });
    expect(look(1, 3)).toEqual({ kind: 'dropdown', invalid: false });
    expect(look(1, 4)).toEqual({ kind: 'dropdown', invalid: true });
    expect(look(2, 1)).toEqual({ kind: 'dropdown', invalid: false });
    expect(isValid(g, s, items.v1, 5, '$5.00')).toBe(true);
    expect(isValid(g, s, items.v1, 10, '$10.00')).toBe(true);
    expect(isValid(g, s, items.v1, 7, '7')).toBe(false);
    expect(isValid(g, s, items.v2, 5, '5.00')).toBe(true);
    // The item that is current in the list.
    expect(['$5', '$10'].find((item) => holdsItem(item, 5, '$5.00'))).toBe('$5');
    expect(holdsItem('Open', 'Open', 'Open')).toBe(true);
    expect(holdsItem('Open', 'open', 'open')).toBe(false);
  });
});
