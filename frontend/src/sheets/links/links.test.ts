// Notes ↔ sheets (ROADMAP item 42): spreadsheets reading notes (NOTEPROP, NOTETABLE, NOTECOUNT,
// NOTEQUERY), notes reading spreadsheets (`Budget.sheet!B10`), live updates and cycles, with the real
// engines over a link store whose host is files in memory.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { computeNote } from '../../formulas/engine';
import { formulaEngineForTests } from '../../formulas/load';
import { useTestLinkHost, type TestLinkHost } from '../../test/linkHost';
import { Workbook, type WorkbookChange } from '../engine';
import { cellValue, parseSheet, type SheetCell } from '../format';
import { noteFormulas } from './noteText';
import { linkWorkbook, workbookContext } from './recalc';
import { linkContext, linkStore, resetLinkStore } from './store';

beforeAll(async () => {
  await formulaEngineForTests();
});

afterEach(() => resetLinkStore());

function sheetText(cells: Record<string, SheetCell>, opts: { named?: Record<string, string>; more?: Array<{ name: string; cells: Record<string, SheetCell> }> } = {}): string {
  const sheets = [{ id: 's1', name: 'Budget', cells }, ...(opts.more ?? []).map((s, i) => ({ id: `s${i + 2}`, ...s }))];
  return JSON.stringify({ type: 'notesapp-sheet', version: 1, engine: '', sheets: sheets.map((s) => ({ ...s, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } })), named: opts.named ?? {} });
}

