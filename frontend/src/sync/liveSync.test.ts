import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import { useUi } from '../state/ui';
import { resetWorkspace } from '../workspace/store';
import { applyEvent } from './applyEvents';
import { syncTarget } from './liveSync';

beforeEach(() => {
  queryClient.setQueryData(queryKeys.tree(), { eventId: 'b.1', folders: [], files: [] });
  resetWorkspace();
  useUi.getState().setDrawerOpen(true);
});

afterEach(() => {
  useUi.getState().setDrawerOpen(false);
  resetWorkspace();
  queryClient.clear();
});

describe('a move of the open note', () => {
  it('keeps the phone drawer open and the heading anchor when the folder moves', () => {
    window.history.replaceState(null, '', '/n/A/note.md?x=1#Heading');
    const before = window.history.length;
    applyEvent(syncTarget, 'entry.moved', { from: 'A', to: 'B', type: 'folder' });
    expect(window.location.pathname).toBe('/n/B/note.md');
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#Heading');
    expect(window.history.length).toBe(before);
    expect(useUi.getState().drawerOpen).toBe(true);
  });

  it('keeps the drawer open when the note itself is renamed', () => {
    window.history.replaceState(null, '', '/n/A/note.md');
    applyEvent(syncTarget, 'entry.moved', { from: 'A/note.md', to: 'A/renamed.md', type: 'file' });
    expect(window.location.pathname).toBe('/n/A/renamed.md');
    expect(useUi.getState().drawerOpen).toBe(true);
  });
});
