import { describe, expect, it } from 'vitest';
import { clearEdits, clipStillHolds, copyRange, fillDownEdits, fillEdits, fillRightEdits, pasteEdits, typedEdit, usedExtent } from './edits';
import { emptySheet, type Sheet, type SheetCell } from './format';

function sheet(cells: Record<string, SheetCell>): Sheet {
  return { ...emptySheet('s1', 'Sheet1'), cells };
}

const edit = (ref: string, content: unknown) => ({ sheet: 's1', ref, content });

describe('fill', () => {
  it('repeats the source down, shifting formulas and copying values', () => {
    const s = sheet({ A1: { v: 1 }, B1: { f: '=A1*2', c: 2 } });
    expect(fillEdits(s, { col: 0, row: 0, width: 2, height: 1 }, { col: 0, row: 0, width: 2, height: 3 })).toEqual([
      edit('A2', { v: 1 }),
      edit('B2', { f: '=A2*2' }),
      edit('A3', { v: 1 }),
      edit('B3', { f: '=A3*2' }),
    ]);
  });

  it('repeats a multi-row pattern and fills upwards too', () => {
    const s = sheet({ A3: { v: 'x' }, A4: { f: '=A3' } });
    expect(fillEdits(s, { col: 0, row: 2, width: 1, height: 2 }, { col: 0, row: 0, width: 1, height: 6 })).toEqual([
      edit('A1', { v: 'x' }),
      edit('A2', { f: '=A1' }),
      edit('A5', { v: 'x' }),
      edit('A6', { f: '=A5' }),
    ]);
  });

  it('continues numbers that step evenly as a series, down, up and across, as in Google Sheets', () => {
    const s = sheet({ A1: { v: 1 }, A2: { v: 2 }, B1: { v: 10 }, B2: { v: 7 }, C1: { v: 'x' }, C2: { v: 3 } });
    expect(fillEdits(s, { col: 0, row: 0, width: 3, height: 2 }, { col: 0, row: 0, width: 3, height: 4 })).toEqual([
      edit('A3', { v: 3 }),
      edit('B3', { v: 4 }),
      edit('C3', { v: 'x' }),
      edit('A4', { v: 4 }),
      edit('B4', { v: 1 }),
      edit('C4', { v: 3 }),
    ]);
    const t = sheet({ A3: { v: 0.5 }, A4: { v: 1 }, C1: { v: 5 }, D1: { v: 10 } });
    expect(fillEdits(t, { col: 0, row: 2, width: 1, height: 2 }, { col: 0, row: 1, width: 1, height: 4 })).toEqual([edit('A2', { v: 0 }), edit('A5', { v: 1.5 })]);
    expect(fillEdits(t, { col: 2, row: 0, width: 2, height: 1 }, { col: 2, row: 0, width: 4, height: 1 })).toEqual([edit('E1', { v: 15 }), edit('F1', { v: 20 })]);
  });

  it('continues text ending in numbers, and with the fill handle steps a single date or "Item 1"', () => {
    const s = sheet({ A1: { v: 'Item 1' }, A2: { v: 'Item 3' }, B1: { v: 46296, fmt: 'yyyy-mm-dd' }, C1: { v: 'Week 09' }, D1: { v: 5 }, E1: { v: '007' } });
    // Two cells step by their difference, wherever the fill starts.
    expect(fillEdits(s, { col: 0, row: 0, width: 1, height: 2 }, { col: 0, row: 0, width: 1, height: 4 })).toEqual([edit('A3', { v: 'Item 5' }), edit('A4', { v: 'Item 7' })]);
    const one = (col: number, handle: boolean) => fillEdits(s, { col, row: 0, width: 1, height: 1 }, { col, row: 0, width: 1, height: 3 }, { handle });
    // The handle steps a date by a day (keeping its format) and text by one (keeping its zeros).
    expect(one(1, true)).toEqual([edit('B2', { v: 46297 }), edit('B3', { v: 46298 })].map((e) => ({ ...e, fmt: 'yyyy-mm-dd' })));
    expect(one(2, true)).toEqual([edit('C2', { v: 'Week 10' }), edit('C3', { v: 'Week 11' })]);
    // A plain number, or digits alone, is copied; and Fill down (no handle) copies dates and text.
    expect(one(3, true)).toEqual([edit('D2', { v: 5 }), edit('D3', { v: 5 })]);
    expect(one(4, true)).toEqual([edit('E2', { v: '007' }), edit('E3', { v: '007' })]);
    expect(one(1, false).map((e) => e.content)).toEqual([{ v: 46296 }, { v: 46296 }]);
    expect(fillDownEdits(s, { col: 2, row: 0, width: 1, height: 3 }).map((e) => e.content)).toEqual([{ v: 'Week 09' }, { v: 'Week 09' }]);
  });

  it('clears targets of empty source cells and skips cells that already match', () => {
    const s = sheet({ A1: { v: 5 }, A2: { v: 'old' }, A3: { v: 5 } });
    expect(fillEdits(s, { col: 0, row: 0, width: 1, height: 1 }, { col: 0, row: 0, width: 1, height: 3 })).toEqual([edit('A2', { v: 5 })]);
    const t = sheet({ B1: { v: 'keep' }, B2: { v: 'old' } });
    expect(fillEdits(t, { col: 0, row: 0, width: 1, height: 1 }, { col: 0, row: 0, width: 2, height: 2 })).toEqual([edit('B1', null), edit('B2', null)]);
  });

  it('Fill down takes the top row of a range, or the row above a single row', () => {
    const s = sheet({ A1: { f: '=ROW()' }, B1: { v: 2 } });
    expect(fillDownEdits(s, { col: 0, row: 0, width: 1, height: 2 })).toEqual([edit('A2', { f: '=ROW()' })]);
    expect(fillDownEdits(s, { col: 0, row: 1, width: 2, height: 1 })).toEqual([edit('A2', { f: '=ROW()' }), edit('B2', { v: 2 })]);
    expect(fillDownEdits(s, { col: 0, row: 0, width: 1, height: 1 })).toEqual([]);
  });

  it('Fill right takes the left column, or the column to the left of a single column', () => {
    const s = sheet({ A1: { f: '=A2+1' } });
    expect(fillRightEdits(s, { col: 0, row: 0, width: 3, height: 1 })).toEqual([edit('B1', { f: '=B2+1' }), edit('C1', { f: '=C2+1' })]);
    expect(fillRightEdits(s, { col: 1, row: 0, width: 1, height: 1 })).toEqual([edit('B1', { f: '=B2+1' })]);
    expect(fillRightEdits(s, { col: 0, row: 0, width: 1, height: 1 })).toEqual([]);
  });

  it('turns references pushed off the sheet into #REF!', () => {
    const s = sheet({ B2: { f: '=A1' } });
    expect(fillEdits(s, { col: 1, row: 1, width: 1, height: 1 }, { col: 1, row: 0, width: 1, height: 2 })).toEqual([edit('B1', { f: '=#REF!' })]);
  });
});

