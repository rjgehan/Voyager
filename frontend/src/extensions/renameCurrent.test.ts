// F2 / "Rename current file" with split panes (DESIGN §6.40): the active pane's title, never the
// first one in the page.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryClient } from '../api/queryClient';
import { queryKeys } from '../api/queryKeys';
import type { FileEntry } from '../api/types';
import { runCommand } from '../features/commands';
import { useDialogs } from '../state/dialogs';
import { registerBuiltins } from './builtins';

const entry = (path: string): FileEntry => ({ path, name: path, basename: path.replace(/\.md$/, ''), extension: 'md', kind: 'note', size: 1, mtime: '2026-11-01T10:00:00.000Z', version: 'v', aliases: [] });

function pane(active: boolean, title: string | null): HTMLElement {
  const scroll = document.createElement('div');
  scroll.className = 'workspace-scroll';
  if (active) scroll.id = 'workspace-scroll';
  if (title !== null) {
    const input = document.createElement('textarea');
    input.className = 'inline-title-input';
    input.value = title;
    scroll.append(input);
  }
  document.body.append(scroll);
  return scroll;
}

beforeEach(() => {
  registerBuiltins();
  queryClient.setQueryData(queryKeys.tree(), { eventId: 'e', folders: [], files: [entry('A.md'), entry('B.md'), entry('Photo.md')] });
});

afterEach(() => {
  document.body.innerHTML = '';
  queryClient.clear();
  useDialogs.setState({ stack: [] });
});

describe('Rename current file with two panes', () => {
  it('focuses the active (right) pane’s title, not the first pane’s', () => {
    pane(false, 'A');
    pane(true, 'B');
    runCommand('file.rename', { activePath: 'B.md' });
    const focused = document.activeElement as HTMLTextAreaElement;
    expect(focused.className).toBe('inline-title-input');
    expect(focused.value).toBe('B');
  });

  it('asks for the name when the active pane shows no title, even though another pane does', () => {
    const other = pane(false, 'A');
    pane(true, null);
    runCommand('file.rename', { activePath: 'Photo.md' });
    expect(document.activeElement).not.toBe(other.querySelector('textarea'));
    expect(useDialogs.getState().stack).toEqual([expect.objectContaining({ kind: 'prompt', value: 'Photo' })]);
  });
});
