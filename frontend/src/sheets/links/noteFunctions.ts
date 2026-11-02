// The spreadsheet functions that read notes (ROADMAP item 42, DESIGN §6.47), as a HyperFormula
// plugin registered once for every engine instance: `.sheet` workbooks and notes' tables alike.
//
//   NOTEPROP(note, property)            a property of a note (or a file field: file.mtime, …)
//   NOTETABLE(note, [table], [headers])  a note's table, computed, spilled (headers: TRUE)
//   NOTECOUNT([query])                   how many notes a query matches
//   NOTEQUERY([query], [columns], [headers])  the matching notes' properties, spilled
//
// HyperFormula calls functions synchronously, so they read the link store (store.ts), which
// answers from what it holds and loads the rest ("Loading…" as #N/A meanwhile); when data arrives
// or changes, the formulas that read it are computed again (Workbook.recalculate, the notes'
// editor). A note is named as a link names it, resolved from the file the formula is in. Part of
// the engines' lazy chunks: sheets/engine.ts imports this module for its registration.
import { ArraySize, CellError, EmptyValue, ErrorType, FunctionArgumentType, FunctionPlugin, HyperFormula, SimpleRangeValue } from 'hyperformula';
import { linkStore, MAX_DEPTH, type LinkContext, type LinkStore } from './store';
import { NOTE_FUNCTIONS, parseNoteQuery, queryColumns } from './syntax';
import { isLinkError, linkError, propertyValue, type LinkError, type LinkValue } from './values';

/** The parts of HyperFormula's AST these functions look at (its AST types are not exported). */
interface Arg {
  type: string;
  value?: unknown;
  expressionName?: string;
  procedureName?: string;
  expression?: Arg;
}
interface Call {
  args: Arg[];
}

const ERRORS: Record<string, ErrorType> = {
  '#REF!': ErrorType.REF,
  '#N/A': ErrorType.NA,
  '#VALUE!': ErrorType.VALUE,
  '#CYCLE!': ErrorType.CYCLE,
  '#NAME?': ErrorType.NAME,
  '#ERROR!': ErrorType.ERROR,
  '#DIV/0!': ErrorType.DIV_BY_ZERO,
  '#NUM!': ErrorType.NUM,
  '#SPILL!': ErrorType.SPILL,
};

const errorType = (code: LinkError) => ERRORS[code] ?? ErrorType.VALUE;

export const LOADING = 'Loading…';

function isLinkContext(x: unknown): x is LinkContext {
  return typeof x === 'object' && x !== null && 'reads' in x && 'path' in x && 'depth' in x;
}

/** A literal argument: text, a number, TRUE/FALSE (named expressions or calls here); undefined otherwise. */
function literal(arg: Arg | undefined): string | number | boolean | undefined {
  if (!arg) return undefined;
  if (arg.type === 'PARENTHESES') return literal(arg.expression);
  if (arg.type === 'STRING' && typeof arg.value === 'string') return arg.value;
  if (arg.type === 'NUMBER' && typeof arg.value === 'number') return arg.value;
  const name = (arg.expressionName ?? arg.procedureName ?? '').toUpperCase();
  if ((arg.type === 'NAMED_EXPRESSION' || arg.type === 'FUNCTION_CALL') && (name === 'TRUE' || name === 'FALSE')) return name === 'TRUE';
  return undefined;
}

const asBoolean = (v: string | number | boolean | undefined, fallback: boolean) => (v === undefined ? fallback : typeof v === 'string' ? v.toUpperCase() === 'TRUE' : Boolean(v));

/** The values a table-shaped result holds, or an error. */
type Grid = LinkValue[][] | { error: LinkError; message: string };

export class NoteFunctionsPlugin extends FunctionPlugin {
  static override implementedFunctions = {
    NOTEPROP: {
      method: 'noteprop',
      parameters: [{ argumentType: FunctionArgumentType.STRING }, { argumentType: FunctionArgumentType.STRING }],
    },
    NOTETABLE: {
      method: 'notetable',
      sizeOfResultArrayMethod: 'notetableSize',
      parameters: [{ argumentType: FunctionArgumentType.STRING }, { argumentType: FunctionArgumentType.STRING, defaultValue: '' }, { argumentType: FunctionArgumentType.BOOLEAN, defaultValue: true }],
      vectorizationForbidden: true,
    },
    NOTECOUNT: {
      method: 'notecount',
      parameters: [{ argumentType: FunctionArgumentType.STRING, defaultValue: '' }],
    },
    NOTEQUERY: {
      method: 'notequery',
      sizeOfResultArrayMethod: 'notequerySize',
      parameters: [{ argumentType: FunctionArgumentType.STRING, defaultValue: '' }, { argumentType: FunctionArgumentType.STRING, defaultValue: '' }, { argumentType: FunctionArgumentType.BOOLEAN, defaultValue: true }],
      vectorizationForbidden: true,
    },
  };

