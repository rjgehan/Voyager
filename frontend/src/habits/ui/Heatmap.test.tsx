// The heatmap grid is one Tab stop with arrow keys (DESIGN §6.19, §6.35).
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
