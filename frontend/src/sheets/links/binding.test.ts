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
import { linkStore, resetLinkStore } from './store';

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

describe('a spreadsheet that notes read, opened and left on this device', () => {
  const budget = (v: number) =>
    JSON.stringify({
      type: 'notesapp-sheet',
      version: 1,
      engine: ENGINE_ID,
      sheets: [{ id: 's1', name: 'Budget', cells: { A2: { v } }, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } }],
      named: {},
    });
  /** What a note's formula reads of the spreadsheet: its A2. */
  const noteReads = () => {
    const file = linkStore().sheet('Budget.sheet').value;
    return file ? cellValue(file.sheets[0].cells.A2) : null;
  };

  it('follows another device’s save while its view is away (its binding still cached)', async () => {
    const host = useTestLinkHost({ 'Budget.sheet': budget(1), 'Dashboard.md': '' });
    const vault = new MockVault(false);
    vault.createFile({ path: 'Budget.sheet', content: budget(1) }, 'other-device-1');
    const session = new DocumentSession('Budget.sheet', sessionDeps(fakeApi(vault).api));
    const binding = sheetBinding(session);
    const off = binding.subscribe(() => {});
    await settle();
    expect(binding.getSnapshot().kind).toBe('ready');
    expect(noteReads()).toBe(1);
    // The view leaves; the binding stays cached.
    off();
    // The iPhone saves A2 = 2.
    vault.externalWrite('Budget.sheet', budget(2));
    host.edit('Budget.sheet', budget(2));
    await session.onRemoteChanged({ version: vault.readFile('Budget.sheet').version });
    await settle();
    expect(noteReads()).toBe(2);
    // Coming back keeps the same workbook (and its undo history).
    const workbookOf = () => {
      const doc = binding.getSnapshot();
      return doc.kind === 'ready' ? doc.workbook : null;
    };
    const before = workbookOf();
    const again = binding.subscribe(() => {});
    expect(workbookOf()).toBe(before);
    expect(cellValue(before!.cell('s1', 'A2'))).toBe(2);
    again();
  });

  it('falls back to the saved file, not the values from before it was opened, when its binding goes', async () => {
    const host = useTestLinkHost({ 'Budget.sheet': budget(1), 'Dashboard.md': '' });
    const vault = new MockVault(false);
    vault.createFile({ path: 'Budget.sheet', content: budget(1) }, 'other-device-1');
    // A note read the spreadsheet before it was opened.
    expect(noteReads()).toBe(null);
    await settle();
    expect(noteReads()).toBe(1);
    const session = new DocumentSession('Budget.sheet', sessionDeps(fakeApi(vault).api));
    const binding = sheetBinding(session);
    const off = binding.subscribe(() => {});
    await settle();
    const doc = binding.getSnapshot();
    if (doc.kind !== 'ready') throw new Error(doc.kind);
    doc.workbook.setCell('s1', 'A2', { v: 2 });
    await vi.advanceTimersByTimeAsync(3000);
    host.edit('Budget.sheet', vault.readFile('Budget.sheet').content);
    await settle();
    expect(noteReads()).toBe(2);
    off();
    clearSheetBindings();
    await settle();
    expect(noteReads()).toBe(2);
  });
});