  // ---------- the functions ----------

  noteprop(ast: Call, state: unknown) {
    return this.runFunction(ast.args as never, state as never, this.metadata('NOTEPROP'), (note: string, property: string) =>
      this.cell(
        this.read((store, from) => {
          const path = store.resolveNote(note, from);
          if (!path) return linkError('#REF!', `There is no note “${note}”.`);
          const meta = store.noteMeta(path);
          if (meta.status === 'loading') return linkError('#N/A', LOADING);
          if (!meta.value) return meta.status === 'missing' ? linkError('#REF!', `There is no note “${note}”.`) : linkError('#N/A', meta.message ?? 'The note could not be read.');
          const value = propertyValue(meta.value, property);
          return value === undefined ? linkError('#N/A', `“${meta.value.title}” has no property “${property}”.`) : value;
        }),
      ),
    );
  }

  notetable(ast: Call, state: unknown) {
    const literals = this.tableLiterals(ast);
    return this.runFunction(ast.args as never, state as never, this.metadata('NOTETABLE'), (note: string, table: string, headers: boolean) => {
      if (!literals) return new CellError(ErrorType.VALUE, 'Write the note’s name (and the table’s) as text, such as NOTETABLE("Budget", "costs"), for the table to spill.');
      return this.range(this.tableGrid(note, table, headers));
    });
  }

  notetableSize(ast: Call): ArraySize {
    const literals = this.tableLiterals(ast);
    return literals ? this.sizeOf(this.tableGrid(literals.note, literals.table, literals.headers)) : ArraySize.scalar();
  }

  notecount(ast: Call, state: unknown) {
    return this.runFunction(ast.args as never, state as never, this.metadata('NOTECOUNT'), (query: string) =>
      this.cell(
        this.read((store, from) => {
          const filter = this.filter(store, query, from);
          if (filter === null) return 0;
          const r = store.query({ ...filter, limit: 1 });
          if (r.status === 'loading') return linkError('#N/A', LOADING);
          return r.value ? r.value.total : linkError('#VALUE!', r.message ?? 'The query could not be run.');
        }),
      ),
    );
  }

  notequery(ast: Call, state: unknown) {
    const literals = this.queryLiterals(ast);
    return this.runFunction(ast.args as never, state as never, this.metadata('NOTEQUERY'), (query: string, columns: string, headers: boolean) => {
      if (!literals) return new CellError(ErrorType.VALUE, 'Write the query (and the columns) as text, such as NOTEQUERY("tag:work", "title, status"), for the result to spill.');
      return this.range(this.queryGrid(query, columns, headers));
    });
  }

  notequerySize(ast: Call): ArraySize {
    const literals = this.queryLiterals(ast);
    return literals ? this.sizeOf(this.queryGrid(literals.query, literals.columns, literals.headers)) : ArraySize.scalar();
  }

  // ---------- reading notes ----------

  private context(): LinkContext | null {
    const c = (this.config as unknown as { context?: unknown }).context;
    return isLinkContext(c) ? c : null;
  }

  /** Runs `fn` against the store, recording what it reads in the computation's context. */
  private read<T>(fn: (store: LinkStore, from: string | null, context: LinkContext | null) => T): T {
    const store = linkStore();
    const context = this.context();
    return context ? store.track(context.reads, () => fn(store, context.path(), context)) : fn(store, null, null);
  }

  private filter(store: LinkStore, query: string, from: string | null) {
    const q = parseNoteQuery(query);
    let linksTo: string | null = null;
    if (q.linksTo !== null) {
      linksTo = store.resolveNote(q.linksTo, from);
      // Nothing links to a note that does not exist.
      if (linksTo === null) return null;
    }
    return { tag: q.tag, folder: q.folder, prop: q.prop, linksTo, q: q.q };
  }

  private tableLiterals(ast: Call): { note: string; table: string; headers: boolean } | null {
    const [note, table, headers] = ast.args.map(literal);
    if (typeof note !== 'string' || (ast.args.length > 1 && ast.args[1].type !== 'EMPTY' && typeof table !== 'string')) return null;
    if (ast.args.length > 2 && ast.args[2].type !== 'EMPTY' && headers === undefined) return null;
    return { note, table: typeof table === 'string' ? table : '', headers: asBoolean(headers, true) };
  }

