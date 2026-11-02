// Notes ↔ sheets (ROADMAP item 42, DESIGN §6.45): what a formula says about other files, read from
// its text without the engine. A spreadsheet reads notes with four functions (`NOTEPROP`,
// `NOTETABLE`, `NOTECOUNT`, `NOTEQUERY`); a note's tables and inline formulas read a spreadsheet
// with a reference whose sheet is the file (`Budget.sheet!B10`, `'Budget.sheet#Summary'!A1:C3`,
// `Budget.sheet!Total`), the same shape as item 39's references to a note's named tables
// (`budget!B5`). Pure and DOM-free.

/** The functions that read notes. */
export const NOTE_FUNCTIONS = ['NOTEPROP', 'NOTETABLE', 'NOTECOUNT', 'NOTEQUERY'] as const;
export type NoteFunction = (typeof NOTE_FUNCTIONS)[number];

const FUNCTION_NAMES = new Set<string>(NOTE_FUNCTIONS);

/** A call to a note function, with its arguments as written: text literals unquoted, anything else null. */
export interface NoteCall {
  name: NoteFunction;
  /** Each argument: the text of a string literal (`"Plan"` → `Plan`), else null (a reference, a number, an expression). */
  args: Array<string | null>;
}

const WORD = /[\p{L}\p{N}_.$]/u;
const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch);

/** The end of a quoted run starting at `from` (`"…"` or `'…'`, the quote doubled inside). */
function quotedEnd(text: string, from: number): number {
  const quote = text[from];
  let i = from + 1;
  while (i < text.length) {
    if (text[i] === quote) {
      if (text[i + 1] === quote) i += 2;
      else return i + 1;
    } else i++;
  }
  return text.length;
}

/** `"a""b"` → `a"b`; null when `text` is not one string literal. */
function stringLiteral(text: string): string | null {
  const t = text.trim();
  if (t.length < 2 || t[0] !== '"' || quotedEnd(t, 0) !== t.length || t[t.length - 1] !== '"') return null;
  return t.slice(1, -1).replace(/""/g, '"');
}

