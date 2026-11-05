import { describe, expect, it } from 'vitest';
import { chartData, pieSlices } from '../sheets/charts';
import { buildChart, chartBlockText, columnOf, parseChartBlock, pickTable, plainValue, type ChartTable } from './noteCharts';

const table: ChartTable = {
  rows: [
    ['Item', 'Amount', 'Notes'],
    ['**Rent**', '1,450', 'x'],
    ['Food', '=B2/2', 'y'],
  ],
  values: [
    ['Item', 'Amount', 'Notes'],
    ['**Rent**', 1450, 'x'],
    ['Food', 725, 'y'],
  ],
  formats: {},
};

describe('note charts', () => {
  it('parses a block', () => {
    const r = parseChartBlock('type: pie\ntable: ^budget\ntitle: Spending\nvalues: Amount, C\nlegend: none');
    expect(r).toEqual({ ok: true, spec: { type: 'pie', table: 'budget', title: 'Spending', values: ['Amount', 'C'], legend: 'none' } });
    expect(parseChartBlock('type: radar').ok).toBe(false);
  });

  it('writes a block that reads back', () => {
    const spec = { type: 'doughnut' as const, table: 'b', title: 'T' };
    const text = chartBlockText(spec);
    expect(parseChartBlock(text.split('\n').slice(1, -1).join('\n'))).toEqual({ ok: true, spec });
  });

  it('picks the named table or the nearest above', () => {
    const tables = [
      { id: null, end: 5 },
      { id: 'budget', end: 20 },
    ];
    expect(pickTable({ type: 'pie', table: 'Budget' }, tables, 0)).toEqual({ ok: true, index: 1 });
    expect(pickTable({ type: 'pie', table: null }, tables, 10)).toEqual({ ok: true, index: 0 });
    expect(pickTable({ type: 'pie', table: null }, tables, 2).ok).toBe(false);
    expect(pickTable({ type: 'pie', table: 'nope' }, tables, 30).ok).toBe(false);
  });

  it('picks columns by name or letter', () => {
    expect(columnOf('amount', table)).toBe(1);
    expect(columnOf('C', table)).toBe(2);
    expect(columnOf('Z', table)).toBe(-1);
  });

  it('charts computed values, formulas included', () => {
    const r = buildChart({ type: 'pie', table: null }, table);
    if (!r.ok) throw new Error(r.message);
    const data = chartData(r.data.sheet, r.data.chart);
    if (!data.ok) throw new Error(data.message);
    expect(pieSlices(data.data).map((s) => [s.label, s.value])).toEqual([
      ['Rent', 1450],
      ['Food', 725],
    ]);
  });

  it('reads plain cells without the engine', () => {
    expect(plainValue('1,450')).toBe(1450);
    expect(plainValue('15%')).toBe(0.15);
    expect(plainValue('$12')).toBe(12);
    expect(plainValue('abc')).toBe('abc');
  });

  it('explains non-numeric columns and missing ones', () => {
    expect(buildChart({ type: 'pie', table: null, values: ['Notes'] }, table)).toEqual({ ok: false, message: 'Column C (Notes) holds no numbers to chart.' });
    expect(buildChart({ type: 'pie', table: null, labels: 'X' }, table).ok).toBe(false);
    expect(buildChart({ type: 'pie', table: null }, { rows: [['a'], ['b']], values: null, formats: {} })).toEqual({ ok: false, message: 'The table has no numbers to chart.' });
  });
});
