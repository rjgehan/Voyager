// Built-in functions whose HyperFormula meaning differs from Google Sheets', replaced with Sheets'
// (DESIGN §6.21.5), as a plugin registered once for every engine instance: `.sheet` workbooks and
// notes' tables alike. Part of the engines' lazy chunks: sheets/engine.ts imports this module for
// its registration. A change here that alters results must change ENGINE_REVISION (engine.ts).
//
//   TEXT(value, format)   the value in a Google Sheets number format (`#,##0.00`, `0%`, `mmm d, yyyy`,
//                         `dddd`, sections), through the formatter the grid uses (numfmt.ts)
//   SPLIT(text, delimiter, [split_by_each], [remove_empty_text])
//                         the parts of the text, spilled across a row: each character of the
//                         delimiter splits (unless split_by_each is FALSE), empty parts are dropped
//                         (unless remove_empty_text is FALSE), parts that are numbers are numbers
import { ArraySize, CellError, EmptyValue, ErrorType, FunctionArgumentType, FunctionPlugin, HyperFormula, SimpleRangeValue } from 'hyperformula';
import { formatNumberWith, formatTextWith } from './numfmt';

type Scalar = number | string | boolean | null | undefined;

/** The parts of HyperFormula's AST read here (its AST types are not exported). */
interface Arg {
  type: string;
  value?: unknown;
  expressionName?: string;
  procedureName?: string;
  expression?: Arg;
}

/** A literal argument (text, a number, TRUE or FALSE); undefined for anything else. */
function literal(arg: Arg | undefined): string | number | boolean | undefined {
  if (!arg) return undefined;
  if (arg.type === 'PARENTHESES') return literal(arg.expression);
  if ((arg.type === 'STRING' && typeof arg.value === 'string') || (arg.type === 'NUMBER' && typeof arg.value === 'number')) return arg.value;
  const name = (arg.expressionName ?? arg.procedureName ?? '').toUpperCase();
  if ((arg.type === 'NAMED_EXPRESSION' || arg.type === 'FUNCTION_CALL') && (name === 'TRUE' || name === 'FALSE')) return name === 'TRUE';
  return undefined;
}

/** The engine's number types (dates, amounts, percentages) arrive as objects holding the number. */
function plain(v: unknown): Scalar {
  if (v !== null && typeof v === 'object' && 'val' in v) return (v as { val: number }).val;
  return v as Scalar;
}

/** The parts SPLIT gives, as Google Sheets splits. */
export function splitParts(text: string, delimiter: string, byEach: boolean, removeEmpty: boolean): Array<string | number> {
  let parts: string[];
  if (byEach) {
    const chars = new Set(Array.from(delimiter));
    parts = [''];
    for (const ch of Array.from(text)) {
      if (chars.has(ch)) parts.push('');
      else parts[parts.length - 1] += ch;
    }
  } else parts = text.split(delimiter);
  if (removeEmpty) parts = parts.filter((p) => p !== '');
  return parts.map((p) => (/^\s*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\s*$/.test(p) ? Number(p) : p));
}

/** The parts of a SPLIT whose arguments are written in the formula, so its spill is known before it runs; null otherwise. */
function literalSplit(args: Arg[]): Array<string | number> | null {
  const [text, delimiter, byEach, removeEmpty] = args.map(literal);
  if (typeof text !== 'string' || typeof delimiter !== 'string' || delimiter === '') return null;
  if ((args.length > 2 && byEach === undefined) || (args.length > 3 && removeEmpty === undefined)) return null;
  return splitParts(text, delimiter, byEach === undefined ? true : Boolean(byEach), removeEmpty === undefined ? true : Boolean(removeEmpty));
}

export class SheetsFunctionsPlugin extends FunctionPlugin {
  static override implementedFunctions = {
    TEXT: {
      method: 'text',
      parameters: [{ argumentType: FunctionArgumentType.SCALAR }, { argumentType: FunctionArgumentType.STRING }],
    },
    SPLIT: {
      method: 'split',
      sizeOfResultArrayMethod: 'splitSize',
      parameters: [
        { argumentType: FunctionArgumentType.STRING },
        { argumentType: FunctionArgumentType.STRING },
        { argumentType: FunctionArgumentType.BOOLEAN, defaultValue: true },
        { argumentType: FunctionArgumentType.BOOLEAN, defaultValue: true },
      ],
      vectorizationForbidden: true,
    },
  };

  split(ast: { args: Arg[] }, state: unknown) {
    return this.runFunction(ast.args as never, state as never, this.metadata('SPLIT'), (text: string, delimiter: string, byEach: boolean, removeEmpty: boolean) => {
      if (delimiter === '') return new CellError(ErrorType.VALUE, 'SPLIT needs a delimiter.');
      const parts = splitParts(text, delimiter, byEach, removeEmpty);
      if (parts.length === 0) return EmptyValue;
      if (parts.length === 1) return parts[0];
      return SimpleRangeValue.onlyValues([parts.map((p) => (p === '' ? EmptyValue : p)) as never[]]);
    });
  }

  splitSize(ast: { args: Arg[] }): ArraySize {
    const parts = literalSplit(ast.args);
    return parts && parts.length > 1 ? new ArraySize(parts.length, 1) : ArraySize.scalar();
  }

  text(ast: { args: unknown[] }, state: unknown) {
    return this.runFunction(ast.args as never, state as never, this.metadata('TEXT'), (raw: unknown, fmt: string) => {
      const value = plain(raw);
      if (fmt === '') return '';
      if (typeof value === 'number') return formatNumberWith(value, fmt).text;
      if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
      const text = value ?? '';
      // Text that holds a number is formatted as one, as in Google Sheets (=TEXT("12", "0.0") is 12.0).
      const n = text.trim() === '' ? NaN : Number(text);
      return Number.isFinite(n) ? formatNumberWith(n, fmt).text : formatTextWith(text, fmt).text;
    });
  }
}

/** Registers the functions with HyperFormula, once (before any engine instance is built). */
export function registerSheetsFunctions(): void {
  if (HyperFormula.getFunctionPlugin('SPLIT') === SheetsFunctionsPlugin) return;
  HyperFormula.registerFunctionPlugin(SheetsFunctionsPlugin);
}

registerSheetsFunctions();
