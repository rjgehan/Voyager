import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { httpEndpoints, installEndpoints } from '../api/endpoints';
import { createMockEndpoints } from '../api/mock';
import { MockVault } from '../api/mock/vault';
import { queryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import type { FileEntry } from '../api/types';
import { getCommand } from '../features/commands';
import { documents } from '../sync/instance';
import { setKanbanAsMarkdown } from '../views/kanban/detect';
import { newBoardText } from '../views/kanban/format';
import { registerBuiltins } from './builtins';

function entry(path: string): FileEntry {
  return { path, name: path, basename: path.replace(/\.md$/, ''), extension: 'md', kind: 'note', size: 1, mtime: '2026-10-16T10:00:00.000Z', version: 'v', aliases: [] };
}

const INSERTS = ['templates.insert', 'editor.insertAttachment', 'voice.record', 'voice.transcribe'];

afterEach(() => {
  setKanbanAsMarkdown('Board.md', false);
  queryClient.clear();
});

afterAll(() => installEndpoints(httpEndpoints));

describe('commands that write into the open note', () => {
  it('are not offered while the note shows as a Kanban board, whose text they would hide', async () => {
    registerBuiltins();
    const vault = new MockVault(false);
    vault.createFile({ path: 'Board.md', content: newBoardText() }, 'other-device-1');
    vault.createFile({ path: 'Plan.md', content: 'Plan' }, 'other-device-1');
    installEndpoints(createMockEndpoints(vault, { latency: 0, failures: [] }));
    queryClient.setQueryData(queryKeys.tree(), { eventId: 'b.1', folders: [], files: [entry('Board.md'), entry('Plan.md')] });
    const board = documents.acquire('Board.md', 'board-test');
    const plan = documents.acquire('Plan.md', 'board-test');
    await Promise.all([board.ready, plan.ready]);
    for (const id of INSERTS) {
      expect(getCommand(id)!.when!({ activePath: 'Board.md' }), id).toBe(false);
      expect(getCommand(id)!.when!({ activePath: 'Plan.md' }), id).toBe(true);
    }
    // "Kanban: Open as Markdown" shows the text in the editor: they work there.
    setKanbanAsMarkdown('Board.md', true);
    for (const id of INSERTS) expect(getCommand(id)!.when!({ activePath: 'Board.md' }), id).toBe(true);
    documents.release(board, 'board-test');
    documents.release(plan, 'board-test');
  });
});
