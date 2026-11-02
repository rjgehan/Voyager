import { describe, expect, it } from 'vitest';
import { cycleReference, dataEdge, dateText, timeText } from './keys';

describe('F4: cycleReference', () => {
  it('steps the reference at the caret through $A$1, A$1, $A1 and back to A1', () => {
    let r = cycleReference('=A1+B2', 3);
    expect(r).toEqual({ text: '=$A$1+B2', caret: 5 });
    r = cycleReference(r!.text, r!.caret);
    expect(r?.text).toBe('=A$1+B2');
    r = cycleReference(r!.text, r!.caret);
    expect(r?.text).toBe('=$A1+B2');
    r = cycleReference(r!.text, r!.caret);
    expect(r?.text).toBe('=A1+B2');
  });

  it('steps both cells of a range, keeps a sheet name, and leaves strings and functions alone', () => {
    expect(cycleReference('=SUM(B2:C9)', 8)?.text).toBe('=SUM($B$2:$C$9)');
    expect(cycleReference("=SUM('My sheet'!B2:C9)", 18)?.text).toBe("=SUM('My sheet'!$B$2:$C$9)");
    expect(cycleReference('=Data!A1', 8)).toEqual({ text: '=Data!$A$1', caret: 10 });
    expect(cycleReference('="A1"&B1', 3)).toBeNull();
    expect(cycleReference('=LOG10(5)', 4)).toBeNull();
    expect(cycleReference('=1+2', 2)).toBeNull();
    expect(cycleReference('A1', 1)).toBeNull();
  });
});

describe('Mod-Arrow: dataEdge', () => {
  //            0     1     2     3      4      5     6
  const line = [true, true, true, false, false, true, false];
  const filled = (i: number) => line[i] ?? false;

  it('goes through filled cells to the last before a gap, across a gap to the next, or to the end', () => {
    expect(dataEdge(0, 1, 99, filled)).toBe(2);
    expect(dataEdge(2, 1, 99, filled)).toBe(5);
    expect(dataEdge(5, 1, 99, filled)).toBe(99);
    expect(dataEdge(5, -1, 99, filled)).toBe(2);
    expect(dataEdge(2, -1, 99, filled)).toBe(0);
    expect(dataEdge(0, -1, 99, filled)).toBe(0);
    expect(dataEdge(3, -1, 99, filled)).toBe(2);
  });
});

describe('Mod-; and Mod-Shift-;', () => {
  it('type the date and the time as typed input reads them', () => {
    const now = new Date(2026, 10, 2, 9, 5, 7);
    expect(dateText(now)).toBe('2026-11-02');
    expect(timeText(now)).toBe('09:05:07');
  });
});
