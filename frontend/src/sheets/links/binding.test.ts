// A spreadsheet open in its view (the binding of DocumentSession and Workbook, DESIGN §6.21.4) that
// reads notes (ROADMAP item 42): values follow the notes without saving the file on their own; the
// next edit saves them with it.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockVault } from '../../api/mock/vault';
import { formulaEngineForTests } from '../../formulas/load';
import { DocumentSession } from '../../sync/DocumentSession';
import { fakeApi, sessionDeps } from '../../test/fakes';
import { useTestLinkHost } from '../../test/linkHost';
import { clearSheetBindings, sheetBinding } from '../../views/sheet/useSheetDocument';
import { ENGINE_ID, type Workbook } from '../engine';
import { cellValue, parseSheet } from '../format';
import { resetLinkStore } from './store';

const SHEET = JSON.stringify({
  type: 'notesapp-sheet',
  version: 1,
  engine: ENGINE_ID,
  sheets: [{ id: 's1', name: 'Budget', cells: { A1: { f: '=NOTEPROP("Plan", "status")', c: 'active' }, A2: { v: 1 } }, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } }],
  named: {},
});

beforeAll(async () => {
  await formulaEngineForTests();
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  clearSheetBindings();
  resetLinkStore();
  vi.useRealTimers();
});

async function settle() {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(100);
}

describe('a spreadsheet that reads notes, in its view', () => {
  it('follows the note without saving, and saves the new values with the next edit', async () => {
    const notes = useTestLinkHost({ 'Plan.md': '---\nstatus: active\n---\n', 'b.sheet': SHEET });
    const vault = new MockVault(false);
    vault.createFile({ path: 'b.sheet', content: SHEET }, 'other-device-1');
    const fake = fakeApi(vault);
    const session = new DocumentSession('b.sheet', sessionDeps(fake.api));
    const binding = sheetBinding(session);
    const off = binding.subscribe(() => {});
    await settle();
    const doc = binding.getSnapshot();
    if (doc.kind !== 'ready') throw new Error(doc.kind);
    const wb: Workbook = doc.workbook;
    expect(cellValue(wb.cell('s1', 'A1'))).toBe('active');

    notes.edit('Plan.md', '---\nstatus: paused\n---\n');
    await settle();
    expect(cellValue(wb.cell('s1', 'A1'))).toBe('paused');
    await vi.advanceTimersByTimeAsync(3000);
    expect(session.getSnapshot().status).toBe('clean');
    expect(fake.api.saveFile).not.toHaveBeenCalled();

    wb.setCell('s1', 'A2', { v: 2 });
    await vi.advanceTimersByTimeAsync(3000);
    const saved = parseSheet(vault.readFile('b.sheet').content);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.file.sheets[0].cells.A1.c).toBe('paused');
    expect(saved.file.sheets[0].cells.A2.v).toBe(2);
    off();
  });
});
