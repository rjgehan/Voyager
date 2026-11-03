// Conditional formatting (DESIGN §6.21.12), as in Google Sheets: rules of a range that colour cells
// meeting a condition (fill, text colour, bold, italic) or colour a range by its numbers (a colour
// scale from its smallest to its largest value, through its median). Rules apply in the order they
// were made; the first that applies to a cell styles it. Pure and engine-free, from cached values,
// so the grid and embeds show the same colours.
import { toA1 } from './a1';
import { meetsCondition } from './conditions';
import { shownCell } from './display';
import { cellValue, compareIds, type ColorScale, type ConditionalRule, type Sheet } from './format';
import { parseRangeText, type CellRange } from './refs';

export interface CellStyle {
  /** `#rrggbb` */
  bg?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

/** Google Sheets' default style of a new rule: light green with dark green text. */
export const DEFAULT_STYLE: CellStyle = { bg: '#b7e1cd', color: '#0d652d' };

/** The preset styles a rule offers, as Google Sheets' "Default" choices. */
export const STYLE_PRESETS: readonly CellStyle[] = [
  { bg: '#b7e1cd', color: '#0d652d' },
  { bg: '#fce8b2', color: '#7f6000' },
  { bg: '#f4c7c3', color: '#a50e0e' },
  { bg: '#c9daf8', color: '#1c4587' },
  { bg: '#d9d2e9', color: '#4c1130' },
  { color: '#ff0000', bold: true },
];

/** Google Sheets' preset colour scales. */
export const SCALE_PRESETS: readonly ColorScale[] = [
  { min: '#ffffff', max: '#57bb8a' },
  { min: '#57bb8a', max: '#ffffff' },
  { min: '#e67c73', mid: '#ffd666', max: '#57bb8a' },
  { min: '#57bb8a', mid: '#ffd666', max: '#e67c73' },
  { min: '#ffffff', max: '#e67c73' },
  { min: '#ffffff', max: '#4285f4' },
];

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');

/** A colour between `a` and `b` (`t` from 0 to 1), mixed in RGB as Google Sheets does. */
export function mixColors(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return '#' + [0, 1, 2].map((i) => hex2(x[i] + (y[i] - x[i]) * t)).join('');
}

/** A text colour readable on `bg`: near-black on light fills, white on dark ones. */
export function readableText(bg: string): string {
  const [r, g, b] = rgb(bg).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1f1f1f' : '#ffffff';
}

/** The colour of `value` on a scale from `lo` through `mid` to `hi`. */
export function scaleColor(scale: ColorScale, value: number, lo: number, mid: number, hi: number): string {
  if (hi <= lo) return scale.mid ?? scale.max;
  if (!scale.mid) return mixColors(scale.min, scale.max, (value - lo) / (hi - lo));
  if (value <= mid) return mid <= lo ? scale.mid : mixColors(scale.min, scale.mid, (value - lo) / (mid - lo));
  return hi <= mid ? scale.mid : mixColors(scale.mid, scale.max, (value - mid) / (hi - mid));
}

/** Whether a rule styles anything (a scale, or a style with a condition that has something to show). */
export const ruleHasStyle = (r: ConditionalRule) => !!r.scale || !!(r.bg || r.color || r.bold || r.italic);

interface Prepared {
  rule: ConditionalRule;
  range: CellRange;
  /** A scale's smallest, median and largest number. */
  stats?: { lo: number; mid: number; hi: number };
}

const inside = (r: CellRange, col: number, row: number) => col >= r.col && col < r.col + r.width && row >= r.row && row < r.row + r.height;

/** At most this many cells of a range are read for a colour scale's smallest, median and largest value. */
const SCALE_CELLS = 200_000;

/**
 * The styles of a sheet's conditional formatting, as a function of a cell (null when the sheet has
 * no rules). Worked out once per state of the sheet: build it again after a change.
 */
export function conditionalStyles(sheet: Sheet): ((col: number, row: number) => CellStyle | undefined) | null {
  const rules = Object.entries(sheet.conditional ?? {})
    .sort(([a], [b]) => compareIds(a, b))
    .flatMap(([, rule]): Prepared[] => {
      const parsed = rule.range ? parseRangeText(rule.range) : null;
      if (!parsed || parsed.sheet !== null || !ruleHasStyle(rule)) return [];
      const prepared: Prepared = { rule, range: parsed.range };
      if (rule.scale) {
        const numbers: number[] = [];
        const r = parsed.range;
        if (r.width * r.height <= SCALE_CELLS) {
          for (let row = r.row; row < r.row + r.height; row++) {
            for (let col = r.col; col < r.col + r.width; col++) {
              const v = cellValue(sheet.cells[toA1(col, row)]);
              if (typeof v === 'number') numbers.push(v);
            }
          }
        }
        if (numbers.length === 0) return [];
        numbers.sort((a, b) => a - b);
        const m = numbers.length >> 1;
        const mid = numbers.length % 2 === 1 ? numbers[m] : (numbers[m - 1] + numbers[m]) / 2;
        prepared.stats = { lo: numbers[0], mid, hi: numbers[numbers.length - 1] };
      }
      return [prepared];
    });
  if (rules.length === 0) return null;
  return (col, row) => {
    for (const p of rules) {
      if (!inside(p.range, col, row)) continue;
      if (p.rule.scale && p.stats) {
        const v = cellValue(sheet.cells[toA1(col, row)]);
        if (typeof v !== 'number') continue;
        const bg = scaleColor(p.rule.scale, v, p.stats.lo, p.stats.mid, p.stats.hi);
        return { bg, color: readableText(bg) };
      }
      const { value, text } = shownCell(sheet, col, row);
      if (!meetsCondition(p.rule, value, text)) continue;
      const style: CellStyle = {};
      if (p.rule.bg) style.bg = p.rule.bg;
      if (p.rule.color) style.color = p.rule.color;
      else if (p.rule.bg) style.color = readableText(p.rule.bg);
      if (p.rule.bold) style.bold = true;
      if (p.rule.italic) style.italic = true;
      return style;
    }
    return undefined;
  };
}
