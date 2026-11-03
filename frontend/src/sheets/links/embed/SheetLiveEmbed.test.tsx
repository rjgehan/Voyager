// Spreadsheets embedded in notes and edited in place (ROADMAP item 42), with the real session,
// binding and engine over the mock vault: the grid from cached values, editing cells (keys,
// double-click, typing over, pointing at cells in a formula), undo, read-only embeds, ranges,
// sheets and charts, and a spreadsheet that reads notes.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { httpEndpoints, installEndpoints } from '../../../api/endpoints';
import { MockVault } from '../../../api/mock/vault';
import { queryClient } from '../../../api/queryClient';
import type { FileEntry } from '../../../api/types';
import { formulaEngineForTests } from '../../../formulas/load';
import { documents } from '../../../sync/instance';
import { fakeApi } from '../../../test/fakes';
import { useTestLinkHost } from '../../../test/linkHost';
import { clearSheetBindings } from '../../../views/sheet/useSheetDocument';
import { parseSheet } from '../../format';
import { loadSheetEngine } from '../../loadEngine';
import { resetLinkStore } from '../store';
import SheetLiveEmbed from './SheetLiveEmbed';

const BUDGET = {
  type: 'notesapp-sheet',
  version: 1,
  engine: 'hyperformula@3.5.0',
  sheets: [
    {
      id: 's1',
      name: 'Budget',
      cells: {
        A1: { v: 'Item' },
        B1: { v: 'Cost' },
        A2: { v: 'Rent' },
        B2: { v: 1450, fmt: '$#,##0.00' },
        A3: { v: 'Food' },
        B3: { v: 300 },
        B4: { f: '=SUM(B2:B3)', c: 1750 },
      },
      cols: {},
      rows: { '1': { bold: true } },
      frozen: { rows: 0, cols: 0 },
      charts: { c0abc: { type: 'bar', range: 'A1:B3', title: 'Costs', headers: true, labels: true } },
    },
    { id: 's2', name: 'Summary', cells: { A1: { v: 'Q1' } }, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } },
  ],
  named: {},
};

const vault = new MockVault(false);
let count = 0;

beforeAll(async () => {
  await loadSheetEngine();
  await formulaEngineForTests();
}, 30_000);

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

function newFile(content: unknown = BUDGET): string {
  const path = `embed${++count}.sheet`;
  vault.createFile({ path, content: typeof content === 'string' ? content : JSON.stringify(content) }, 'other-device-1');
  return path;
}

function entry(path: string): FileEntry {
  const f = vault.readFile(path);
  return { path, name: path, basename: path, extension: 'sheet', kind: 'text', size: f.content.length, mtime: '2026-10-17T10:00:00.000Z', version: f.version, aliases: [] };
}

function show(path: string, opts: { subpath?: string; editable?: boolean } = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <SheetLiveEmbed path={path} entry={entry(path)} subpath={opts.subpath} sourcePath="Note.md" depth={1} editable={opts.editable ?? true} />
    </QueryClientProvider>,
  );
}

const cell = (container: HTMLElement, ref: string) => {
  const m = /^([A-Z])(\d+)$/.exec(ref)!;
  return container.querySelector(`td[data-cell="${m[1].charCodeAt(0) - 65}:${Number(m[2]) - 1}"]`) as HTMLElement;
};

function saved(path: string) {
  const p = parseSheet(vault.readFile(path).content);
  if (!p.ok) throw new Error(p.error);
  return p.file.sheets[0].cells;
}

