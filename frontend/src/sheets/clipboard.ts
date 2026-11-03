// The last copy (or cut) made in any spreadsheet on this page (DESIGN §6.21.5): the spreadsheet
// view's and the grids embedded in notes (ROADMAP item 42) share it, so a paste of the same text,
// in either, brings the copied formulas and formats, moved to their new place (sheets/edits.ts),
// and a newer copy in one replaces an older one in the other, as the system clipboard does. A
// small module of its own, engine-free, which both lazy chunks import.
import type { SheetClip } from './edits';

let last: SheetClip | null = null;

export function sheetClip(): SheetClip | null {
  return last;
}

export function setSheetClip(clip: SheetClip | null): void {
  last = clip;
}

/** Escape drops a pending cut: a later paste copies. */
export function dropPendingCut(): void {
  if (last?.cut) last = { ...last, cut: undefined };
}
