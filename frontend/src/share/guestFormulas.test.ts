// Formulas on the guest page (DESIGN §6.48): loading the formula engine runs none of the owner's
// app, so the guest's own session lookup stays in place (encrypted sections still open), and a
// shared note's references to other files read the share through the guest endpoints, never the
// owner's API.
import { afterEach, expect, it, vi } from 'vitest';
import { queryKeys } from '../api/queryKeys';
import type { FileEntry, TreeResponse } from '../api/types';
import { formulaEngineForTests } from '../formulas/load';
import { noteFormulas } from '../sheets/links/noteText';
import { provideLinkHost } from '../sheets/links/pageHost';
import { linkContext, linkStore, resetLinkStore } from '../sheets/links/store';
import type { DocumentSession } from '../sync/DocumentSession';
import { provideSessionLookup, sessionAt } from '../sync/sessionLookup';
import { guestLinkHost, NOT_IN_SHARES } from './guestLinks';
import { GuestSync } from './guestSync';

afterEach(() => {
  provideSessionLookup(() => undefined);
  provideLinkHost(null);
  resetLinkStore();
});

function entry(path: string, kind: FileEntry['kind']): FileEntry {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return { path, name, basename: name.slice(0, dot), extension: name.slice(dot + 1), kind, size: 10, mtime: '2026-11-02T10:00:00.000Z', version: 'v1', aliases: [] };
}

const BUDGET = JSON.stringify({
  type: 'notesapp-sheet',
  version: 1,
  engine: '',
  sheets: [{ id: 's1', name: 'Budget', cells: { A1: { v: 'Rent' }, B1: { v: 1450 } }, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } }],
  named: {},
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await linkStore().settled();
    await new Promise((r) => setTimeout(r, 0));
    linkStore().flush();
  }
}

it('loading the formula engine leaves the guest page’s session lookup alone', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const session = { path: 'A.md' } as DocumentSession;
  provideSessionLookup((path) => (path === 'A.md' ? session : undefined));
  await formulaEngineForTests();
  expect(sessionAt('A.md')).toBe(session);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('a shared note’s formulas read the share’s spreadsheet through the guest API, and say what a guest cannot read', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const sync = new GuestSync('abcdefghijkl');
  const readFile = vi.spyOn(sync.api, 'readFile').mockImplementation(async (path) => ({ path, kind: 'text', content: BUDGET, version: 'v1', size: BUDGET.length, mtime: '2026-11-02T10:00:00.000Z', lossy: false }));
  const tree: TreeResponse = { eventId: 'e.1', folders: [{ path: 'Family', name: 'Family' }], files: [entry('Family/Plan.md', 'note'), entry('Family/Budget.sheet', 'text')] };
  sync.qc.setQueryData(queryKeys.tree(), tree);
  provideLinkHost(() => guestLinkHost(sync));
  const { computeNote } = await formulaEngineForTests();
  const formulas = ['=Budget.sheet!B1', '=NOTECOUNT("tag:work")', '=NOTEPROP("Plan", "status")'];
  const model = noteFormulas(formulas.map((f) => '`' + f + '`').join(', ')).model;
  // Inline formulas compute as they are asked for (and start their loads then).
  const shown = () => {
    const results = computeNote(model, linkContext(() => 'Family/Plan.md'));
    return formulas.map((f) => results.inline(f));
  };
  shown();
  await settle();
  const [cell, count, prop] = shown();
  expect(cell?.text).toBe('1450');
  expect(count?.hint).toBe(NOT_IN_SHARES);
  expect(prop?.hint).toBe(NOT_IN_SHARES);
  expect(readFile).toHaveBeenCalledWith('Family/Budget.sheet');
  // Nothing went to the owner's endpoints (the guest API above is the only way out).
  expect(fetchSpy).not.toHaveBeenCalled();
});
