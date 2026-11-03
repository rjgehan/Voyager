// iOS Smart Punctuation in formulas (DESIGN §6.21.5): typing `"` on an iPhone gives “ or ”, and `'`
// gives ‘ or ’, which a formula does not read as quotes (`=IF(A2>0,“yes”,“no”)` is an error). In a
// formula, curly double quotes are made straight everywhere (they can only be meant as string
// delimiters), and curly single quotes outside strings (where they quote a sheet name); inside a
// string, `’` stays, as typed (`="Bob’s"`). Text that is not a formula is left alone. Pure.

const CURLY = /[“”„‟‘’]/;

/** `text` with the curly quotes of a formula made straight; anything else unchanged. */
export function straightenFormula(text: string): string {
  if (!/^\s*=/.test(text) || !CURLY.test(text)) return text;
  const doubled = text.replace(/[“”„‟]/g, '"');
  let out = '';
  let inString = false;
  for (const ch of doubled) {
    // A doubled "" inside a string flips twice, so it stays inside.
    if (ch === '"') inString = !inString;
    out += !inString && (ch === '‘' || ch === '’') ? "'" : ch;
  }
  return out;
}
