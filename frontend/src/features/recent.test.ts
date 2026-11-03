import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setCurrentVaultForTests } from '../state/vault';
import { clearRecent, forgetRecent, lastOpenedPath, MAX_RECENT, presentRecent, recentEntries, recentPaths, recordOpened, removeRecent, renameRecent, subscribeRecent, useRecentEntries } from './recent';

describe('recent files', () => {
  it('records opened files newest first, with when they were opened', () => {
    recordOpened('A.md', 1000);
    recordOpened('B.md', 2000);
    recordOpened('A.md', 3000);
    expect(recentEntries()).toEqual([
      { path: 'A.md', at: 3000 },
      { path: 'B.md', at: 2000 },
    ]);
    expect(recentPaths()).toEqual(['A.md', 'B.md']);
    expect(lastOpenedPath()).toBe('A.md');
  });

  it('keeps at most 50 files', () => {
    for (let i = 0; i < MAX_RECENT + 5; i++) recordOpened(`N${i}.md`, i);
    expect(recentPaths()).toHaveLength(MAX_RECENT);
    expect(recentPaths()[0]).toBe(`N${MAX_RECENT + 4}.md`);
  });

  it('moves the first format (paths only) to the new key', () => {
    localStorage.setItem('notesapp:recent', JSON.stringify(['Old.md', 'Older.md', 'Old.md', 7]));
    expect(recentEntries()).toEqual([
      { path: 'Old.md', at: 0 },
      { path: 'Older.md', at: 0 },
    ]);
    expect(localStorage.getItem('notesapp:recent')).toBeNull();
    expect(JSON.parse(localStorage.getItem('notesapp:recentFiles')!)).toHaveLength(2);
  });

  it('follows renames and folder moves, and drops deleted files and folders', () => {
    recordOpened('Folder/A.md', 1);
    recordOpened('Folder/Sub/B.md', 2);
    recordOpened('C.md', 3);
    renameRecent('Folder', 'Moved');
    expect(recentPaths()).toEqual(['C.md', 'Moved/Sub/B.md', 'Moved/A.md']);
    renameRecent('C.md', 'D.md');
    expect(recentPaths()[0]).toBe('D.md');
    expect(lastOpenedPath()).toBe('D.md');
    forgetRecent('Moved');
    expect(recentPaths()).toEqual(['D.md']);
  });

  it('keeps the last opened note when its folder is renamed, so the start page still opens it', () => {
    recordOpened('Projects/Plan.md', 1);
    renameRecent('Projects', 'Work');
    expect(lastOpenedPath()).toBe('Work/Plan.md');
    recordOpened('A/B/C.md', 2);
    renameRecent('A', 'Z');
    expect(lastOpenedPath()).toBe('Z/B/C.md');
    recordOpened('Projects2/N.md', 3);
    renameRecent('Projects', 'Elsewhere');
    expect(lastOpenedPath()).toBe('Projects2/N.md');
  });

  it('removes one entry, or clears the list', () => {
    recordOpened('A.md', 1);
    recordOpened('A.md/x', 2);
    removeRecent('A.md');
    expect(recentPaths()).toEqual(['A.md/x']);
    clearRecent();
    expect(recentPaths()).toEqual([]);
  });

  it('notifies subscribers and re-renders the hook', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecent(listener);
    const { result } = renderHook(() => useRecentEntries());
    expect(result.current).toEqual([]);
    act(() => recordOpened('A.md', 5));
    expect(listener).toHaveBeenCalled();
    expect(result.current).toEqual([{ path: 'A.md', at: 5 }]);
    unsubscribe();
  });

  it("follows another tab's changes in an extra vault (its own storage key)", () => {
    setCurrentVaultForTests('work');
    try {
      const { result } = renderHook(() => useRecentEntries());
      expect(result.current).toEqual([]);
      // Another tab of the same vault opened a note.
      const text = JSON.stringify([{ path: 'Plan.md', at: 9 }]);
      localStorage.setItem('notesapp:recentFiles@work', text);
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: 'notesapp:recentFiles@work', newValue: text }));
      });
      expect(result.current).toEqual([{ path: 'Plan.md', at: 9 }]);
    } finally {
      setCurrentVaultForTests(null);
    }
  });

  it('leaves out files no longer in the vault', () => {
    const tree = { byPath: new Set(['A.md']) };
    expect(presentRecent([{ path: 'A.md', at: 1 }, { path: 'Gone.md', at: 2 }], tree)).toEqual([{ path: 'A.md', at: 1 }]);
    expect(presentRecent([{ path: 'A.md', at: 1 }], undefined)).toEqual([]);
  });
});
