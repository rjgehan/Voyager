// Spreadsheets embedded in notes and edited in place (ROADMAP item 42), with the real session,
// binding and engine over the mock vault: the grid from cached values, editing cells (keys,
// double-click, typing over, pointing at cells in a formula), undo, read-only embeds, ranges,
// sheets and charts, and a spreadsheet that reads notes.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { httpEndpoints, installEndpoints } from '../../../api/endpoints';
import { MockVault } from '../../../api/mock/vault';
import { queryClient } from '../../../api/queryClient';
import type { FileEntry } from '../../../api/types';
import { formulaEngineForTests } from '../../../formulas/load';
import { documents } from '../../../sync/instance';
import { fakeApi } from '../../../test/fakes';
import { axeViolations } from '../../../test/axe';
import { useTestLinkHost } from '../../../test/linkHost';
import { clearSheetBindings } from '../../../views/sheet/useSheetDocument';
import { sheetClip, setSheetClip } from '../../clipboard';
import { copyRange } from '../../edits';
import { parseSheet } from '../../format';
import { loadSheetEngine } from '../../loadEngine';
import { useToasts } from '../../../state/toasts';
import { resetLinkStore } from '../store';
import SheetLiveEmbed from './SheetLiveEmbed';

const BUDGET = {
  type: 'notesapp-sheet',
  version: 1,
  engine: 'hyperformula@3.5.0+1',
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

  it('refuses a value a strict dropdown does not take, as the spreadsheet view does', async () => {
    const sheets = [{ ...BUDGET.sheets[0], validation: { v1: { range: 'A2:A20', type: 'list', values: ['Rent', 'Food', 'Gym'], strict: true } } }, BUDGET.sheets[1]];
    const path = newFile({ ...BUDGET, version: 2, sheets });
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'A3').textContent).toBe('Food'));
    fireEvent.doubleClick(cell(container, 'A3'));
    const input = screen.getByRole('textbox', { name: 'Cell' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'maybe' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(useToasts.getState().toasts.map((t) => t.message)).toContain('“maybe” is not one of the values A3 takes.'));
    // The editor stays open on the refused text, and nothing is written.
    expect(input.hidden).toBe(false);
    expect(input.value).toBe('maybe');
    expect(cell(container, 'A3').textContent).toBe('Food');
    fireEvent.change(input, { target: { value: 'Gym' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(saved(path).A3.v).toBe('Gym'), { timeout: 4000 });
  });

  it('keeps the sheet picked in a whole-file embed through a rename, and falls back to the first when it is deleted', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'B2').textContent).toBe('$1,450.00'));
    const picker = screen.getByRole('combobox', { name: 'Sheet' }) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 's2' } });
    await waitFor(() => expect(cell(container, 'A1').textContent).toBe('Q1'));
    const remote = async (next: typeof BUDGET) => {
      vault.externalWrite(path, JSON.stringify(next));
      await act(async () => {
        await documents.get(path)!.onRemoteChanged({ version: vault.readFile(path).version });
      });
    };
    // Another device renames Summary (its id stays).
    const renamed = structuredClone(BUDGET);
    renamed.sheets[1].name = 'Totals';
    await remote(renamed);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Totals' })).toBeTruthy());
    expect(cell(container, 'A1').textContent).toBe('Q1');
    expect(picker.value).toBe('s2');
    expect(container.textContent).not.toContain('is not a sheet');
    // Then deletes it: the embed shows the first sheet.
    const deleted = structuredClone(BUDGET);
    deleted.sheets[0].name = 'Budget';
    deleted.sheets.splice(1, 1);
    await remote(deleted);
    await waitFor(() => expect(cell(container, 'A1').textContent).toBe('Item'));
    expect(container.textContent).not.toContain('is not a sheet');
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

  it('does not serialize the workbook to draw itself once it has been edited', async () => {
    const engine = await loadSheetEngine();
    const spy = vi.spyOn(engine.Workbook.prototype, 'serialize');
    try {
      const path = newFile();
      const { container } = show(path);
      await waitFor(() => expect(cell(container, 'B3').textContent).toBe('300'));
      fireEvent.doubleClick(cell(container, 'B3'));
      const input = screen.getByRole('textbox', { name: 'Cell' }) as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: '500' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(cell(container, 'B4').textContent).toBe('1950'));
      await waitFor(() => expect(saved(path).B3.v).toBe(500), { timeout: 4000 });
      await waitFor(() => expect(documents.get(path)!.currentStatus).toBe('clean'));
      // A second edit: drawing it serializes nothing (only the save and the draft do, later).
      fireEvent.doubleClick(cell(container, 'B2'));
      fireEvent.change(input, { target: { value: '1500' } });
      spy.mockClear();
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(cell(container, 'B4').textContent).toBe('2000');
      expect(spy).not.toHaveBeenCalled();
      await waitFor(() => expect(saved(path).B2.v).toBe(1500), { timeout: 4000 });
      await waitFor(() => expect(documents.get(path)!.currentStatus).toBe('clean'));
      expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('is a grid to assistive technology, with its selected and active cells, and passes axe', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'B2').textContent).toBe('$1,450.00'));
    const table = container.querySelector('table.sheet-live-table.is-editable')!;
    expect(table.getAttribute('role')).toBe('grid');
    expect(table.getAttribute('aria-multiselectable')).toBe('true');
    fireEvent.mouseDown(cell(container, 'B3'));
    fireEvent.mouseDown(cell(container, 'B4'), { shiftKey: true });
    expect(cell(container, 'B3').getAttribute('aria-selected')).toBe('true');
    expect(cell(container, 'A3').getAttribute('aria-selected')).toBe('false');
    expect(table.getAttribute('aria-activedescendant')).toBe(container.querySelector('td.is-active')!.id);
    fireEvent.mouseDown(cell(container, 'A2'));
    expect(table.getAttribute('aria-activedescendant')).toBe(cell(container, 'A2').id);
    expect((await axeViolations(container)).filter((l) => !l.startsWith('color-contrast'))).toEqual([]);
  });

  it('shares its copies with the spreadsheet view: formulas both ways, and a newer copy there wins', async () => {
    const path = newFile();
    const { container } = show(path);
    await waitFor(() => expect(cell(container, 'B4').textContent).toBe('1750'));
    const table = container.querySelector('table')!;
    const data = new Map<string, string>();
    const clipboardData = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '' };
    // A copy here is the view's to paste too.
    fireEvent.mouseDown(cell(container, 'B4'));
    fireEvent.copy(table, { clipboardData });
    expect(sheetClip()?.cells).toEqual([[{ f: '=SUM(B2:B3)' }]]);
    // A copy in the view (C4 of the same sheet, its text '1750' too) is pasted here as that copy.
    const parsed = parseSheet(JSON.stringify(BUDGET));
    if (!parsed.ok) throw new Error(parsed.error);
    setSheetClip(copyRange({ ...parsed.file.sheets[0], cells: { ...parsed.file.sheets[0].cells, C4: { v: 1750 } } }, { col: 2, row: 3, width: 1, height: 1 }));
    fireEvent.mouseDown(cell(container, 'C1'));
    fireEvent.paste(table, { clipboardData });
    await waitFor(() => expect(cell(container, 'C1').textContent).toBe('1750'));
    // The view's copy of a formula keeps it here.
    setSheetClip(copyRange(parsed.file.sheets[0], { col: 1, row: 3, width: 1, height: 1 }));
    fireEvent.mouseDown(cell(container, 'C4'));
    fireEvent.paste(table, { clipboardData });
    await waitFor(() => expect(saved(path).C4?.f).toBe('=SUM(C2:C3)'), { timeout: 4000 });
    expect(saved(path).C1.v).toBe(1750);
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
