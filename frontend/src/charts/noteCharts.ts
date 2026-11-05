// Charts from note tables (ROADMAP item 46, WIP): a ```chart block after a table draws a pie,
// doughnut, column, bar or line chart of that table's computed values, with the spreadsheet chart
// renderer (views/sheet/SheetChart.tsx). Pure and DOM-free: the block's parsing, the table it
// names, the columns it charts, and the small sheet SheetChart reads.
import { toA1 } from '../sheets/a1';
import type { CellValue, ChartProps, LegendPosition, Sheet } from '../sheets/format';
import type { LinkValue } from '../sheets/links/values';
import { columnIndexOf, engineInput, isFormula } from '../formulas/model';

export const NOTE_CHART_TYPES = ['pie', 'doughnut', 'column', 'bar', 'line'] as const;
export type NoteChartType = (typeof NOTE_CHART_TYPES)[number];

export interface ChartSpec {
  type: NoteChartType;
  /** The table's block id (without `^`); null: the nearest table above the block. */
  table: string | null;
  title?: string;
  labels?: string;
  values?: string[];
  legend?: LegendPosition;
}

export type SpecResult = { ok: true; spec: ChartSpec } | { ok: false; message: string };

/** Reads a chart block's body (`key: value` lines). Unknown keys are ignored. */
export function parseChartBlock(body: string): SpecResult {
  const spec: ChartSpec = { type: 'column', table: null };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'type') {
      const t = value.toLowerCase() === 'donut' ? 'doughnut' : value.toLowerCase();
      if (!(NOTE_CHART_TYPES as readonly string[]).includes(t)) return { ok: false, message: `Unknown chart type “${value}”: use pie, doughnut, column, bar or line.` };
      spec.type = t as NoteChartType;
    } else if (key === 'table') spec.table = value.replace(/^\^/, '') || null;
    else if (key === 'title') spec.title = value || undefined;
    else if (key === 'labels') spec.labels = value || undefined;
    else if (key === 'values') {
      const list = value.split(',').map((v) => v.trim()).filter(Boolean);
      spec.values = list.length ? list : undefined;
    } else if (key === 'legend') {
      const l = value.toLowerCase();
      spec.legend = l === 'bottom' ? 'bottom' : ['none', 'false', 'off', 'hide', 'no'].includes(l) ? 'none' : 'top';
    }
  }
  return { ok: true, spec };
}

/** The block's text for a spec (what Insert chart writes). */
export function chartBlockText(spec: ChartSpec): string {
  const lines = ['```chart', `type: ${spec.type}`];
  if (spec.table) lines.push(`table: ${spec.table}`);
  if (spec.title) lines.push(`title: ${spec.title}`);
  if (spec.labels) lines.push(`labels: ${spec.labels}`);
  if (spec.values?.length) lines.push(`values: ${spec.values.join(', ')}`);
  if (spec.legend && spec.legend !== 'top') lines.push(`legend: ${spec.legend}`);
  lines.push('```');
  return lines.join('\n');
}

/** The body of a fenced block's text (between its fences). */
export function fencedBody(text: string): string {
  const lines = text.split('\n');
  const last = lines.length > 1 && /^\s*(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]) ? lines.length - 1 : lines.length;
  return lines.slice(1, last).join('\n');
}

export interface TableRef {
  id: string | null;
  /** Where the table ends (an offset or a line, in the same units as the chart's start). */
  end: number;
}

/** The table a chart reads: its index, or why there is none. */
export function pickTable(spec: ChartSpec, tables: readonly TableRef[], chartStart: number): { ok: true; index: number } | { ok: false; message: string } {
  if (spec.table) {
    const key = spec.table.toLowerCase();
    const index = tables.findIndex((t) => t.id?.toLowerCase() === key);
    return index >= 0 ? { ok: true, index } : { ok: false, message: `No table “^${spec.table}” in this note.` };
  }
  let index = -1;
  tables.forEach((t, i) => {
    if (t.end <= chartStart) index = i;
  });
  return index >= 0 ? { ok: true, index } : { ok: false, message: 'No table above this chart. Put the chart under a table, or name one with table:.' };
}

export interface ChartTable {
  /** The cells as written; row 0 is the header. */
  rows: readonly (readonly string[])[];
  /** The computed values (formulas' results), same shape; null: read the written cells. */
  values: readonly (readonly LinkValue[])[] | null;
  formats: Readonly<Record<number, string>>;
}

/** A plain cell's number (`1,450`, `$12`, `15%`), else its text, as the engine would read it. */
export function plainValue(text: string): LinkValue {
  const input = engineInput(text);
  if (input === null) return null;
  const m = /^([-+]?)[$€£¥]?(\d*\.?\d+(?:e[-+]?\d+)?)(%?)$/i.exec(input);
  if (m) {
    const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    return m[3] ? n / 100 : n;
  }
  return input.startsWith("'") ? input.slice(1) : input;
}