describe('clear', () => {
  it('clears the cells holding something inside the range, nothing else', () => {
    const s = sheet({ A1: { v: 1 }, B5: { f: '=1' }, C1: { v: 3 }, A9: { c: 4 } });
    expect(clearEdits(s, { col: 0, row: 0, width: 2, height: 1000 })).toEqual([edit('A1', null), edit('B5', null)]);
  });
});

describe('copy and paste', () => {
  const s = sheet({ A1: { v: 'Item' }, B1: { v: 2.5 }, A2: { v: 'x\ty' }, B2: { f: '=B1*2', c: 5 }, C9: { v: 1 } });

  it('copies the values as shown, as TSV, and the contents for this app', () => {
    const clip = copyRange(s, { col: 0, row: 0, width: 2, height: 2 });
    expect(clip.text).toBe('Item\t2.5\n"x\ty"\t5');
    expect(clip.cells).toEqual([
      [{ v: 'Item' }, { v: 2.5 }],
      [{ v: 'x\ty' }, { f: '=B1*2' }],
    ]);
  });

  it('cuts a selection past the used cells down to them', () => {
    expect(usedExtent(s)).toEqual({ rows: 8, cols: 2 });
    expect(copyRange(s, { col: 1, row: 0, width: 1, height: 1000 }).range).toEqual({ col: 1, row: 0, width: 1, height: 9 });
    expect(usedExtent(sheet({}))).toEqual({ rows: -1, cols: -1 });
  });

  it('pastes its own copy with formulas, shifted', () => {
    const clip = copyRange(s, { col: 0, row: 0, width: 2, height: 2 });
    const { edits, range } = pasteEdits(s, { col: 3, row: 4, width: 1, height: 1 }, clip.text, clip);
    expect(range).toEqual({ col: 3, row: 4, width: 2, height: 2 });
    expect(edits).toEqual([edit('D5', { v: 'Item' }), edit('E5', { v: 2.5 }), edit('D6', { v: 'x\ty' }), edit('E6', { f: '=E5*2' })]);
  });

  it('reads text from other programs as typed input', () => {
    const { edits } = pasteEdits(s, { col: 0, row: 10, width: 1, height: 1 }, '1\tTRUE\t=A1\n\'007\t\tplain', null);
    expect(edits).toEqual([edit('A11', { v: 1 }), edit('B11', { v: true }), edit('C11', { f: '=A1' }), edit('A12', { v: '007' }), edit('C12', { v: 'plain' })]);
  });

  it('treats a clipboard that changed since the copy as plain text', () => {
    const clip = copyRange(s, { col: 1, row: 1, width: 1, height: 1 });
    expect(pasteEdits(s, { col: 5, row: 5, width: 1, height: 1 }, '6', clip).edits).toEqual([edit('F6', { v: 6 })]);
    expect(pasteEdits(s, { col: 5, row: 5, width: 1, height: 1 }, clip.text, clip).edits).toEqual([edit('F6', { f: '=F5*2' })]);
  });

  it('repeats a block across a selection it divides evenly', () => {
    const { edits, range } = pasteEdits(sheet({}), { col: 0, row: 0, width: 2, height: 4 }, 'a\nb', null);
    expect(range).toEqual({ col: 0, row: 0, width: 2, height: 4 });
    expect(edits.map((e) => [e.ref, e.content?.v])).toEqual([
      ['A1', 'a'],
      ['B1', 'a'],
      ['A2', 'b'],
      ['B2', 'b'],
      ['A3', 'a'],
      ['B3', 'a'],
      ['A4', 'b'],
      ['B4', 'b'],
    ]);
    expect(pasteEdits(sheet({}), { col: 0, row: 0, width: 1, height: 3 }, 'a\nb', null).range.height).toBe(2);
  });

  it('pastes nothing for empty text', () => {
    expect(pasteEdits(s, { col: 0, row: 0, width: 1, height: 1 }, '', null).edits).toEqual([]);
  });
});

