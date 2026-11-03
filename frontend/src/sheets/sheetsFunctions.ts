// Built-in functions whose HyperFormula meaning differs from Google Sheets', replaced with Sheets'
// (DESIGN §6.21.5), as a plugin registered once for every engine instance: `.sheet` workbooks and
// notes' tables alike. Part of the engines' lazy chunks: sheets/engine.ts imports this module for
// its registration. A change here that alters results must change ENGINE_REVISION (engine.ts).
//
//   TEXT(value, format)   the value in a Google Sheets number format (`#,##0.00`, `0%`, `mmm d, yyyy`,
//                         `dddd`, sections), through the formatter the grid uses (numfmt.ts)
import { FunctionArgumentType, FunctionPlugin, HyperFormula } from 'hyperformula';
import { formatNumberWith, formatTextWith } from './numfmt';

type Scalar = number | string | boolean | null | undefined;

/** The engine's number types (dates, amounts, percentages) arrive as objects holding the number. */
function plain(v: unknown): Scalar {
  if (v !== null && typeof v === 'object' && 'val' in v) return (v as { val: number }).val;
  return v as Scalar;
}

export class SheetsFunctionsPlugin extends FunctionPlugin {
  static override implementedFunctions = {
    TEXT: {
      method: 'text',
      parameters: [{ argumentType: FunctionArgumentType.SCALAR }, { argumentType: FunctionArgumentType.STRING }],
    },
  };

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
  if (HyperFormula.getFunctionPlugin('TEXT') === SheetsFunctionsPlugin) return;
  HyperFormula.registerFunctionPlugin(SheetsFunctionsPlugin);
}

registerSheetsFunctions();