  private queryLiterals(ast: Call): { query: string; columns: string; headers: boolean } | null {
    const [query, columns, headers] = ast.args.map(literal);
    if (ast.args.length > 0 && ast.args[0].type !== 'EMPTY' && typeof query !== 'string') return null;
    if (ast.args.length > 1 && ast.args[1].type !== 'EMPTY' && typeof columns !== 'string') return null;
    if (ast.args.length > 2 && ast.args[2].type !== 'EMPTY' && headers === undefined) return null;
    return { query: typeof query === 'string' ? query : '', columns: typeof columns === 'string' ? columns : '', headers: asBoolean(headers, true) };
  }

  private tableGrid(note: string, table: string, headers: boolean): Grid {
    return this.read((store, from, context) => {
      const path = store.resolveNote(note, from);
      if (!path) return { error: '#REF!', message: `There is no note “${note}”.` };
      // A note whose values come (through any chain of files) from this one would read itself.
      if (from !== null && (path === from || store.isComputing(path) || store.reaches(path, from))) {
        return { error: '#CYCLE!', message: `“${note}” reads this file’s values, so they cannot read its table.` };
      }
      if (from !== null) store.addEdge(from, path);
      const depth = (context?.depth ?? 0) + 1;
      if (depth > MAX_DEPTH) return { error: '#N/A', message: `Tables that read tables more than ${MAX_DEPTH} notes deep are not computed.` };
      const tables = store.tables(path, depth);
      if (tables.status === 'loading') return { error: '#N/A', message: LOADING };
      if (!tables.value) {
        if (tables.message === 'cycle') return { error: '#CYCLE!', message: `“${note}” reads this file’s values, so they cannot read its table.` };
        return tables.status === 'missing' ? { error: '#REF!', message: `There is no note “${note}”.` } : { error: '#N/A', message: tables.message ?? 'The note could not be read.' };
      }
      const wanted = table.trim().replace(/^\^/, '').toLowerCase();
      const found = wanted === '' ? tables.value[0] : tables.value.find((t) => t.name.toLowerCase() === wanted);
      if (!found) return { error: '#REF!', message: wanted === '' ? `“${note}” has no table.` : `“${note}” has no table “${table}”.` };
      return headers ? found.rows : found.rows.slice(1);
    });
  }

  private queryGrid(query: string, columns: string, headers: boolean): Grid {
    return this.read((store, from) => {
      const filter = this.filter(store, query, from);
      const names = queryColumns(columns);
      if (filter === null) return headers ? [names] : [];
      const r = store.query(filter);
      if (r.status === 'loading') return { error: '#N/A', message: LOADING };
      if (!r.value) return { error: '#VALUE!', message: r.message ?? 'The query could not be run.' };
      const rows = r.value.notes.map((n) => names.map((c) => propertyValue(n, c) ?? null));
      return headers ? [names, ...rows] : rows;
    });
  }

  // ---------- values ----------

  private sizeOf(grid: Grid): ArraySize {
    if (!Array.isArray(grid) || grid.length === 0) return ArraySize.scalar();
    const width = Math.max(1, ...grid.map((r) => r.length));
    return new ArraySize(width, grid.length);
  }

  private range(grid: Grid) {
    if (!Array.isArray(grid)) return new CellError(errorType(grid.error), grid.message);
    if (grid.length === 0) return EmptyValue;
    const width = Math.max(1, ...grid.map((r) => r.length));
    return SimpleRangeValue.onlyValues(grid.map((row) => Array.from({ length: width }, (_, i) => this.cell(row[i] ?? null) as never)));
  }

  /** A link value as the engine's. */
  private cell(v: LinkValue) {
    if (v === null) return EmptyValue;
    if (typeof v !== 'object') return v;
    if (isLinkError(v)) return new CellError(errorType(v.error), v.message);
    return this.returnNumberWrapper(v.date, (v.time ? 'NUMBER_DATETIME' : 'NUMBER_DATE') as never);
  }
}

/** Registers the functions with HyperFormula, once (before any engine instance is built). */
export function registerNoteFunctions(): void {
  if (HyperFormula.getRegisteredFunctionNames('enGB').includes('NOTEPROP')) return;
  HyperFormula.registerFunctionPlugin(NoteFunctionsPlugin, { enGB: Object.fromEntries(NOTE_FUNCTIONS.map((n) => [n, n])) });
}

registerNoteFunctions();
