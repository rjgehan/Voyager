import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREFS_KEY } from './prefs';

async function loadWith(stored: unknown) {
  vi.resetModules();
  localStorage.setItem(PREFS_KEY, JSON.stringify(stored));
  return (await import('./prefs')).usePrefs.getState();
}

async function freshPrefs() {
  vi.resetModules();
  return (await import('./prefs')).usePrefs;
}

afterEach(() => {
  localStorage.clear();
});

describe('per-device preferences', () => {
  it('reads vim mode from this device, off unless it is exactly true', async () => {
    expect((await loadWith({ vimMode: true })).vimMode).toBe(true);
    expect((await loadWith({ vimMode: 'yes' })).vimMode).toBe(false);
    expect((await loadWith({ theme: 'light' })).vimMode).toBe(false);
  });
});

describe('Live Preview syntax visibility (per device, ROADMAP 10a)', () => {
  it('hides all markup by default', async () => {
    expect((await freshPrefs()).getState().syntaxVisibility).toBe('hide-all');
  });

  it('is stored with the other preferences of this device', async () => {
    const prefs = await freshPrefs();
    prefs.getState().update({ syntaxVisibility: 'reveal-at-cursor', vimMode: true });
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toMatchObject({ syntaxVisibility: 'reveal-at-cursor', vimMode: true, theme: 'dark' });
    expect((await freshPrefs()).getState().syntaxVisibility).toBe('reveal-at-cursor');
  });

  it('falls back to hide-all for an unknown stored value', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ syntaxVisibility: 'sometimes' }));
    expect((await freshPrefs()).getState().syntaxVisibility).toBe('hide-all');
  });
});

// Two tabs of the app on one device (two vaults share the device's preferences).
describe('preferences changed in another tab', () => {
  async function tabB() {
    localStorage.clear();
    vi.resetModules();
    const prefs = await import('./prefs');
    const offline = await import('../offline/offlineStore');
    return { ...prefs, offline };
  }

  function tabAWrites(stored: Record<string, unknown>) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(stored));
  }

  it('are followed: offline copies stop, and the theme changes', async () => {
    const { usePrefs, DEFAULT_PREFS, offline } = await tabB();
    expect(usePrefs.getState().offlineNotes).toBe(true);
    tabAWrites({ ...DEFAULT_PREFS, offlineNotes: false, theme: 'light' });
    window.dispatchEvent(new StorageEvent('storage', { key: PREFS_KEY, newValue: localStorage.getItem(PREFS_KEY) }));
    expect(usePrefs.getState().offlineNotes).toBe(false);
    expect(offline.offlineCopiesEnabled()).toBe(false);
    expect(usePrefs.getState().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('are not undone by this tab’s next change', async () => {
    const { usePrefs, DEFAULT_PREFS, toggleTheme } = await tabB();
    tabAWrites({ ...DEFAULT_PREFS, offlineNotes: false, theme: 'light' });
    usePrefs.getState().update({ vimMode: true });
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toMatchObject({ offlineNotes: false, theme: 'light', vimMode: true });
    toggleTheme();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!)).toMatchObject({ offlineNotes: false, vimMode: true });
  });
});
