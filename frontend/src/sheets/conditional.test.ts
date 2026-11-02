import { describe, expect, it } from 'vitest';
import { conditionalStyles, mixColors, readableText, scaleColor } from './conditional';
import { emptySheet, type ConditionalRule, type Sheet, type SheetCell } from './format';

function sheet(cells: Record<string, SheetCell>, conditional: Record<string, ConditionalRule>): Sheet {
  return { ...emptySheet('s1', 'S'), cells, conditional };
}

const cells: Record<string, SheetCell> = { A1: { v: 'Rent' }, B1: { v: 1450 }, A2: { v: 'Food' }, B2: { v: 300 }, A3: { v: 'Gym' }, B3: { v: 45 }, B4: { f: '=1/0', c: { e: '#DIV/0!' } } };

describe('conditional formatting', () => {
  it('styles cells that meet a rule’s condition; the first rule that applies wins', () => {
    const s = sheet(cells, {
      r2: { range: 'B1:B4', when: 'gt', value: '100', bg: '#f4c7c3' },
      r1: { range: 'B1:B4', when: 'gt', value: '1000', bg: '#b7e1cd', color: '#0d652d', bold: true },
      r3: { range: 'A1:A3', when: 'contains', value: 'o', italic: true },
    });
    const style = conditionalStyles(s)!;
    expect(style(1, 0)).toEqual({ bg: '#b7e1cd', color: '#0d652d', bold: true });
    // A fill without a text colour gets a readable one.
    expect(style(1, 1)).toEqual({ bg: '#f4c7c3', color: '#1f1f1f' });
    expect(style(1, 2)).toBeUndefined();
    expect(style(0, 1)).toEqual({ italic: true });
    expect(style(0, 0)).toBeUndefined();
    expect(style(5, 5)).toBeUndefined();
  });

  it('colours a range by its numbers on a scale, through the median, skipping text', () => {
    const s = sheet(cells, { r1: { range: 'A1:B4', scale: { min: '#ffffff', mid: '#ffd666', max: '#57bb8a' } } });
    const style = conditionalStyles(s)!;
    expect(style(1, 0)?.bg).toBe('#57bb8a');
    expect(style(1, 1)?.bg).toBe('#ffd666');
    expect(style(1, 2)?.bg).toBe('#ffffff');
    expect(style(0, 0)).toBeUndefined();
    expect(style(1, 3)).toBeUndefined();
  });

  it('ignores rules it cannot use, and a sheet without rules has none', () => {
    expect(conditionalStyles(sheet(cells, {}))).toBeNull();
    expect(conditionalStyles(sheet(cells, { r1: { range: 'nowhere', bg: '#ffffff' }, r2: { range: 'A1:A3', when: 'notEmpty' } }))).toBeNull();
  });

  it('mixes colours and picks readable text', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(scaleColor({ min: '#000000', max: '#ffffff' }, 5, 0, 5, 10)).toBe('#808080');
    expect(scaleColor({ min: '#000000', max: '#ffffff' }, 3, 3, 3, 3)).toBe('#ffffff');
    expect(readableText('#ffffff')).toBe('#1f1f1f');
    expect(readableText('#1c4587')).toBe('#ffffff');
  });
});