/** Lets loads finish and notifications run until nothing moves. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await linkStore().settled();
    await new Promise((r) => setTimeout(r, 0));
    linkStore().flush();
  }
}

function openWorkbook(host: TestLinkHost, path: string): { wb: Workbook; changes: WorkbookChange[]; value(ref: string, sheet?: string): unknown; off(): void } {
  const parsed = parseSheet(host.files.get(path)!);
  if (!parsed.ok) throw new Error(parsed.error);
  const context = workbookContext(() => path);
  const wb = Workbook.open(parsed.file, context);
  const changes: WorkbookChange[] = [];
  wb.subscribe((c) => changes.push(c));
  const off = linkWorkbook(() => path, wb, context);
  return {
    wb,
    changes,
    value: (ref, sheet = 's1') => cellValue(wb.cell(sheet, ref)),
    off: () => {
      off();
      wb.destroy();
    },
  };
}

const PLAN = '---\nstatus: active\nbudget: 1200\ndue: 2026-11-05\nowners: [Ann, "[[Bob]]"]\ndone: false\n---\n# Plan\n#work\n';
const COSTS = '# Costs\n\n| Item | Cost |\n|---|---|\n| Rent | 1,450 |\n| Food | 300 |\n| **Total** | =SUM(B2:B3) |\n\n^costs\n\nText.\n\n| A | B |\n|---|---|\n| x | 1 |\n';

describe('spreadsheets reading notes', () => {
  it('NOTEPROP reads properties as values: text, numbers, dates, lists, links, file fields', async () => {
    const host = useTestLinkHost({
      'Projects/Plan.md': PLAN,
      'Book.sheet': sheetText({
        A1: { f: '=NOTEPROP("Plan", "status")' },
        A2: { f: '=NOTEPROP("Projects/Plan", "budget")*2' },
        A3: { f: '=NOTEPROP("[[Plan]]", "due")' },
        A4: { f: '=NOTEPROP("Plan", "owners")' },
        A5: { f: '=NOTEPROP("Plan", "file.name")' },
        A6: { f: '=NOTEPROP("Plan", "DONE")' },
        A7: { f: '=NOTEPROP("Plan", "nope")' },
        A8: { f: '=NOTEPROP("Missing", "status")' },
        A9: { f: '=NOTEPROP("Plan", "file.folder")' },
      }),
    });
    const book = openWorkbook(host, 'Book.sheet');
    expect(book.value('A1')).toEqual({ e: '#N/A' });
    expect(book.wb.errorMessage('s1', 'A1')).toBe('Loading…');
    expect(book.value('A8')).toEqual({ e: '#REF!' });
    await settle();
    expect(book.value('A1')).toBe('active');
    expect(book.value('A2')).toBe(2400);
    expect(book.value('A3')).toBe(46331); // 2026-11-05
    expect(book.wb.impliedFormat('s1', 'A3')).toBe('yyyy-mm-dd');
    expect(book.value('A4')).toBe('Ann, Bob');
    expect(book.value('A5')).toBe('Plan');
    expect(book.value('A6')).toBe(false);
    expect(book.value('A7')).toEqual({ e: '#N/A' });
    expect(book.wb.errorMessage('s1', 'A7')).toBe('“Plan” has no property “nope”.');
    expect(book.wb.errorMessage('s1', 'A8')).toBe('There is no note “Missing”.');
    expect(book.value('A9')).toBe('Projects');
    // Recalculated values are not edits: nothing to save, no undo step.
    expect(book.changes.every((c) => c.origin === 'recalc')).toBe(true);
    expect(book.wb.canUndo()).toBe(false);
    book.off();
  });

  it('follows a note as it changes, is renamed into existence, or goes', async () => {
    const host = useTestLinkHost({ 'Plan.md': PLAN, 'Book.sheet': sheetText({ A1: { f: '=NOTEPROP("Plan", "status")' }, A2: { f: '=NOTEPROP("Later", "status")' } }) });
    const book = openWorkbook(host, 'Book.sheet');
    await settle();
    expect(book.value('A1')).toBe('active');
    host.edit('Plan.md', PLAN.replace('active', 'done'));
    await settle();
    expect(book.value('A1')).toBe('done');
    expect(book.value('A2')).toEqual({ e: '#REF!' });
    host.edit('Later.md', '---\nstatus: new\n---\n');
    await settle();
    expect(book.value('A2')).toBe('new');
    host.edit('Plan.md', null);
    await settle();
    expect(book.value('A1')).toEqual({ e: '#REF!' });
    book.off();
  });

  it('NOTETABLE spills a note’s table as computed, by name or the first, with or without its header', async () => {
    const host = useTestLinkHost({
      'Costs.md': COSTS,
      'Book.sheet': sheetText({
        A1: { f: '=NOTETABLE("Costs", "costs")' },
        D1: { f: '=NOTETABLE("Costs", "Table2", FALSE)' },
        F1: { f: '=SUM(NOTETABLE("Costs", , FALSE))' },
        G1: { f: '=NOTETABLE("Costs", "nope")' },
        H1: { f: '=NOTETABLE(A1)' },
      }),
    });
    const book = openWorkbook(host, 'Book.sheet');
    await settle();
    expect([book.value('A1'), book.value('B1'), book.value('A2'), book.value('B2'), book.value('B3'), book.value('A4'), book.value('B4')]).toEqual([
      'Item',
      'Cost',
      'Rent',
      1450,
      300,
      // The engine reads a cell without its Markdown (item 39).
      'Total',
      1750,
    ]);
    expect([book.value('D1'), book.value('E1'), book.value('D2')]).toEqual(['x', 1, null]);
    expect(book.value('F1')).toBe(3500);
    expect(book.value('G1')).toEqual({ e: '#REF!' });
    expect(book.wb.errorMessage('s1', 'G1')).toBe('“Costs” has no table “nope”.');
    expect(book.value('H1')).toEqual({ e: '#VALUE!' });
    // The table grows: the spill follows.
    host.edit('Costs.md', COSTS.replace('| Food | 300 |', '| Food | 300 |\n| Fun | 50 |'));
    await settle();
    expect([book.value('A4'), book.value('B4'), book.value('A5')]).toEqual(['Fun', 50, 'Total']);
    book.off();
  });

  it('NOTETABLE reads a note open on this device as typed', async () => {
    const host = useTestLinkHost({ 'Costs.md': COSTS, 'Book.sheet': sheetText({ A1: { f: '=INDEX(NOTETABLE("Costs"), 4, 2)' } }) });
    const doc = host.open('Costs.md');
    const book = openWorkbook(host, 'Book.sheet');
    await settle();
    expect(book.value('A1')).toBe(1750);
    doc.type(COSTS.replace('1,450', '1,500'));
    await new Promise((r) => setTimeout(r, 250));
    await settle();
    expect(book.value('A1')).toBe(1800);
    expect(host.reads).not.toContain('Costs.md');
    book.off();
    doc.close();
  });

  it('NOTECOUNT and NOTEQUERY run notes queries, live', async () => {
    const host = useTestLinkHost({
      'Work/A.md': '---\nstatus: open\n---\n#work',
      'Work/B.md': '---\nstatus: done\n---\n#work',
      'Home.md': '#home',
      'Book.sheet': sheetText({
        A1: { f: '=NOTECOUNT("tag:work")' },
        A2: { f: '=NOTECOUNT("#work status=open")' },
        A3: { f: '=NOTECOUNT()' },
        A4: { f: '=NOTECOUNT("links:Nowhere")' },
        C1: { f: '=NOTEQUERY("folder:Work", "title, status")' },
      }),
    });
    const book = openWorkbook(host, 'Book.sheet');
    await settle();
    expect([book.value('A1'), book.value('A2'), book.value('A3'), book.value('A4')]).toEqual([2, 1, 3, 0]);
    expect([book.value('C1'), book.value('D1'), book.value('C2'), book.value('D2'), book.value('C3'), book.value('D3')]).toEqual(['title', 'status', 'A', 'open', 'B', 'done']);
    host.edit('Work/C.md', '---\nstatus: open\n---\n#work');
    await settle();
    expect(book.value('A1')).toBe(3);
    expect([book.value('C4'), book.value('D4')]).toEqual(['C', 'open']);
    book.off();
  });
});

describe('notes reading spreadsheets', () => {
  const BUDGET = sheetText(
    { A1: { v: 'Item' }, B1: { v: 'Cost' }, A2: { v: 'Rent' }, B2: { v: 1450, fmt: '$#,##0.00' }, A3: { v: 'Food' }, B3: { v: 300 }, B4: { f: '=SUM(B2:B3)', c: 1750 }, C1: { f: '=1/0', c: { e: '#DIV/0!' } } },
    { named: { Total: 'Budget!$B$4', Rate: '0.2' }, more: [{ name: 'Summary', cells: { A1: { v: 'Q1' }, B1: { v: 99 } } }] },
  );

  function noteResults(path: string, text: string) {
    const formulas = noteFormulas(text);
    return computeNote(formulas.model, linkContext(() => path));
  }

  it('reads cells, ranges, other sheets and named ranges of a spreadsheet', async () => {
    useTestLinkHost({ 'Finance/Budget.sheet': BUDGET, 'Note.md': '' });
    const text = '| A | B |\n|---|---|\n| =Budget.sheet!B4 | =SUM(Budget.sheet!B2:B3)*2 |\n| =\'Budget.sheet#Summary\'!B1 | =Budget.sheet!Total*Budget.sheet!Rate |\n| =Nope.sheet!A1 | =\'Budget.sheet#Nope\'!A1 |\n| =Budget.sheet!Nope | =Budget.sheet!C1 |\n';
    let results = noteResults('Note.md', text);
    expect(results.cell(0, 1, 0)?.text).toBe('…');
    await settle();
    results = noteResults('Note.md', text);
    expect(results.cell(0, 1, 0)?.text).toBe('1750');
    expect(results.cell(0, 1, 1)?.text).toBe('3500');
    expect(results.cell(0, 2, 0)?.text).toBe('99');
    expect(results.cell(0, 2, 1)?.text).toBe('350');
    expect(results.cell(0, 3, 0)).toMatchObject({ text: '#REF!', hint: 'There is no spreadsheet “Nope.sheet”.' });
    expect(results.cell(0, 3, 1)).toMatchObject({ text: '#REF!', hint: '“Budget.sheet” has no sheet “Nope”.' });
    expect(results.cell(0, 4, 0)).toMatchObject({ text: '#NAME?', hint: '“Budget.sheet” has no named range “Nope”.' });
    expect(results.cell(0, 4, 1)?.text).toBe('#DIV/0!');
    // Inline formulas too, in the referenced cell's number format.
    expect(results.inline('=Budget.sheet!B2')?.text).toBe('$1,450.00');
    expect(results.inline('=Budget.sheet!A2')?.text).toBe('Rent');
    expect(results.reads.has('sheet:Finance/Budget.sheet')).toBe(true);
  });

  it('prefers a workbook open on this device, before it is saved', async () => {
    const host = useTestLinkHost({ 'Budget.sheet': BUDGET, 'Note.md': '' });
    const book = openWorkbook(host, 'Budget.sheet');
    await settle();
    book.wb.setCell('s1', 'B3', { v: 500 });
    await settle();
    expect(noteResults('Note.md', '`=Budget.sheet!B4`').inline('=Budget.sheet!B4')?.text).toBe('1950');
    expect(host.reads).not.toContain('Budget.sheet');
    book.off();
  });

  it('shows #CYCLE! on both sides of a cycle across files', async () => {
    const host = useTestLinkHost({
      'Loop.md': '| A | B |\n|---|---|\n| x | =Book.sheet!A1+1 |\n',
      'Book.sheet': sheetText({ A1: { v: 1 }, C1: { f: '=NOTETABLE("Loop")' } }),
      'Plain.md': '| A |\n|---|\n| =Book.sheet!A1 |\n',
    });
    const book = openWorkbook(host, 'Book.sheet');
    await settle();
    expect(book.value('C1')).toEqual({ e: '#CYCLE!' });
    expect(book.wb.errorMessage('s1', 'C1')).toBe('“Loop” reads this file’s values, so they cannot read its table.');
    const loop = computeNote(noteFormulas(host.files.get('Loop.md')!).model, linkContext(() => 'Loop.md'));
    expect(loop.cell(0, 1, 1)).toMatchObject({ text: '#CYCLE!', hint: '“Book.sheet” reads this note’s values, so this note cannot read its values.' });
    // A note that reads the sheet without being read by it is no cycle.
    const plain = computeNote(noteFormulas(host.files.get('Plain.md')!).model, linkContext(() => 'Plain.md'));
    expect(plain.cell(0, 1, 0)?.text).toBe('1');
    book.off();
  });

  it('a note table reads another note’s table, and a note reading itself is a cycle', async () => {
    useTestLinkHost({ 'Costs.md': COSTS, 'Self.md': '| A |\n|---|\n| =INDEX(NOTETABLE("Self"), 1, 1) |\n' });
    const text = '| A |\n|---|\n| =INDEX(NOTETABLE("Costs", "costs"), 4, 2) |\n';
    noteResults('Other.md', text).cell(0, 1, 0);
    await settle();
    expect(noteResults('Other.md', text).cell(0, 1, 0)?.text).toBe('1750');
    expect(noteResults('Self.md', '| A |\n|---|\n| =INDEX(NOTETABLE("Self"), 1, 1) |\n').cell(0, 1, 0)?.text).toBe('#CYCLE!');
  });
});
