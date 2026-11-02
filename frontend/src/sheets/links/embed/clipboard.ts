// The last copy made in a spreadsheet embed (ROADMAP item 42), so a paste in an embed brings its
// formulas and formats, moved to their new place (sheets/edits.ts). The spreadsheet view keeps its own.
import type { SheetClip } from '../../edits';

let last: SheetClip | null = null;

export function embedClip(): SheetClip | null {
  return last;
}

export function setEmbedClip(clip: SheetClip | null): void {
  last = clip;
}
