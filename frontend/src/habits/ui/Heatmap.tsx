// Calendar heatmaps (DESIGN §6.35): weeks as columns (Monday on top), the latest on the right; on
// a phone the grid scrolls sideways and opens on the latest weeks. A tap or focus on a day shows it
// in the readout above the grid, so days need no tiny tap targets. The grid is one Tab stop (a
// roving tabindex, DESIGN §6.19): ↑/↓ move a day, ←/→ a week, Home and End to the first and last day.
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { dayjs } from '../../features/dates';
import { calendarWeeks } from '../progress';

/** A week column's width plus the gap after it (habits.css: 12 px tracks, 3 px gaps). */
const COLUMN_STEP = 15;

/**
 * The month labels of the week columns: a column holding the 1st shows its month. The first
 * column in full view (`start`, after the ones the scroller cuts or hides at its left edge) shows
 * its month too when the next column starts none, so the label has room; columns before it show
 * nothing, so no label is cut at the edge.
 */
function monthLabels(columns: readonly string[][], start = 0): string[] {
  const month = (day: string) => dayjs(day, 'YYYY-MM-DD').format('MMM');
  const firsts = columns.map((col) => col.find((d) => d.endsWith('-01')) ?? null);
  return columns.map((col, i) => {
    if (i < start) return '';
    const first = firsts[i];
    if (first) return month(first);
    return i === start && !firsts[i + 1] ? month(col[0]) : '';
  });
}

export interface HeatCell {
  day: string;
  /** CSS class suffix: the state for one habit, `level-N` for all habits. */
  tone: string;
  label: string;
}

export function Heatmap({ today, weeks, cell, color, readout, legend, onSelect }: {
  today: string;
  weeks: number;
  cell(day: string): HeatCell | null;
  color?: string;
  readout?: (day: string | null) => ReactNode;
  legend?: ReactNode;
  onSelect?(day: string): void;
}) {
  const columns = calendarWeeks(today, weeks);
  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // The first week column in full view (the grid scrolls sideways on a phone).
  const [start, setStart] = useState(0);
  // The latest weeks stay in view while the width changes (a rotation), until the user scrolls.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinned = true;
    const measure = () => setStart(Math.max(0, Math.ceil(el.scrollLeft / COLUMN_STEP - 0.01)));
    const pin = () => {
      if (pinned) el.scrollLeft = el.scrollWidth;
      measure();
    };
    const onScroll = () => {
      pinned = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      measure();
    };
    pin();
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(pin);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [weeks]);
  const select = (day: string) => {
    setSelected(day);
    onSelect?.(day);
  };
  // The days that can take the focus, oldest first; the selected one (else the latest) is the Tab stop.
  const days = columns.flat().filter((d) => cell(d) !== null);
  const stop = selected !== null && days.includes(selected) ? selected : days[days.length - 1];
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = (e.target as HTMLElement).dataset.day;
    if (!from) return;
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
    let next: string | undefined;
    if (step !== undefined) {
      next = dayjs(from, 'YYYY-MM-DD').add(step, 'day').format('YYYY-MM-DD');
      if (!days.includes(next)) return;
    } else if (e.key === 'Home') next = days[0];
    else if (e.key === 'End') next = days[days.length - 1];
    else return;
    e.preventDefault();
    e.currentTarget.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
  };
  return (
    <div className="hb-heatmap" style={color ? ({ '--hb-color': color } as CSSProperties) : undefined}>
      {readout && <div className="hb-heatmap-readout">{readout(selected)}</div>}
      <div className="hb-heatmap-body">
        <div className="hb-heatmap-days" aria-hidden>
          <span>Mon</span>
          <span />
          <span>Wed</span>
          <span />
          <span>Fri</span>
          <span />
          <span />
        </div>
        <div className="hb-heatmap-scroll" ref={scroller}>
          <div className="hb-heatmap-months" aria-hidden>
            {monthLabels(columns, start).map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </div>
          <div className="hb-heatmap-grid" role="grid" aria-label="Calendar" onKeyDown={onKeyDown}>
            {columns.map((col, i) => (
              <div key={i} className="hb-heatmap-week" role="row">
                {col.map((day) => {
                  const c = cell(day);
                  if (!c) return <span key={day} className="hb-cell is-none" role="gridcell" />;
                  return (
                    <button
                      key={day}
                      type="button"
                      role="gridcell"
                      data-day={day}
                      tabIndex={day === stop ? 0 : -1}
                      className={`hb-cell is-${c.tone}${selected === day ? ' is-selected' : ''}`}
                      aria-label={c.label}
                      title={c.label}
                      onClick={() => select(day)}
                      onFocus={() => setSelected(day)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {legend && <div className="hb-heatmap-legend">{legend}</div>}
    </div>
  );
}