describe('number formats in fill, copy and paste (6c)', () => {
  it('fills formats along with contents, and only where they differ', () => {
    const s = sheet({ A1: { v: 0.5, fmt: '0%' }, A2: { v: 1 }, A3: { v: 0.5, fmt: '0%' } });
    expect(fillEdits(s, { col: 0, row: 0, width: 1, height: 1 }, { col: 0, row: 0, width: 1, height: 3 })).toEqual([{ ...edit('A2', { v: 0.5 }), fmt: '0%' }]);
    const t = sheet({ A1: { v: 1 }, A2: { v: 1, fmt: '0.00' } });
    expect(fillEdits(t, { col: 0, row: 0, width: 1, height: 1 }, { col: 0, row: 0, width: 1, height: 2 })).toEqual([{ ...edit('A2', { v: 1 }), fmt: null }]);
  });

  it('copies values as they show and pastes its own copy with the cells’ formats', () => {
    const s = sheet({ A1: { v: 1450, fmt: '$#,##0.00' }, B1: { v: 46312 } });
    const clip = copyRange(s, { col: 0, row: 0, width: 2, height: 1 });
    expect(clip.text).toBe('$1,450.00\t46312');
    expect(pasteEdits(s, { col: 0, row: 4, width: 1, height: 1 }, clip.text, clip).edits).toEqual([{ ...edit('A5', { v: 1450 }), fmt: '$#,##0.00' }, edit('B5', { v: 46312 })]);
  });

  it('reads pasted text with the formats it implies, unless the cell already has a format', () => {
    const s = sheet({ B1: { fmt: '0.0' } });
    const { edits } = pasteEdits(s, { col: 0, row: 0, width: 1, height: 1 }, '$1,450.00\t12%\t2026-10-17', null);
    expect(edits).toEqual([{ ...edit('A1', { v: 1450 }), fmt: '$#,##0.00' }, edit('B1', { v: 0.12 }), { ...edit('C1', { v: 46312 }), fmt: 'yyyy-mm-dd' }]);
  });

  it('takes text as it is in a plain-text cell', () => {
    const s = { ...sheet({}), cols: { A: { fmt: '@' } } };
    expect(typedEdit(s, 0, 0, '007')).toEqual(edit('A1', { v: '007' }));
    expect(typedEdit(s, 1, 0, '007')).toEqual(edit('B1', { v: 7 }));
    expect(typedEdit(s, 1, 0, '5%')).toEqual({ ...edit('B1', { v: 0.05 }), fmt: '0%' });
  });

  it('counts only cells that show something for the extent of values', () => {
    const s = sheet({ A1: { v: 1 }, D9: { fmt: '0%' } });
    expect(usedExtent(s)).toEqual({ rows: 8, cols: 3 });
    expect(usedExtent(s, { values: true })).toEqual({ rows: 0, cols: 0 });
  });
});

