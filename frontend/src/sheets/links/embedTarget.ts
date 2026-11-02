// What a spreadsheet embed in a note shows (ROADMAP item 42, DESIGN §6.47), beyond item 6b's sheets
// and ranges: `![[Budget.sheet#chart:Spending]]` is one chart, found by its title (any case) or
// its id, on any sheet, in tab order. Pure.
import { displayName } from '../../features/paths';
import { compareIds, type ChartProps, type Sheet, type SheetFile } from '../format';
import { usesNoteFunctions } from './syntax';

const SIZE = /^\d+(x\d+)?$/;

/** An embed's caption: its display text (not a size), else the file's name and what it shows. */
export function embedCaption(path: string, subpath: string | undefined, display: string | undefined): string {
  return display && !SIZE.test(display.trim()) ? display : displayName(path) + (subpath ? ` › ${subpath}` : '');
}

/** The chart a subpath names (`chart:Spending`), or null when it names no chart. */
export function chartName(subpath: string | null | undefined): string | null {
  const m = /^\s*chart\s*:\s*(.*)$/i.exec(subpath ?? '');
  return m ? m[1].trim() : null;
}

export interface FoundChart {
  sheet: Sheet;
  id: string;
  chart: ChartProps;
}

/** A chart by title (ignoring case) or id; the first sheet's first chart when `name` is empty. */
export function findChart(file: SheetFile, name: string): FoundChart | null {
  const wanted = name.trim().toLowerCase();
  for (const sheet of file.sheets) {
    const charts = Object.entries(sheet.charts).sort(([a], [b]) => compareIds(a, b));
    for (const [id, chart] of charts) {
      if (wanted === '' || id.toLowerCase() === wanted || (chart.title ?? '').trim().toLowerCase() === wanted) return { sheet, id, chart };
    }
  }
  return null;
}

/** Whether a spreadsheet's formulas read notes (its values then change without it being edited). */
export function readsNotes(file: SheetFile): boolean {
  return file.sheets.some((s) => Object.values(s.cells).some((c) => c.f !== undefined && usesNoteFunctions(c.f)));
}
