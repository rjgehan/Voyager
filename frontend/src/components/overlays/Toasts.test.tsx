// Toasts (DESIGN §6.19): a polite live region; a toast waits while it has the pointer or the focus,
// so its action (Undo) can be reached in time (WCAG 2.2.1).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, useToasts } from '../../state/toasts';
import { axeViolations } from '../../test/axe';
import { Toasts } from './Toasts';

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toasts', () => {
  it('announces politely and goes away after its time', async () => {
    render(<Toasts />);
    act(() => void toast('Saved a copy'));
    expect(screen.getByText('Saved a copy').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    act(() => vi.advanceTimersByTime(4100));
    expect(screen.queryByText('Saved a copy')).toBeNull();
  });

  it('waits while the focus is in it, then gets its whole time again', () => {
    render(<Toasts />);
    const undo = vi.fn();
    act(() => void toast('Moved Plan', { action: { label: 'Undo', run: undo } }));
    const button = screen.getByRole('button', { name: 'Undo' });
    act(() => {
      button.focus();
    });
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByText('Moved Plan')).toBeInTheDocument();
    act(() => {
      button.blur();
    });
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText('Moved Plan')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.queryByText('Moved Plan')).toBeNull();
  });

  it('waits while the pointer is over it', () => {
    render(<Toasts />);
    act(() => void toast('Copied the link'));
    const item = screen.getByText('Copied the link').closest('.toast')!;
    fireEvent.pointerEnter(item);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Copied the link')).toBeInTheDocument();
    fireEvent.pointerLeave(item);
    act(() => vi.advanceTimersByTime(4100));
    expect(screen.queryByText('Copied the link')).toBeNull();
  });

  it('has no axe violations', async () => {
    vi.useRealTimers();
    render(<Toasts />);
    act(() => void toast('Moved Plan', { action: { label: 'Undo', run() {} } }));
    expect(await axeViolations()).toEqual([]);
  });
});