/** The arguments of a call whose `(` is at `open`, as written, and the index after its `)`. */
function callArgs(formula: string, open: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let i = open + 1;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"' || ch === "'") {
      i = quotedEnd(formula, i);
      continue;
    }
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') {
      if (depth === 0) {
        const last = formula.slice(start, i);
        if (args.length > 0 || last.trim() !== '') args.push(last);
        return { args, end: i + 1 };
      }
      depth--;
    } else if ((ch === ',' || ch === ';') && depth === 0) {
      args.push(formula.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  const last = formula.slice(start);
  if (args.length > 0 || last.trim() !== '') args.push(last);
  return { args, end: formula.length };
}

/** The note functions a formula calls (nested calls included), in order. */
export function noteCalls(formula: string): NoteCall[] {
  const out: NoteCall[] = [];
  if (!formula.trimStart().startsWith('=')) return out;
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"' || ch === "'") {
      i = quotedEnd(formula, i);
      continue;
    }
    if (isWord(ch) && !isWord(formula[i - 1])) {
      let end = i;
      while (isWord(formula[end])) end++;
      const word = formula.slice(i, end).toUpperCase();
      let open = end;
      while (formula[open] === ' ') open++;
      if (FUNCTION_NAMES.has(word) && formula[open] === '(') {
        const { args } = callArgs(formula, open);
        out.push({ name: word as NoteFunction, args: args.map(stringLiteral) });
        // Nested calls in the arguments are found as the scan goes on.
        i = open + 1;
        continue;
      }
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

/** Whether a formula calls a note function (its result then depends on notes). */
export function usesNoteFunctions(formula: string): boolean {
  return /NOTE(?:PROP|TABLE|COUNT|QUERY)\s*\(/i.test(formula) && noteCalls(formula).length > 0;
}

// ---------- references to spreadsheet files ----------

/** A sheet prefix that names a spreadsheet file: `Budget.sheet`, `Finance/Budget.sheet#Summary`. */
export interface FileSheet {
  /** The file as written, a link target (`Budget.sheet`, `Finance/Budget.sheet`). */
  file: string;
  /** The sheet after `#`, or null for the file's first sheet. */
  sheet: string | null;
}

/** The file a sheet prefix's name (unquoted) names, or null when it is a sheet of the note itself. */
export function fileSheet(name: string): FileSheet | null {
  const hash = name.indexOf('#');
  const file = (hash < 0 ? name : name.slice(0, hash)).trim();
  if (!/\.sheet$/i.test(file) || file.length <= '.sheet'.length) return null;
  const sheet = hash < 0 ? null : name.slice(hash + 1).trim();
  return { file, sheet: sheet === '' ? null : sheet };
}

/** A reference to a spreadsheet file in a formula: `Budget.sheet!B10`. */
export interface ExternalRef extends FileSheet {
  /** The prefix's name, unquoted (`Budget.sheet#Summary`). */
  name: string;
  /** What follows the `!`: a cell (`B10`, `$B$10`), a range (`B2:B9`, `A:B`, `2:5`) or a named range (`Total`). */
  target: string;
  /** Where the whole reference (prefix, `!` and target) is in the formula. */
  from: number;
  to: number;
}

const CELL_PART = '\\$?[A-Za-z]{1,3}\\$?[0-9]{1,7}';
const TARGET = new RegExp(
  `^(?:${CELL_PART}(?::${CELL_PART})?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?[0-9]{1,7}:\\$?[0-9]{1,7}|[\\p{L}_][\\p{L}\\p{N}_.]*)`,
  'u',
);

/** The references to spreadsheet files in a formula, in order. Strings and the note's own sheets are skipped. */
export function externalRefs(formula: string): ExternalRef[] {
  const out: ExternalRef[] = [];
  if (!formula.trimStart().startsWith('=')) return out;
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    let name: string | null = null;
    let bang = -1;
    const start = i;
    if (ch === '"') {
      i = quotedEnd(formula, i);
      continue;
    }
    if (ch === "'") {
      const end = quotedEnd(formula, i);
      if (formula[end] === '!') {
        name = formula.slice(i + 1, end - 1).replace(/''/g, "'");
        bang = end;
      }
      i = end;
    } else if (isWord(ch) && !isWord(formula[i - 1])) {
      let end = i;
      while (isWord(formula[end])) end++;
      if (formula[end] === '!') {
        name = formula.slice(i, end);
        bang = end;
      }
      i = end;
    } else {
      i++;
      continue;
    }
    if (name === null) continue;
    const file = fileSheet(name);
    if (!file) continue;
    const m = TARGET.exec(formula.slice(bang + 1));
    if (!m) continue;
    // A name followed by `(` is a function, not a named range.
    if (formula[bang + 1 + m[0].length] === '(') continue;
    out.push({ ...file, name, target: m[0], from: start, to: bang + 1 + m[0].length });
    i = bang + 1 + m[0].length;
  }
  return out;
}

/** `formula` with each reference to a spreadsheet file replaced by what `map` makes of it. */
export function rewriteExternalRefs(formula: string, map: (ref: ExternalRef) => string): string {
  const refs = externalRefs(formula);
  if (refs.length === 0) return formula;
  let out = '';
  let at = 0;
  for (const ref of refs) {
    out += formula.slice(at, ref.from) + map(ref);
    at = ref.to;
  }
  return out + formula.slice(at);
}

// ---------- the queries of NOTECOUNT and NOTEQUERY ----------

/** The filters of `GET /api/notes/query` a query text stands for (API.md §40.1). */
export interface NoteQuery {
  tag: string[];
  folder: string | null;
  /** `name`, `name=value` or `name!=value`. */
  prop: string[];
  /** A link target, resolved by the caller. */
  linksTo: string | null;
  /** Full-text search (API.md §12.1's syntax) for the rest. */
  q: string | null;
}

/** The words of a query, phrases in double quotes kept whole (quotes included). */
function queryWords(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    let end = i;
    while (end < text.length && !/\s/.test(text[end])) {
      if (text[end] === '"') end = quotedEnd(text, end);
      else if (text.startsWith('[[', end)) {
        const close = text.indexOf(']]', end + 2);
        end = close < 0 ? text.length : close + 2;
      } else end++;
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s);

/**
 * A query as NOTECOUNT and NOTEQUERY take it: `tag:work` (or `#work`), `folder:Projects`,
 * `links:Plan` (or `[[Plan]]`), `status=open`, `status!=done` or `prop:status`, and anything else
 * as full-text search words (`"weekly review" -draft`). Empty: every note.
 */
export function parseNoteQuery(text: string): NoteQuery {
  const query: NoteQuery = { tag: [], folder: null, prop: [], linksTo: null, q: null };
  const rest: string[] = [];
  for (const word of queryWords(text)) {
    const lower = word.toLowerCase();
    const after = (prefix: string) => unquote(word.slice(prefix.length));
    if (/^#[^\s#]/.test(word)) query.tag.push(word.slice(1));
    else if (lower.startsWith('tag:') && word.length > 4) query.tag.push(after('tag:').replace(/^#/, ''));
    else if (lower.startsWith('folder:')) query.folder = after('folder:');
    else if (lower.startsWith('links:') && word.length > 6) query.linksTo = after('links:').replace(/^\[\[(.*)\]\]$/, '$1');
    else if (lower.startsWith('linksto:') && word.length > 8) query.linksTo = after('linksto:').replace(/^\[\[(.*)\]\]$/, '$1');
    else if (/^\[\[.+\]\]$/.test(word)) query.linksTo = word.slice(2, -2).split('|')[0];
    else if (lower.startsWith('prop:') && word.length > 5) query.prop.push(after('prop:'));
    else if (/^[\p{L}\p{N}_-]+!?=/u.test(word) && !word.startsWith('-')) {
      const eq = word.indexOf('=');
      const not = word[eq - 1] === '!';
      const name = word.slice(0, not ? eq - 1 : eq);
      query.prop.push(`${name}${not ? '!=' : '='}${unquote(word.slice(eq + 1))}`);
    } else rest.push(word);
  }
  query.q = rest.length > 0 ? rest.join(' ') : null;
  return query;
}

/** The columns NOTEQUERY shows: `"title, status, due"` → `['title', 'status', 'due']`; empty: the title. */
export function queryColumns(text: string | null | undefined): string[] {
  const columns = (text ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c !== '');
  return columns.length > 0 ? columns : ['title'];
}
