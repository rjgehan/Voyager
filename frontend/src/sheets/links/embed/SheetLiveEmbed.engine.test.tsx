// An embed edited before the formula engine is in (ROADMAP item 42, DESIGN §6.47): the engine chunk
// fails to load (an old tab after a deploy, offline), or the embed goes away before it arrives. The
// typed change must not be lost. The engine import is controlled here, so this is its own file.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { httpEndpoints, installEndpoints } from '../../../api/endpoints';
import { MockVault } from '../../../api/mock/vault';
import { queryClient } from '../../../api/queryClient';
import type { FileEntry } from '../../../api/types';
import { documents } from '../../../sync/instance';
import { fakeApi } from '../../../test/fakes';
import { clearSheetBindings } from '../../../views/sheet/useSheetDocument';
import { parseSheet } from '../../format';
import type { SheetEngine } from '../../loadEngine';
import { resetLinkStore } from '../store';
import SheetLiveEmbed from './SheetLiveEmbed';

/** Each test decides how the engine chunk answers. */
let answer: () => Promise<SheetEngine> = () => import('../../engine');
vi.mock('../../loadEngine', () => ({ loadSheetEngine: () => answer() }));

const BUDGET = {
  type: 'notesapp-sheet',
  version: 1,
  engine: 'hyperformula@3.5.0',
  sheets: [{ id: 's1', name: 'Budget', cells: { A1: { v: 'Rent' }, B1: { v: 10 }, B2: { f: '=B1*2', c: 20 } }, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } }],
  named: {},
};

const vault = new MockVault(false);
let count = 0;

beforeAll(() => {
  const fake = fakeApi(vault);
  installEndpoints({ ...httpEndpoints, readFile: fake.api.readFile, saveFile: fake.api.saveFile });
});

afterEach(() => {
  for (const s of documents.all()) documents.close(s);
  clearSheetBindings();
  queryClient.clear();
  resetLinkStore();
});

function newFile(): string {
  const path = `engine${++count}.sheet`;
  vault.createFile({ path, content: JSON.stringify(BUDGET) }, 'other-device-1');
  return path;
}

function entry(path: string): FileEntry {
  const f = vault.readFile(path);
  return { path, name: path, basename: path, extension: 'sheet', kind: 'text', size: f.content.length, mtime: '2026-10-17T10:00:00.000Z', version: f.version, aliases: [] };
}

function show(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SheetLiveEmbed path={path} entry={entry(path)} sourcePath="Note.md" depth={1} editable />
    </QueryClientProvider>,
  );
}

const cell = (container: HTMLElement, ref: string) => container.querySelector(`td[data-cell="${ref.charCodeAt(0) - 65}:${Number(ref.slice(1)) - 1}"]`) as HTMLElement;

function saved(path: string) {
  const p = parseSheet(vault.readFile(path).content);
  if (!p.ok) throw new Error(p.error);
  return p.file;
}

async function type42(container: HTMLElement) {
  await waitFor(() => expect(cell(container, 'B1').textContent).toBe('10'));
  fireEvent.doubleClick(cell(container, 'B1'));
  const input = screen.getByRole('textbox', { name: 'Cell' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '42' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('an embed edited before the formula engine is in', () => {
  it('keeps and saves the typed value when the engine chunk fails to load, and offers to try again', async () => {
    let fail!: (e: Error) => void;
    answer = () => new Promise((_, reject) => (fail = reject));
    const path = newFile();
    const { container } = show(path);
    await type42(container);
    await act(async () => fail(new Error('Failed to fetch dynamically imported module')));
    await waitFor(() => expect(screen.getByText(/read-only for now/)).toBeTruthy());
    expect(cell(container, 'B1').textContent).toBe('42');
    expect(documents.get(path)!.hasUnsavedChanges() || saved(path).sheets[0].cells.B1.v === 42).toBe(true);
    await waitFor(() => expect(saved(path).sheets[0].cells.B1.v).toBe(42), { timeout: 4000 });
    // Saved without the engine: the formula's value is worked out again when the engine is in.
    expect(saved(path).engine).toBe('');
    expect(saved(path).sheets[0].cells.B2.f).toBe('=B1*2');
    // Try again: the engine loads, and the grid can be edited.
    answer = () => import('../../engine');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(cell(container, 'B2').textContent).toBe('84'));
    expect(screen.queryByText(/read-only for now/)).toBeNull();
  });

  it('keeps the typed value when the embed goes away before the engine arrives', async () => {
    let arrive!: () => void;
    answer = () => new Promise((resolve) => (arrive = () => resolve(import('../../engine'))));
    const path = newFile();
    const view = show(path);
    await type42(view.container);
    view.unmount();
    expect(documents.get(path)!.hasUnsavedChanges()).toBe(true);
    await act(async () => arrive());
    await waitFor(() => expect(saved(path).sheets[0].cells.B1.v).toBe(42), { timeout: 4000 });
  });
});
