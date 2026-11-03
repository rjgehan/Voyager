'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreBounds, snapshot, captureBounds, DEFAULT, MIN } = require('../src/windowState');

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 2560, height: 1400 };

test('first launch: default size, centred (no position)', () => {
  assert.deepEqual(restoreBounds(null, [primary]), { width: DEFAULT.width, height: DEFAULT.height, maximized: false });
});

test('a saved window on a connected screen comes back where it was', () => {
  const saved = { x: 2000, y: 100, width: 1600, height: 1000, maximized: true };
  assert.deepEqual(restoreBounds(saved, [primary, right]), saved);
});

test('a window on a disconnected screen is moved back onto the primary one', () => {
  const r = restoreBounds({ x: 2000, y: 100, width: 1600, height: 1000, maximized: false }, [primary]);
  assert.equal(r.x, undefined);
  assert.equal(r.y, undefined);
  assert.equal(r.width, 1600);
  assert.equal(r.height, 1000);
});

test('a title bar pushed above the screen counts as off-screen', () => {
  const r = restoreBounds({ x: 100, y: -500, width: 800, height: 600 }, [primary]);
  assert.equal(r.x, undefined);
});

test('sizes are clamped and junk is ignored', () => {
  assert.deepEqual(restoreBounds({ x: 10, y: 10, width: 50, height: 20 }, [primary]), { x: 10, y: 10, width: MIN.width, height: MIN.height, maximized: false });
  const huge = restoreBounds({ width: 99999, height: 99999 }, [primary]);
  assert.equal(huge.width, 1920);
  assert.equal(huge.height, 1040);
  assert.deepEqual(restoreBounds({ x: 'a', y: null, width: NaN, height: Infinity, maximized: 'yes' }, [primary]), {
    width: DEFAULT.width,
    height: DEFAULT.height,
    maximized: false,
  });
  assert.deepEqual(restoreBounds('nope', []), { width: DEFAULT.width, height: DEFAULT.height, maximized: false });
});

test('snapshot keeps the normal bounds and the maximized flag', () => {
  assert.deepEqual(snapshot({ x: 1, y: 2, width: 3, height: 4 }, 1), { x: 1, y: 2, width: 3, height: 4, maximized: true });
});

test('the capture window opens centred, a third of the way down the pointer display', () => {
  assert.deepEqual(captureBounds(right), { x: 1920 + (2560 - 520) / 2, y: Math.round((1400 - 440) / 3), width: 520, height: 440 });
  assert.deepEqual(captureBounds({ x: 0, y: 0, width: 400, height: 300 }), { x: 0, y: 0, width: 400, height: 300 });
});

// The app's desktop layout needs a page at least 1200 CSS px wide (frontend useBreakpoint.ts), and on
// Windows the window's width includes its frame (about 8 px a side), so a 1200 px window got the
// tablet layout.
const DESKTOP_LAYOUT_MIN = 1200;
const WINDOWS_FRAME = 16;

test('first launch on a 1080p screen opens wide enough for the desktop layout', () => {
  assert.ok(restoreBounds(null, [primary]).width - WINDOWS_FRAME >= DESKTOP_LAYOUT_MIN);
});

test('a window saved at the old default size (never resized) opens at the new default', () => {
  const r = restoreBounds({ x: 360, y: 120, width: 1200, height: 800, maximized: false }, [primary]);
  assert.equal(r.width, DEFAULT.width);
  assert.equal(r.x, 360);
  // A width the user chose stays as it is.
  assert.equal(restoreBounds({ x: 360, y: 120, width: 1200, height: 900 }, [primary]).width, 1200);
});
