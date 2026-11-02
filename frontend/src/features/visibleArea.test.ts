import { afterEach, describe, expect, it } from 'vitest';
import { fitVertically, visibleArea } from './visibleArea';

function setVisualViewport(value: { offsetTop: number; height: number } | undefined): void {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value });
}

afterEach(() => {
  setVisualViewport(undefined);
  document.documentElement.classList.remove('keyboard-open');
});

describe('where a context menu may go', () => {
  it('is the window, less a margin, without a visual viewport', () => {
    setVisualViewport(undefined);
    expect(visibleArea()).toEqual({ top: 8, bottom: window.innerHeight - 8 });
  });

  it('ends above the iOS keyboard, which shrinks the visual viewport', () => {
    setVisualViewport({ offsetTop: 0, height: 420 });
    document.documentElement.classList.add('keyboard-open');
    expect(visibleArea()).toEqual({ top: 8, bottom: 412 });
    // A long-press near the bottom of the note: the menu moves up to stay above the keyboard.
    expect(fitVertically(600, 200)).toBe(212);
  });

  it('follows the visual viewport when iOS has scrolled it', () => {
    setVisualViewport({ offsetTop: 150, height: 420 });
    expect(visibleArea()).toEqual({ top: 158, bottom: 562 });
    expect(fitVertically(100, 50)).toBe(158);
  });

  it('keeps a menu where it was asked for when it fits', () => {
    expect(fitVertically(300, 120, { top: 8, bottom: 800 })).toBe(300);
  });

  it('pins a menu taller than the area to its top (the menu scrolls)', () => {
    expect(fitVertically(300, 900, { top: 55, bottom: 770 })).toBe(55);
  });
});
