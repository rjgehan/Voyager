import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptySheet, type ChartProps, type Sheet, type SheetCell } from '../../sheets/format';
import { SheetChart } from './SheetChart';

const SHEET: Sheet = {
  ...emptySheet('s1', 'Budget'),
  cells: {
    A1: { v: 'Month' },
    B1: { v: 'Rent' },
    C1: { v: 'Food' },
    A2: { v: 'Jan' },
    B2: { v: 1450, fmt: '$#,##0' },
    C2: { v: 300 },
    A3: { v: 'Feb' },
    B3: { v: 1500, fmt: '$#,##0' },
    C3: { v: -50 },
  } as Record<string, SheetCell>,
};

const draw = (chart: ChartProps) => render(<SheetChart sheet={SHEET} chart={chart} />);

describe('SheetChart', () => {
  it('draws grouped bars from the baseline, with a legend and a tooltip per bar', () => {
    const { container } = draw({ type: 'bar', range: 'A1:C3', title: 'Costs', headers: true, labels: true });
    // Google Sheets calls vertical bars a column chart.
    expect(screen.getByRole('figure')).toHaveAttribute('aria-label', 'Column chart: Costs');
    const bars = container.querySelectorAll('path.sheet-chart-mark');
    expect(bars).toHaveLength(4);
    expect([...bars].map((b) => b.querySelector('title')?.textContent)).toEqual(['Jan · Rent: $1,450', 'Feb · Rent: $1,500', 'Jan · Food: 300', 'Feb · Food: -50']);
    expect([...container.querySelectorAll('.sheet-chart-legend li')].map((li) => li.textContent)).toEqual(['Rent', 'Food']);
    // The series colours come from the palette in order.
    expect((bars[0] as SVGPathElement).style.fill).toBe('var(--chart-1)');
    expect((bars[2] as SVGPathElement).style.fill).toBe('var(--chart-2)');
    // Ticks include zero and the negative value.
    expect([...container.querySelectorAll('.sheet-chart-tick')].map((t) => t.textContent)).toContain('0');
  });

  it('draws one line per series with ringed markers, and no legend for a single series', () => {
    const { container } = draw({ type: 'line', range: 'A1:B3', headers: true, labels: true });
    expect(container.querySelectorAll('path.sheet-chart-line')).toHaveLength(1);
    expect(container.querySelectorAll('circle.sheet-chart-dot')).toHaveLength(2);
    expect(container.querySelector('.sheet-chart-legend')).toBeNull();
    // A single series names the chart.
    expect(screen.getByRole('figure')).toHaveAttribute('aria-label', 'Line chart: Rent');
  });

  it('draws a pie of the first series with its shares in the legend', () => {
    const { container } = draw({ type: 'pie', range: 'A2:B3', labels: true });
    expect(container.querySelectorAll('.sheet-chart-slice')).toHaveLength(2);
    expect([...container.querySelectorAll('.sheet-chart-legend li')].map((li) => li.textContent)).toEqual(['Jan 49.2%', 'Feb 50.8%']);
  });

  it('stacks columns, bars and areas on each other, rounding only the outer end', () => {
    const { container } = draw({ type: 'bar', range: 'A1:C3', headers: true, labels: true, stacked: true });
    const bars = [...container.querySelectorAll('path.sheet-chart-mark')];
    expect(bars).toHaveLength(4);
    // Jan's Food sits on Jan's Rent: its path starts where Rent's ends.
    const top = (d: string) => Math.min(...[...d.matchAll(/[MVL]\s*[\d.]+,([\d.]+)|V([\d.]+)/g)].map((m) => Number(m[1] ?? m[2])));
    expect(top(bars[2].getAttribute('d')!)).toBeLessThan(top(bars[0].getAttribute('d')!));
    const h = draw({ type: 'hbar', range: 'A1:C3', headers: true, labels: true, stacked: true });
    expect(h.container.querySelectorAll('path.sheet-chart-mark')).toHaveLength(4);
    const area = draw({ type: 'area', range: 'A1:C3', headers: true, labels: true, stacked: true });
    expect(area.container.querySelectorAll('path.sheet-chart-area')).toHaveLength(2);
    expect(area.container.querySelectorAll('path.sheet-chart-line')).toHaveLength(2);
  });

  it('draws horizontal bars with the categories down the side', () => {
    const { container } = draw({ type: 'hbar', range: 'A1:B3', headers: true, labels: true, title: 'Rent' });
    expect(screen.getAllByRole('figure').at(-1)).toHaveAttribute('aria-label', 'Bar chart: Rent');
    const labels = [...container.querySelectorAll('text.sheet-chart-tick')].map((t) => t.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Jan', 'Feb']));
    expect(container.querySelectorAll('path.sheet-chart-mark')).toHaveLength(2);
  });

  it('draws a scatter of the first column’s numbers against the others', () => {
    const sheet: Sheet = { ...emptySheet('s2', 'Fit'), cells: { A1: { v: 'x' }, B1: { v: 'y' }, A2: { v: 1 }, B2: { v: 3 }, A3: { v: 2 }, B3: { v: 5 }, A4: { v: 'n/a' }, B4: { v: 7 } } };
    const { container } = render(<SheetChart sheet={sheet} chart={{ type: 'scatter', range: 'A1:B4', headers: true }} />);
    // The row without an X value is left out.
    expect(container.querySelectorAll('circle.sheet-chart-dot')).toHaveLength(2);
    expect([...container.querySelectorAll('circle title')].map((t) => t.textContent)).toEqual(['1 · y: 3', '2 · y: 5']);
    render(<SheetChart sheet={sheet} chart={{ type: 'scatter', range: 'A1:B1' }} />);
    expect(screen.getByText('A scatter chart’s first column holds its X values: A holds no numbers.')).toBeInTheDocument();
  });

  it('draws a doughnut, puts the legend below or hides it, and titles the axes', () => {
    const { container } = draw({ type: 'pie', donut: true, range: 'A2:B3', labels: true, legend: 'bottom' });
    expect(screen.getAllByRole('figure').at(-1)).toHaveAttribute('aria-label', 'Doughnut chart: Column B');
    // Each slice is a ring segment: two arcs.
    expect((container.querySelector('.sheet-chart-slice')!.getAttribute('d')!.match(/A/g) ?? []).length).toBe(2);
    const figure = container.querySelector('figure')!;
    expect(figure.lastElementChild).toHaveClass('sheet-chart-legend');
    const none = draw({ type: 'bar', range: 'A1:C3', headers: true, labels: true, legend: 'none', xTitle: 'Month', yTitle: 'Dollars' });
    expect(none.container.querySelector('.sheet-chart-legend')).toBeNull();
    expect([...none.container.querySelectorAll('.sheet-chart-axis-title')].map((t) => t.textContent)).toEqual(['Month', 'Dollars']);
  });

  it('explains a chart it cannot draw', () => {
    draw({ type: 'bar', range: 'A1:A3' });
    expect(screen.getByText('A1:A3 holds no numbers to chart.')).toBeInTheDocument();
    draw({ range: 'A1:B3', extra: { type: 'radar' } });
    expect(screen.getByText('This kind of chart needs a newer Voyager.')).toBeInTheDocument();
    draw({ type: 'pie', range: 'C3:C3' });
    expect(screen.getByText('The pie has no positive values to show.')).toBeInTheDocument();
  });
});