describe('values an array formula spilled', () => {
  // B1 =SORT(A1:A3) spills B2 and B3; D1:D2 hold values that must not be lost.
  const spill = () => sheet({ A1: { v: 3 }, A2: { v: 1 }, A3: { v: 2 }, B1: { f: '=SORT(A1:A3)', c: 1 }, B2: { c: 2 }, B3: { c: 3 }, C1: { c: { e: '#N/A' } }, D1: { v: 'keep1' }, D2: { v: 'keep2' } });

  it('copy and paste as the values they show', () => {
    const s = spill();
    const clip = copyRange(s, { col: 1, row: 1, width: 1, height: 2 });
    expect(clip.text).toBe('2\n3');
    expect(clip.cells).toEqual([[{ v: 2 }], [{ v: 3 }]]);
    expect(pasteEdits(s, { col: 3, row: 0, width: 1, height: 1 }, clip.text, clip).edits).toEqual([edit('D1', { v: 2 }), edit('D2', { v: 3 })]);
    // An error spilled into a cell pastes as its text.
    expect(copyRange(s, { col: 2, row: 0, width: 1, height: 1 }).cells).toEqual([[{ v: '#N/A' }]]);
  });

  it('fill from them as values too', () => {
    const s = spill();
    expect(fillEdits(s, { col: 1, row: 2, width: 1, height: 1 }, { col: 1, row: 2, width: 3, height: 1 })).toEqual([edit('C3', { v: 3 }), edit('D3', { v: 3 })]);
  });
});

describe('a cut', () => {
  it('knows whether the cut cells still hold what was cut', () => {
    const s = sheet({ A1: { v: 1, fmt: '0.0' }, B1: { f: '=A1' } });
    const clip = copyRange(s, { col: 0, row: 0, width: 2, height: 1 });
    expect(clipStillHolds(s, clip)).toBe(true);
    expect(clipStillHolds(sheet({ A1: { v: 1, fmt: '0.0' }, B1: { f: '=A1+1' } }), clip)).toBe(false);
    expect(clipStillHolds(sheet({ A1: { v: 1 }, B1: { f: '=A1' } }), clip)).toBe(false);
  });
});

describe('ranges of a filter view', () => {
  // The grid shows sheet rows 3, 1, 5 (a sorted, filtered view) as its rows 1 to 3.
  const rows = [0, 3, 1, 5];
  const rowAt = (r: number) => rows[r] ?? r + 10;
  const s = sheet({ A2: { v: 'b' }, B2: { f: '=A2', c: 'b' }, A4: { v: 'a' }, B4: { v: 1 }, A6: { v: 'c' } });

  it('fills, clears, copies and pastes the sheet rows the grid shows, shifting formulas by their real rows', () => {
    // Fill down from the grid's row 2 (sheet row 2) into its row 3 (sheet row 6).
    expect(fillDownEdits(s, { col: 1, row: 2, width: 1, height: 2 }, rowAt)).toEqual([edit('B6', { f: '=A6' })]);
    expect(clearEdits(s, { col: 0, row: 1, width: 1, height: 2 }, rowAt)).toEqual([edit('A2', null), edit('A4', null)]);
    const clip = copyRange(s, { col: 0, row: 1, width: 2, height: 2 }, rowAt);
    expect(clip.text).toBe('a' + String.fromCharCode(9) + '1' + String.fromCharCode(10) + 'b' + String.fromCharCode(9) + 'b');
    expect(clip.rows).toEqual([3, 1]);
    // Pasted at the grid's row 3 (sheet row 6) and below (sheet row 14).
    const { edits } = pasteEdits(s, { col: 2, row: 3, width: 1, height: 1 }, clip.text, clip, { rowAt });
    expect(edits).toEqual([edit('C6', { v: 'a' }), edit('D6', { v: 1 }), edit('C15', { v: 'b' }), edit('D15', { f: '=C15' })]);
    // Values only: the values as they are.
    const values = pasteEdits(s, { col: 2, row: 3, width: 1, height: 1 }, clip.text, clip, { rowAt, values: clip.values }).edits;
    expect(values).toEqual([edit('C6', { v: 'a' }), edit('D6', { v: 1 }), edit('C15', { v: 'b' }), edit('D15', { v: 'b' })]);
    // Rows a view picked out are copied, never moved by a cut.
    expect(clipStillHolds(s, clip)).toBe(false);
  });
});

describe('formulas typed with Smart Punctuation', () => {
  it('reads curly quotes in a typed or pasted formula as straight ones, and leaves text and plain-text cells alone', () => {
    const s = sheet({ B1: { fmt: '@' } });
    expect(typedEdit(s, 0, 0, '=IF(A2>0,“yes”,“no”)').content).toEqual({ f: '=IF(A2>0,"yes","no")' });
    expect(typedEdit(s, 0, 1, '“quoted”').content).toEqual({ v: '“quoted”' });
    expect(typedEdit(s, 1, 0, '=“kept”').content).toEqual({ v: '=“kept”' });
    expect(pasteEdits(s, { col: 2, row: 0, width: 1, height: 1 }, '=LEN(“ab”)', null).edits).toEqual([edit('C1', { f: '=LEN("ab")' })]);
  });
});