describe('a spreadsheet embedded in a note that can be written', () => {
  it('shows the grid from the cached values, with headers, a toolbar and Open full sheet', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'B2').textContent).toBe('$1,450.00'));
    expect(cell(container, 'B4').textContent).toBe('1750');
    expect([...container.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual(['', 'A', 'B', 'C']);
    expect(screen.getByRole('toolbar', { name: 'Spreadsheet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open full sheet' })).toBeTruthy();
    // A row and a column to grow into.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5);
  });

  it('shows conditional formatting as the grid and the read-only embed do (format version 2)', async () => {
    const sheets = [{ ...BUDGET.sheets[0], conditional: { r1: { range: 'B2:B4', when: 'gt', value: '1000', bg: '#b7e1cd', bold: true } } }, BUDGET.sheets[1]];
    const path = newFile({ ...BUDGET, version: 2, sheets });
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'B2').textContent).toBe('$1,450.00'));
    expect(cell(container, 'B2').style.background).toBe('rgb(183, 225, 205)');
    expect(cell(container, 'B2').style.fontWeight).toBe('700');
    expect(cell(container, 'B4').style.background).toBe('rgb(183, 225, 205)');
    // 300 is not over 1000.
    expect(cell(container, 'B3').getAttribute('style')).toBeNull();
  });

  it('edits a cell in place: the value is saved and the total recalculated', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'B3').textContent).toBe('300'));
    fireEvent.doubleClick(cell(container, 'B3'));
    const input = screen.getByRole('textbox', { name: 'Cell' }) as HTMLInputElement;
    expect(input.hidden).toBe(false);
    expect(input.value).toBe('300');
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(cell(container, 'B4').textContent).toBe('1950'));
    expect(input.hidden).toBe(true);
    // Enter moved to the next row.
    expect(cell(container, 'B4').classList.contains('is-active')).toBe(true);
    await waitFor(() => expect(saved(path).B3.v).toBe(500), { timeout: 4000 });
    expect(saved(path).B4.c).toBe(1950);
  });

  it('writes nothing when a cell is opened and left untouched, even after another device changed it', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'B3').textContent).toBe('300'));
    // Just looking at B3's contents.
    fireEvent.doubleClick(cell(container, 'B3'));
    const input = screen.getByRole('textbox', { name: 'Cell' }) as HTMLInputElement;
    expect(input.value).toBe('300');
    // Another device sets B3 to 999 meanwhile.
    const next = structuredClone(BUDGET);
    next.sheets[0].cells.B3 = { v: 999 };
    (next.sheets[0].cells as Record<string, unknown>).B4 = { f: '=SUM(B2:B3)', c: 2449 };
    vault.externalWrite(path, JSON.stringify(next));
    await act(async () => {
      await documents.get(path)!.onRemoteChanged({ version: vault.readFile(path).version });
    });
    await waitFor(() => expect(cell(container, 'B3').textContent).toBe('999'));
    fireEvent.blur(input);
    // A real edit elsewhere, so the session saves.
    fireEvent.doubleClick(cell(container, 'A3'));
    fireEvent.change(input, { target: { value: 'Groceries' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(saved(path).A3.v).toBe('Groceries'), { timeout: 4000 });
    expect(saved(path).B3.v).toBe(999);
    // Enter on an untouched cell moves on and writes nothing either.
    fireEvent.doubleClick(cell(container, 'B2'));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(cell(container, 'B3').classList.contains('is-active')).toBe(true);
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    fireEvent.click(undo);
    await waitFor(() => expect(cell(container, 'A3').textContent).toBe('Food'));
  });

  it('keeps a cell’s line breaks: leaving it untouched writes nothing, and an edit keeps them', async () => {
    const content = structuredClone(BUDGET);
    (content.sheets[0].cells as Record<string, unknown>).A2 = { v: '12 Main St\nSpringfield' };
    const path = newFile(content);
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'B3').textContent).toBe('300'));
    fireEvent.doubleClick(cell(container, 'A2'));
    const input = screen.getByRole('textbox', { name: 'Cell' }) as HTMLTextAreaElement;
    expect(input.value).toBe('12 Main St\nSpringfield');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.doubleClick(cell(container, 'A3'));
    fireEvent.change(input, { target: { value: 'Groceries' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(saved(path).A3.v).toBe('Groceries'), { timeout: 4000 });
    expect(saved(path).A2.v).toBe('12 Main St\nSpringfield');
    fireEvent.doubleClick(cell(container, 'A2'));
    fireEvent.change(input, { target: { value: input.value + '!' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await waitFor(() => expect(saved(path).A2.v).toBe('12 Main St\nSpringfield!'), { timeout: 4000 });
    // Alt+Enter adds a line break instead of committing.
    fireEvent.doubleClick(cell(container, 'A3'));
    fireEvent.keyDown(input, { key: 'Enter', altKey: true });
    expect(input.value).toBe('Groceries\n');
    expect(input.hidden).toBe(false);
  });

  it('types over a selected cell, cancels with Escape, and undoes from the toolbar', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'A3').textContent).toBe('Food'));
    fireEvent.mouseDown(cell(container, 'A3'));
    const table = container.querySelector('table')!;
    fireEvent.keyDown(table, { key: 'x' });
    const input = screen.getByRole('textbox', { name: 'Cell' }) as HTMLInputElement;
    expect(input.value).toBe('x');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.hidden).toBe(true);
    expect(cell(container, 'A3').textContent).toBe('Food');
    fireEvent.keyDown(table, { key: 'F2' });
    fireEvent.change(input, { target: { value: 'Fun' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await waitFor(() => expect(cell(container, 'A3').textContent).toBe('Fun'));
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    await waitFor(() => expect(undo.disabled).toBe(false));
    fireEvent.click(undo);
    expect(cell(container, 'A3').textContent).toBe('Food');
  });

  it('puts the reference of a cell pointed at into a formula being typed', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'C2')).toBeTruthy());
    fireEvent.doubleClick(cell(container, 'C2'));
    const input = screen.getByRole('textbox', { name: 'Cell' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '=' } });
    input.setSelectionRange(1, 1);
    fireEvent.mouseDown(cell(container, 'B2'));
    expect(input.value).toBe('=B2');
    expect(cell(container, 'B2').classList.contains('is-picked')).toBe(true);
    fireEvent.change(input, { target: { value: '=B2*2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Arithmetic on one amount shows as an amount (DESIGN §6.21.8).
    await waitFor(() => expect(cell(container, 'C2').textContent).toBe('$2,900.00'));
  });

  it('clears the selection with Delete and fills down with Mod-D', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'B2').textContent).toBe('$1,450.00'));
    const table = container.querySelector('table')!;
    fireEvent.mouseDown(cell(container, 'B2'));
    fireEvent.mouseDown(cell(container, 'B3'), { shiftKey: true });
    fireEvent.keyDown(table, { key: 'd', ctrlKey: true });
    await waitFor(() => expect(cell(container, 'B3').textContent).toBe('$1,450.00'));
    fireEvent.keyDown(table, { key: 'Delete' });
    await waitFor(() => expect(cell(container, 'B2').textContent).toBe(''));
    expect(cell(container, 'B4').textContent).toBe('0');
  });

  it('shows a named sheet or a range only, and switches sheets in a whole-file embed', async () => {
    const path = newFile();
    const range = show(path, { subpath: 'Budget!A2:B3' });
    await waitFor(() => expect(range.container.querySelectorAll('tbody tr')).toHaveLength(2));
    expect([...range.container.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual(['', 'A', 'B']);
    range.unmount();
    const whole = show(path);
    await waitFor(() => expect(cell(whole.container, 'A1').textContent).toBe('Item'));
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Sheet' }), { target: { value: 's2' } });
    });
    expect(cell(whole.container, 'A1').textContent).toBe('Q1');
  });

  it('shows its charts below a whole sheet', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(container.querySelector('.sheet-embed-charts svg')).toBeTruthy());
  });
});

