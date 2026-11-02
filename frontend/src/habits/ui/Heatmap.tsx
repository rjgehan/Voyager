// Calendar heatmaps (DESIGN §6.35): weeks as columns (Monday on top), the latest on the right; on
// a phone the grid scrolls sideways and opens on the latest weeks. A tap or focus on a day shows it
// in the readout above the grid, so days need no tiny tap targets. The grid is one Tab stop (a
// roving tabindex, DESIGN §6.19): ↑/↓ move a day, ←/→ a week, Home and End to the first and last day.
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { dayjs } from '../../features/dates';
import { calendarWeeks } from '../progress';

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
  // The latest weeks stay in view while the width changes (a rotation), until the user scrolls.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinned = true;
    const pin = () => {
      if (pinned) el.scrollLeft = el.scrollWidth;
    };
    const onScroll = () => {
      pinned = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
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
            {columns.map((col, i) => {
              const first = col.find((d) => d.endsWith('-01'));
              return <span key={i}>{first || i === 0 ? dayjs(first ?? col[0], 'YYYY-MM-DD').format('MMM') : ''}</span>;
            })}
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
