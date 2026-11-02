// Device storage that names vault content is kept per vault (DESIGN §6.44): a folder filter, a
// canvas or a PDF of one vault means nothing in another, where the same path may be another file.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GRAPH_KEY, loadOptions, sanitizeOptions, saveOptions } from '../features/graph/options';
import { loadViewport, saveViewport } from '../views/canvas/savedView';
import { lastPage, rememberPage } from '../views/pdf/prefs';
import { setCurrentVaultForTests } from './vault';

beforeEach(() => localStorage.clear());

afterEach(() => {
  setCurrentVaultForTests(null);
  localStorage.clear();
});

describe('per-vault device storage', () => {
  it('keeps the graph’s options per vault', () => {
    saveOptions(GRAPH_KEY, { ...sanitizeOptions({}), folder: 'Projects' });
    setCurrentVaultForTests('work');
    expect(loadOptions(GRAPH_KEY, sanitizeOptions).folder).toBe('');
    saveOptions(GRAPH_KEY, { ...sanitizeOptions({}), folder: 'Clients' });
    expect(loadOptions(GRAPH_KEY, sanitizeOptions).folder).toBe('Clients');
    setCurrentVaultForTests(null);
    expect(loadOptions(GRAPH_KEY, sanitizeOptions).folder).toBe('Projects');
    // The default vault keeps the key it always had.
    expect(JSON.parse(localStorage.getItem('notesapp:graph')!).folder).toBe('Projects');
  });

  it('keeps where a canvas was looked at per vault', () => {
    saveViewport('Board.canvas', { x: 0, y: 0, zoom: 2 }, { width: 800, height: 600 });
    setCurrentVaultForTests('work');
    expect(loadViewport('Board.canvas')).toBeUndefined();
    saveViewport('Board.canvas', { x: 0, y: 0, zoom: 0.5 }, { width: 800, height: 600 });
    expect(loadViewport('Board.canvas')?.zoom).toBe(0.5);
    setCurrentVaultForTests(null);
    expect(loadViewport('Board.canvas')?.zoom).toBe(2);
  });

  it('keeps the last page of a PDF per vault', () => {
    rememberPage('Papers/a.pdf', 7);
    setCurrentVaultForTests('work');
    expect(lastPage('Papers/a.pdf')).toBeNull();
    rememberPage('Papers/a.pdf', 2);
    setCurrentVaultForTests(null);
    expect(lastPage('Papers/a.pdf')).toBe(7);
  });
});
