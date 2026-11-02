// A spreadsheet's workbook and the notes it reads (ROADMAP item 42, DESIGN §6.45). The binding that
// opens a workbook (views/sheet/useSheetDocument.ts) links it here: its formulas that read notes
// are computed again whenever something they read changes (throttled by the store), and its live
// values become what notes that read the spreadsheet see, before they are saved.
import type { Workbook } from '../engine';
import { linkContext, linkStore, type LinkContext } from './store';
import { usesNoteFunctions } from './syntax';

/** The context a workbook's engine gets (HyperFormula's `context`): its path, and what its formulas read. */
export function workbookContext(path: () => string): LinkContext {
  return linkContext(path);
}

/** Links an open workbook to the notes it reads; returns what unlinks it. */
export function linkWorkbook(path: () => string, workbook: Workbook, context: LinkContext): () => void {
  const store = linkStore();
  const offLive = store.addLiveSheet(path, { file: () => workbook.file, subscribe: (fn) => workbook.subscribe(fn) });
  const offStore = store.subscribe((keys) => {
    if (![...context.reads].some((k) => keys.has(k))) return;
    // Everything the note functions read is read again by the recalculation.
    context.reads.clear();
    try {
      workbook.recalculate(usesNoteFunctions);
    } catch (e) {
      console.error('[links] recalculating a spreadsheet failed', e);
    }
  });
  return () => {
    offStore();
    offLive();
  };
}
