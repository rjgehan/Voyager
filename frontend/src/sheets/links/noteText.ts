// A note's formulas from its text alone (ROADMAP item 42, DESIGN §6.47), for notes that are not
// open in an editor: its top-level tables as the formula engine of item 39 sees them (the same
// names, `^ids` and `%% formats %%` lines), and its inline formulas. The editor reads tables from
// its syntax tree (editor/livePreview/formulas.ts); this reads them line by line, skipping
// frontmatter, fenced code and `%%` comment blocks, which is what a spreadsheet's `NOTETABLE` and
// the dependency graph need. Pure and DOM-free.
import { formulasOff, isFormula, sheetNames, tableAnnotations, type FormulaModel } from '../../formulas/model';
import { gridRows, parseTable } from '../../editor/livePreview/table/model';

/** A GFM delimiter row: `|---|:--:|`, `--- | ---`. */
const DELIMITER = /^\s{0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const isBlank = (line: string) => line.trim() === '';

/** The frontmatter's YAML (null without one) and the line the body starts on. */
function frontmatter(lines: readonly string[]): { yaml: string | null; body: number } {
  if (lines[0]?.trimEnd() !== '---') return { yaml: null, body: 0 };
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (t === '---' || t === '...') return { yaml: lines.slice(1, i).join('\n'), body: i + 1 };
  }
  return { yaml: null, body: 0 };
}

export interface NoteFormulas {
  /** Whether the note turns its formulas off (`formulas: false`). */
  off: boolean;
  model: FormulaModel;
  /** The note's inline formulas (`` `=…` ``), with their `=`. */
  inline: string[];
}

/** The formulas of a note's text: its tables and inline formulas. */
export function noteFormulas(text: string): NoteFormulas {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const { yaml, body } = frontmatter(lines);
  const found: Array<{ rows: string[][]; under: string[] }> = [];
  const inline: string[] = [];
  let fence: string | null = null;
  let comment = false;
  for (let i = body; i < lines.length; i++) {
    const line = lines[i];
    if (fence !== null) {
      const m = FENCE.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = open[1];
      continue;
    }
    if (comment) {
      if (line.includes('%%')) comment = false;
      continue;
    }
    if (line.trimStart().startsWith('%%') && (line.match(/%%/g)?.length ?? 0) === 1) {
      comment = true;
      continue;
    }
    // A table: a line with a pipe, then a delimiter row, at the top level (not in a quote or a list, not indented code).
    if (line.includes('|') && /^\s{0,3}[^\s>]/.test(line) && !/^\s{0,3}([-+*]|\d+[.)])\s/.test(line) && DELIMITER.test(lines[i + 1] ?? '') && lines[i + 1].includes('-')) {
      let end = i + 2;
      while (end < lines.length && !isBlank(lines[end]) && lines[end].includes('|')) end++;
      const model = parseTable(lines.slice(i, end).join('\n'));
      if (model) {
        found.push({ rows: gridRows(model), under: lines.slice(end, end + 3) });
        i = end - 1;
        continue;
      }
    }
    for (const m of line.matchAll(/(`+)([^`]|[^`].*?[^`])\1(?!`)/g)) {
      const code = m[2].trim();
      if (isFormula(code)) inline.push(code);
    }
  }
  const annotations = found.map((t) => tableAnnotations(t.under));
  const names = sheetNames(annotations.map((a) => a.id));
  return {
    off: formulasOff(yaml),
    model: { tables: found.map((t, k) => ({ name: names[k], named: annotations[k].id !== null, rows: t.rows, formats: annotations[k].formats })) },
    inline,
  };
}

/** Every formula of a note: its tables' formula cells and its inline formulas. */
export function allFormulas(formulas: NoteFormulas): string[] {
  if (formulas.off) return [];
  const out: string[] = [];
  for (const t of formulas.model.tables) for (const row of t.rows) for (const cell of row) if (isFormula(cell)) out.push(cell.trim());
  return out.concat(formulas.inline);
}
