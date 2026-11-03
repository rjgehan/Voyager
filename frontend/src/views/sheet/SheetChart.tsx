// A chart of a sheet's range (DESIGN §6.21.9), drawn as plain SVG from the cached values, in the
// grid view's chart pane and in embeds: column (vertical bars), bar (horizontal), line, area, pie
// or doughnut, and scatter charts, Google Sheets' names; columns, bars and areas can be stacked.
// Bars are at most 24 px thick with a rounded data end, lines are 2 px with ringed markers, areas
// a line over a light fill, a pie is cut by the surface colour, scatter points are ringed 8 px dots.
// Series take the eight validated categorical colours in a fixed order (styles/sheetChart.css, both
// themes); text stays in text colours; every mark has a tooltip with its value as the sheet shows it.
import '../../styles/sheetChart.css';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CHART_NAMES, chartData, niceTicks, pieSlices, tickLabel, valueExtent, type ChartData } from '../../sheets/charts';
import type { ChartProps, Sheet } from '../../sheets/format';
import { formatNumberWith } from '../../sheets/numfmt';

interface Props {
  sheet: Sheet;
  chart: ChartProps;
  /** Height of the plot in px. */
  height?: number;
  /** Buttons shown beside the title (edit, delete). */
  actions?: ReactNode;
}

const color = (i: number) => `var(--chart-${(i % 8) + 1})`;
const BAR_MAX = 24;
const GAP = 2;
const LABEL_CHAR = 7;

