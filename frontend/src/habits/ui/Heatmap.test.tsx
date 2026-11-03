// The heatmap grid is one Tab stop with arrow keys (DESIGN §6.19, §6.35).
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../test/axe';
import { Heatmap } from './Heatmap';

// Monday 2026-10-26 starts the last of two weeks; days after today have no cell.
const today = '2026-10-28';
const cell = (day: string) => (day > today ? null : { day, tone: 'done', label: `Day ${day}` });

describe('Heatmap', () => {
  it('has a single Tab stop on the latest day, and arrows move by a day or a week', async () => {
    render(<Heatmap today={today} weeks={2} cell={cell} />);
    const day = (d: string) => screen.getByRole('gridcell', { name: `Day ${d}` });
    const stops = screen.getAllByRole('gridcell').filter((c) => c.getAttribute('tabindex') === '0');
    expect(stops).toEqual([day(today)]);
    day(today).focus();
    fireEvent.keyDown(day(today), { key: 'ArrowUp' });
    expect(day('2026-10-27')).toHaveFocus();
    fireEvent.keyDown(day('2026-10-27'), { key: 'ArrowLeft' });
    expect(day('2026-10-20')).toHaveFocus();
    // The selected day becomes the Tab stop.
    expect(day('2026-10-20')).toHaveAttribute('tabindex', '0');
    expect(day(today)).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(day('2026-10-20'), { key: 'Home' });
    expect(day('2026-10-19')).toHaveFocus();
    fireEvent.keyDown(day('2026-10-19'), { key: 'End' });
    expect(day(today)).toHaveFocus();
    // No day beyond today to move to.
    fireEvent.keyDown(day(today), { key: 'ArrowDown' });
    expect(day(today)).toHaveFocus();
    expect(await axeViolations()).toEqual([]);
  });
});

// Month labels (F12): no label is cut at the left edge of the scrolled grid, and none runs into the next.
describe('Heatmap month labels', () => {
  afterEach(() => vi.restoreAllMocks());
  const labels = (container: HTMLElement) => [...container.querySelectorAll('.hb-heatmap-months span')].map((s) => s.textContent);
  const all = (day: string) => ({ day, tone: 'done', label: day });

  /** The scroller of a 53-week grid (792 px) in a phone-wide pane (334 px); jsdom has no layout. */
  function phoneWidth() {
    let left = 0;
    const scroller = (el: Element) => el.classList.contains('hb-heatmap-scroll');
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return scroller(this) ? 792 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return scroller(this) ? 334 : 0;
    });
    vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockImplementation(function (this: Element) {
      return scroller(this) ? left : 0;
    });
    vi.spyOn(Element.prototype, 'scrollLeft', 'set').mockImplementation(function (this: Element, v: number) {
      if (scroller(this)) left = Math.max(0, Math.min(v, 792 - 334));
    });
  }

  it('opened on the latest weeks, hides the label of a column cut at the left edge and names the first whole one', () => {
    phoneWidth();
    // Column 30 is the week of Monday 2026-06-01 (x = 450); the grid opens scrolled to x = 458.
    const { container } = render(<Heatmap today="2026-11-02" weeks={53} cell={all} />);
    const l = labels(container);
    expect(l[30]).toBe('');
    expect(l[31]).toBe('Jun');
    expect(l[34]).toBe('Jul');
    // Scrolled back to the start, the first column is labelled again.
    const el = container.querySelector('.hb-heatmap-scroll')!;
    el.scrollLeft = 0;
    fireEvent.scroll(el);
    expect(labels(container)[0]).toBe('Nov');
    expect(labels(container)[30]).toBe('Jun');
  });

  it('leaves the first column unlabelled when the next one starts a month', () => {
    const { container } = render(<Heatmap today="2026-10-21" weeks={53} cell={all} />);
    const l = labels(container);
    expect(l[0]).toBe('');
    expect(l[1]).toBe('Nov');
  });
});