/** A cell's text without the Markdown around it (labels, header names). */
export function plainText(text: string): string {
  return text
    .trim()
    .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==|\*|_)(.+?)\1/g, '$2')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .trim();
}

const width = (t: ChartTable) => Math.max(0, ...t.rows.map((r) => r.length));

function valueAt(t: ChartTable, row: number, col: number): LinkValue {
  if (t.values) return t.values[row]?.[col] ?? null;
  return plainValue(t.rows[row]?.[col] ?? '');
}

const asNumber = (v: LinkValue): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'object' && v !== null && 'date' in v ? v.date : null);

/** A column by header name (case-insensitive) or letters; -1 when the table has none. */
export function columnOf(ref: string, t: ChartTable): number {
  const key = ref.trim().toLowerCase();
  const header = t.rows[0] ?? [];
  const byName = header.findIndex((h) => plainText(h).toLowerCase() === key);
  if (byName >= 0) return byName;
  const byLetter = columnIndexOf(ref.trim());
  return byLetter >= 0 && byLetter < width(t) ? byLetter : -1;
}

const columnName = (t: ChartTable, col: number) => {
  const letters = toA1(col, 0).replace(/\d+$/, '');
  const name = plainText(t.rows[0]?.[col] ?? '');
  return name ? `${letters} (${name})` : letters;
};

export interface NoteChart {
  sheet: Sheet;
  chart: ChartProps;
}

export type BuildResult = { ok: true; data: NoteChart } | { ok: false; message: string };

const TYPE_PROPS: Record<NoteChartType, Pick<ChartProps, 'type' | 'donut'>> = {
  pie: { type: 'pie' },
  doughnut: { type: 'pie', donut: true },
  column: { type: 'bar' },
  bar: { type: 'hbar' },
  line: { type: 'line' },
};

/** The default value columns: every column but the labels' that holds a number. */
export function numericColumns(t: ChartTable, labels: number): number[] {
  const out: number[] = [];
  for (let col = 0; col < width(t); col++) {
    if (col === labels) continue;
    for (let row = 1; row < t.rows.length; row++) {
      if (asNumber(valueAt(t, row, col)) !== null) {
        out.push(col);
        break;
      }
    }
  }
  return out;
}

/** The sheet and chart props SheetChart draws for a spec over a table, or why it cannot. */
export function buildChart(spec: ChartSpec, t: ChartTable): BuildResult {
  if (t.rows.length < 2) return { ok: false, message: 'The table has no rows to chart.' };
  const labels = spec.labels ? columnOf(spec.labels, t) : 0;
  if (labels < 0) return { ok: false, message: `No column “${spec.labels}”: use a column letter (A, B, …) or a header name.` };
  let values: number[];
  if (spec.values) {
    values = [];
    for (const ref of spec.values) {
      const col = columnOf(ref, t);
      if (col < 0) return { ok: false, message: `No column “${ref}”: use a column letter (A, B, …) or a header name.` };
      if (numericColumns(t, -1).indexOf(col) < 0) return { ok: false, message: `Column ${columnName(t, col)} holds no numbers to chart.` };
      values.push(col);
    }
  } else {
    values = numericColumns(t, labels);
    if (values.length === 0) return { ok: false, message: 'The table has no numbers to chart.' };
  }
  const cells: Sheet['cells'] = {};
  const put = (col: number, row: number, v: CellValue | null, fmt?: string) => {
    if (v === null && !fmt) return;
    cells[toA1(col, row)] = v === null ? { fmt } : fmt ? { v, fmt } : { v };
  };
  put(0, 0, plainText(t.rows[0][labels] ?? '') || 'Label');
  values.forEach((col, j) => put(j + 1, 0, plainText(t.rows[0][col] ?? '') || columnName(t, col)));
  let out = 1;
  for (let row = 1; row < t.rows.length; row++) {
    const cellsOfRow = [labels, ...values].map((c) => (t.rows[row]?.[c] ?? '').trim());
    if (cellsOfRow.every((c) => c === '')) continue;
    const raw = t.rows[row]?.[labels] ?? '';
    const lv = valueAt(t, row, labels);
    const label = isFormula(raw) ? (typeof lv === 'object' && lv !== null ? '' : String(lv ?? '')) : plainText(raw);
    put(0, out, label);
    values.forEach((col, j) => put(j + 1, out, asNumber(valueAt(t, row, col)), t.formats[col]));
    out++;
  }
  const range = `A1:${toA1(values.length, out - 1)}`;
  const chart: ChartProps = { ...TYPE_PROPS[spec.type], range, headers: true, labels: true };
  if (spec.title) chart.title = spec.title;
  if (spec.legend && spec.legend !== 'top') chart.legend = spec.legend;
  return { ok: true, data: { sheet: { id: 'chart', name: 'Chart', cells, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 }, charts: {} }, chart } };
}
