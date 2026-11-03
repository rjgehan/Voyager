// The active editor follows the active pane (DESIGN §6.40): palette commands and Mod-; act on the
// note of the pane the user is in, never on another pane's note.
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MockVault } from '../api/mock/vault';
import { queryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import { DocumentSession } from '../sync/DocumentSession';
import { fakeApi, sessionDeps } from '../test/fakes';
import { PaneContext } from '../workspace/PaneContext';
import { activeEditor } from './activeEditor';
import { gridOf } from './livePreview/table/grid';
import { NoteEditor } from './NoteEditor';

const sessions: DocumentSession[] = [];

afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
  queryClient.clear();
});

async function loaded(path: string, content: string): Promise<DocumentSession> {
  const vault = new MockVault(false);
  vault.createFile({ path, content }, 'other-device-1');
  queryClient.setQueryData(queryKeys.tree(), vault.getTree());
  const session = new DocumentSession(path, sessionDeps(fakeApi(vault).api));
  sessions.push(session);
  await session.whenSettled();
  return session;
}

function pane(session: DocumentSession, active: boolean) {
  return (
    <QueryClientProvider client={queryClient}>
      <PaneContext.Provider value={{ paneId: 'p1', active }}>
        <NoteEditor session={session} readOnly={false} preview="live" />
      </PaneContext.Provider>
    </QueryClientProvider>
  );
}

describe('NoteEditor and the active pane', () => {
  it('stops being the active editor when its pane is no longer the active one', async () => {
    const session = await loaded('A.md', 'hello\n');
    const { container, rerender } = render(pane(session, true));
    const view = activeEditor();
    expect(view?.dom).toBe(container.querySelector('.cm-editor'));
    // A click in another pane showing a board, a sheet or a PDF (no editor of its own).
    rerender(pane(session, false));
    expect(activeEditor()).toBeNull();
    rerender(pane(session, true));
    expect(activeEditor()).toBe(view);
  });

  it('a table cell being edited in that pane stops being the active editor too', async () => {
    const session = await loaded('T.md', '| a | b |\n|---|---|\n| c | d |\n');
    const { container, rerender } = render(pane(session, true));
    const grid = gridOf(container.querySelector('.cm-lp-table')!)!;
    grid.activate(1, 0);
    expect(activeEditor()).toBe(grid.activeCell()!.editor);
    rerender(pane(session, false));
    expect(activeEditor()).toBeNull();
  });
});