/** A vertical bar from `y0` (the baseline) to `y1`, its data end rounded. */
function barPath(x: number, w: number, y0: number, y1: number, round = true): string {
  const up = y1 <= y0;
  const h = Math.abs(y1 - y0);
  const r = round ? Math.min(4, w / 2, h) : 0;
  if (h === 0) return '';
  if (up) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

/** A horizontal bar from `x0` (the baseline) to `x1`, its data end rounded. */
function hbarPath(y: number, h: number, x0: number, x1: number, round = true): string {
  const right = x1 >= x0;
  const w = Math.abs(x1 - x0);
  const r = round ? Math.min(4, h / 2, w) : 0;
  if (w === 0) return '';
  if (right) return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
  return `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
}

function truncate(text: string, px: number): string {
  const max = Math.max(1, Math.floor(px / LABEL_CHAR));
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + '…';
}

const tip = (data: ChartData, s: ChartData['series'][number], i: number) => `${data.categories[i]}${s.name ? ` · ${s.name}` : ''}: ${s.shown[i]}`;

/** Room for axis titles: under the plot and left of it. */
function titleRoom(chart: ChartProps): { below: number; left: number } {
  return { below: chart.xTitle?.trim() ? 16 : 0, left: chart.yTitle?.trim() ? 16 : 0 };
}

function AxisTitles({ chart, width, height }: { chart: ChartProps; width: number; height: number }) {
  const x = chart.xTitle?.trim();
  const y = chart.yTitle?.trim();
  return (
    <>
      {x && (
        <text x={width / 2} y={height - 2} className="sheet-chart-axis-title" textAnchor="middle">
          {x}
        </text>
      )}
      {y && (
        <text x={0} y={0} transform={`translate(10, ${height / 2}) rotate(-90)`} className="sheet-chart-axis-title" textAnchor="middle">
          {y}
        </text>
      )}
    </>
  );
}

/** Adds `v` to a category's stack (upwards or downwards) and returns where its segment starts. */
function stackFrom(pos: number[], neg: number[], i: number, v: number): number {
  const from = v >= 0 ? pos[i] : neg[i];
  if (v >= 0) pos[i] += v;
  else neg[i] += v;
  return from;
}

/** Column, line and area charts: categories along the bottom, values up the side. */
function CartesianChart({ data, chart, type, width, height }: { data: ChartData; chart: ChartProps; type: 'bar' | 'line' | 'area'; width: number; height: number }) {
  const stacked = chart.stacked === true && type !== 'line';
  const room = titleRoom(chart);
  const [lo, hi] = valueExtent(data, stacked);
  const ticks = niceTicks(lo, hi);
  const labels = ticks.map((t) => tickLabel(t, data.percent));
  const m = { top: 8, right: 8, bottom: 22 + room.below, left: Math.max(...labels.map((l) => l.length)) * LABEL_CHAR + 10 + room.left };
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = Math.max(10, height - m.top - m.bottom);
  const t0 = ticks[0];
  const t1 = ticks[ticks.length - 1];
  const y = (v: number) => m.top + plotH * (1 - (v - t0) / (t1 - t0));
  const n = data.categories.length;
  const band = plotW / n;
  const k = data.series.length;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
  const center = (i: number) => m.left + band * (i + 0.5);
  const marks: ReactNode[] = [];
  // Where each category's stack has reached, upwards and downwards.
  const pos = new Array<number>(n).fill(0);
  const neg = new Array<number>(n).fill(0);
  if (type === 'bar') {
    const barW = stacked ? Math.max(1, Math.min(BAR_MAX * 1.5, band * 0.6)) : Math.max(1, Math.min(BAR_MAX, (band * 0.8 - GAP * (k - 1)) / k));
    const groupW = stacked ? barW : barW * k + GAP * (k - 1);
    data.series.forEach((s, j) =>
      s.values.forEach((v, i) => {
        if (v === null) return;
        const x = m.left + band * i + (band - groupW) / 2 + (stacked ? 0 : j * (barW + GAP));
        const from = stacked ? stackFrom(pos, neg, i, v) : 0;
        // In a stack, only the outermost segment has a rounded end.
        const d = barPath(x, barW, y(from), y(from + v), !stacked || j === k - 1);
        if (d === '') return;
        marks.push(
          <path key={`${j}-${i}`} d={d} className="sheet-chart-mark" style={{ fill: color(j) }}>
            <title>{tip(data, s, i)}</title>
          </path>,
        );
      }),
    );
  } else {
    data.series.forEach((s, j) => {
      // Stacked areas sit on the series below them.
      const bottom = s.values.map((_, i) => (stacked ? pos[i] : 0));
      const top = s.values.map((v, i) => (v === null ? null : bottom[i] + v));
      if (stacked) s.values.forEach((v, i) => (pos[i] += v ?? 0));
      let line = '';
      let pen = false;
      top.forEach((v, i) => {
        if (v === null) {
          pen = false;
          return;
        }
        line += `${pen ? 'L' : 'M'}${center(i)},${y(v)}`;
        pen = true;
      });
      if (type === 'area') {
        // The area under each unbroken run of the line, down to its bottom.
        const runs: number[][] = [];
        let run: number[] = [];
        top.forEach((v, i) => {
          if (v === null) {
            if (run.length > 0) runs.push(run);
            run = [];
          } else run.push(i);
        });
        if (run.length > 0) runs.push(run);
        runs.forEach((r, x) => {
          const upper = r.map((i) => `${center(i)},${y(top[i] as number)}`).join('L');
          const lower = [...r].reverse().map((i) => `${center(i)},${y(bottom[i])}`).join('L');
          marks.push(<path key={`area-${j}-${x}`} d={`M${upper}L${lower}Z`} className="sheet-chart-area" style={{ fill: color(j) }} />);
        });
      }
      marks.push(<path key={`line-${j}`} d={line} className="sheet-chart-line" style={{ stroke: color(j) }} />);
      if (n <= 60) {
        top.forEach((v, i) => {
          if (v === null) return;
          marks.push(
            <circle key={`${j}-${i}`} cx={center(i)} cy={y(v)} r={type === 'area' ? 3 : 4} className="sheet-chart-dot" style={{ fill: color(j) }}>
              <title>{tip(data, s, i)}</title>
            </circle>,
          );
        });
      }
    });
  }
  return (
    <svg width={width} height={height} className="sheet-chart-svg" role="presentation">
      {ticks.map((t, i) => (
        <g key={t}>
          <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'sheet-chart-baseline' : 'sheet-chart-grid'} />
          <text x={m.left - 6} y={y(t)} className="sheet-chart-tick" textAnchor="end" dominantBaseline="middle">
            {labels[i]}
          </text>
        </g>
      ))}
      {marks}
      {data.categories.map((c, i) =>
        i % every === 0 ? (
          <text key={`x-${i}`} x={center(i)} y={height - 6 - room.below} className="sheet-chart-tick" textAnchor="middle">
            {truncate(c, band * every - 4)}
          </text>
        ) : null,
      )}
      <AxisTitles chart={chart} width={width} height={height} />
    </svg>
  );
}

/** A bar chart: categories down the side, values along the bottom (Google Sheets' bar chart). */
function HBarChart({ data, chart, width, height }: { data: ChartData; chart: ChartProps; width: number; height: number }) {
  const stacked = chart.stacked === true;
  const room = titleRoom(chart);
  const [lo, hi] = valueExtent(data, stacked);
  const ticks = niceTicks(lo, hi, Math.max(2, Math.floor(width / 90)));
  const labels = ticks.map((t) => tickLabel(t, data.percent));
  const n = data.categories.length;
  const k = data.series.length;
  const labelW = Math.min(width * 0.35, Math.max(...data.categories.map((c) => c.length)) * LABEL_CHAR + 10);
  const m = { top: 4, right: 12, bottom: 20 + room.below, left: labelW + room.left };
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = Math.max(10, height - m.top - m.bottom);
  const t0 = ticks[0];
  const t1 = ticks[ticks.length - 1];
  const x = (v: number) => m.left + plotW * ((v - t0) / (t1 - t0));
  const band = plotH / n;
  const barH = stacked ? Math.max(1, Math.min(BAR_MAX * 1.5, band * 0.6)) : Math.max(1, Math.min(BAR_MAX, (band * 0.8 - GAP * (k - 1)) / k));
  const groupH = stacked ? barH : barH * k + GAP * (k - 1);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotH / 16))));
  const pos = new Array<number>(n).fill(0);
  const neg = new Array<number>(n).fill(0);
  const marks: ReactNode[] = [];
  data.series.forEach((s, j) =>
    s.values.forEach((v, i) => {
      if (v === null) return;
      const top = m.top + band * i + (band - groupH) / 2 + (stacked ? 0 : j * (barH + GAP));
      const from = stacked ? stackFrom(pos, neg, i, v) : 0;
      const d = hbarPath(top, barH, x(from), x(from + v), !stacked || j === k - 1);
      if (d === '') return;
      marks.push(
        <path key={`${j}-${i}`} d={d} className="sheet-chart-mark" style={{ fill: color(j) }}>
          <title>{tip(data, s, i)}</title>
        </path>,
      );
    }),
  );
  return (
    <svg width={width} height={height} className="sheet-chart-svg" role="presentation">
      {ticks.map((t, i) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={m.top} y2={m.top + plotH} className={t === 0 ? 'sheet-chart-baseline' : 'sheet-chart-grid'} />
          <text x={x(t)} y={height - 6 - room.below} className="sheet-chart-tick" textAnchor="middle">
            {labels[i]}
          </text>
        </g>
      ))}
      {marks}
      {data.categories.map((c, i) =>
        i % every === 0 ? (
          <text key={`y-${i}`} x={m.left - 6} y={m.top + band * (i + 0.5)} className="sheet-chart-tick" textAnchor="end" dominantBaseline="middle">
            {truncate(c, labelW - 8)}
          </text>
        ) : null,
      )}
      <AxisTitles chart={chart} width={width} height={height} />
    </svg>
  );
}

/** A scatter chart: the first column's numbers along the bottom, each other column's up the side. */
function ScatterChart({ data, chart, width, height }: { data: ChartData; chart: ChartProps; width: number; height: number }) {
  const room = titleRoom(chart);
  const xs = (data.xValues ?? []).filter((v): v is number => v !== null);
  const [lo, hi] = valueExtent(data, false);
  const yTicks = niceTicks(lo, hi);
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), Math.max(2, Math.floor(width / (data.xFormat ? 110 : 90))), false);
  const xLabel = (t: number) => (data.xFormat ? formatNumberWith(t, data.xFormat).text : tickLabel(t, false));
  const yLabels = yTicks.map((t) => tickLabel(t, data.percent));
  const m = { top: 8, right: 12, bottom: 22 + room.below, left: Math.max(...yLabels.map((l) => l.length)) * LABEL_CHAR + 10 + room.left };
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = Math.max(10, height - m.top - m.bottom);
  const x = (v: number) => m.left + plotW * ((v - xTicks[0]) / (xTicks[xTicks.length - 1] - xTicks[0]));
  const y = (v: number) => m.top + plotH * (1 - (v - yTicks[0]) / (yTicks[yTicks.length - 1] - yTicks[0]));
  const marks: ReactNode[] = [];
  data.series.forEach((s, j) =>
    s.values.forEach((v, i) => {
      const xv = data.xValues?.[i] ?? null;
      if (v === null || xv === null) return;
      marks.push(
        <circle key={`${j}-${i}`} cx={x(xv)} cy={y(v)} r={4} className="sheet-chart-dot" style={{ fill: color(j) }}>
          <title>{tip(data, s, i)}</title>
        </circle>,
      );
    }),
  );
  return (
    <svg width={width} height={height} className="sheet-chart-svg" role="presentation">
      {yTicks.map((t, i) => (
        <g key={`y${t}`}>
          <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'sheet-chart-baseline' : 'sheet-chart-grid'} />
          <text x={m.left - 6} y={y(t)} className="sheet-chart-tick" textAnchor="end" dominantBaseline="middle">
            {yLabels[i]}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={x(t)} y={height - 6 - room.below} className="sheet-chart-tick" textAnchor="middle">
          {xLabel(t)}
        </text>
      ))}
      {marks}
      <AxisTitles chart={chart} width={width} height={height} />
    </svg>
  );
}

function PieChart({ data, donut, width, height }: { data: ChartData; donut: boolean; width: number; height: number }) {
  const slices = pieSlices(data);
  if (slices.length === 0) return <p className="sheet-chart-empty">The pie has no positive values to show.</p>;
  const r = Math.max(10, Math.min(width, height) / 2 - 4);
  // A doughnut's hole is half its radius, as in Google Sheets.
  const inner = donut ? r * 0.5 : 0;
  const cx = width / 2;
  const cy = height / 2;
  // Each slice's start and end angle, clockwise from twelve o'clock.
  const ends = slices.map((_, i) => -Math.PI / 2 + slices.slice(0, i + 1).reduce((sum, x) => sum + x.share, 0) * Math.PI * 2);
  const point = (radius: number, angle: number) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  return (
    <svg width={width} height={height} className="sheet-chart-svg" role="presentation">
      {slices.map((s, i) => {
        const start = i === 0 ? -Math.PI / 2 : ends[i - 1];
        const angle = ends[i];
        const label = `${s.label}: ${s.shown} (${Math.round(s.share * 1000) / 10}%)`;
        if (slices.length === 1) {
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} className="sheet-chart-slice" style={{ fill: color(i) }}>
                <title>{label}</title>
              </circle>
              {donut && <circle cx={cx} cy={cy} r={inner} className="sheet-chart-hole" />}
            </g>
          );
        }
        const [x1, y1] = point(r, start);
        const [x2, y2] = point(r, angle);
        const large = angle - start > Math.PI ? 1 : 0;
        let d = `M${cx},${cy}L${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}Z`;
        if (donut) {
          const [x3, y3] = point(inner, angle);
          const [x4, y4] = point(inner, start);
          d = `M${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${inner},${inner} 0 ${large} 0 ${x4},${y4}Z`;
        }
        return (
          <path key={i} d={d} className="sheet-chart-slice" style={{ fill: color(i) }}>
            <title>{label}</title>
          </path>
        );
      })}
    </svg>
  );
}

function Legend({ items }: { items: string[] }) {
  return (
    <ul className="sheet-chart-legend">
      {items.map((label, i) => (
        <li key={i}>
          <span className="sheet-chart-swatch" style={{ background: color(i) }} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function SheetChart({ sheet, chart, height = 200, actions }: Props) {
  const box = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(360);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const inner = el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      if (inner > 0) setWidth(Math.floor(inner));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const result = chartData(sheet, chart);
  const type = chart.type ?? 'bar';
  const title = chart.title?.trim() || (result.ok && result.data.series.length === 1 && result.data.series[0].name) || 'Chart';
  let legend: string[] = [];
  if (result.ok && type === 'pie') legend = pieSlices(result.data).map((s) => `${s.label} ${Math.round(s.share * 1000) / 10}%`);
  else if (result.ok && result.data.series.length > 1) legend = result.data.series.map((s) => s.name);
  if (chart.legend === 'none') legend = [];
  const hidden = result.ok ? result.data.hiddenSeries + result.data.hiddenCategories : 0;
  const name = type === 'pie' && chart.donut ? 'Doughnut' : (CHART_NAMES[type] ?? 'Column');
  const plot = (data: ChartData) => {
    if (type === 'pie') return <PieChart data={data} donut={chart.donut === true} width={width} height={height} />;
    if (type === 'hbar') return <HBarChart data={data} chart={chart} width={width} height={height} />;
    if (type === 'scatter') return <ScatterChart data={data} chart={chart} width={width} height={height} />;
    return <CartesianChart data={data} chart={chart} type={type} width={width} height={height} />;
  };
  return (
    <figure ref={box} className="sheet-chart" aria-label={`${name} chart: ${title}`}>
      <figcaption className="sheet-chart-head">
        <span className="sheet-chart-title">{title}</span>
        {actions}
      </figcaption>
      {!chart.type && chart.extra?.type !== undefined ? (
        <p className="sheet-chart-empty">This kind of chart needs a newer Voyager.</p>
      ) : !result.ok ? (
        <p className="sheet-chart-empty">{result.message}</p>
      ) : (
        <>
          {legend.length > 0 && chart.legend !== 'bottom' && <Legend items={legend} />}
          <div className="sheet-chart-plot" style={{ height }}>
            {plot(result.data)}
          </div>
          {legend.length > 0 && chart.legend === 'bottom' && <Legend items={legend} />}
          {hidden > 0 && (
            <p className="sheet-chart-note">
              {result.data.hiddenSeries > 0 && `${result.data.hiddenSeries} more series not shown. `}
              {result.data.hiddenCategories > 0 && `${result.data.hiddenCategories} more rows not shown.`}
            </p>
          )}
        </>
      )}
    </figure>
  );
}