describe('read-only and chart embeds', () => {
  it('is item 6b’s table in a note that cannot be written', async () => {
    const path = newFile();
    const { container } = show(path, { editable: false });
    await waitFor(() => expect(container.querySelector('.sheet-embed-table')).toBeTruthy());
    expect(container.querySelector('.sheet-live-toolbar')).toBeNull();
    expect(container.querySelector('thead')).toBeNull();
  });

  it('shows one chart by its title, or says it has none', async () => {
    const path = newFile();
    const one = show(path, { subpath: 'chart:costs' });
    await waitFor(() => expect(one.container.querySelector('svg')).toBeTruthy());
    expect(one.container.querySelector('table')).toBeNull();
    one.unmount();
    const none = show(path, { subpath: 'chart:Nope' });
    await waitFor(() => expect(none.container.textContent).toContain('This spreadsheet has no chart “Nope”.'));
  });

  it('computes a read-only spreadsheet that reads notes, live', async () => {
    useTestLinkHost({ 'Plan.md': '---\nstatus: active\n---\n' });
    const path = newFile({ ...BUDGET, sheets: [{ ...BUDGET.sheets[0], cells: { A1: { f: '=NOTEPROP("Plan", "status")', c: 'old' } } }] });
    const { container } = show(path, { editable: false });
    await waitFor(() => expect(container.querySelector('td')?.textContent).toBe('active'), { timeout: 3000 });
    expect(container.querySelector('thead')).toBeNull();
  });
});
