// iOS Smart Punctuation in formulas (DESIGN §6.21.5): typing `"` on an iPhone gives “ or ”, and `'`
// gives ‘ or ’, which a formula does not read as quotes (`=IF(A2>0,“yes”,“no”)` is an error). In a
// formula, curly double quotes are made straight everywhere (they can only be meant as string
// delimiters), and curly single quotes outside strings (where they quote a sheet name); inside a
// string, `’` stays, as typed (`="Bob’s"`). Inside a quoted sheet name, a curly quote closes the
// name only when `!` follows; otherwise it is an apostrophe of the name and stays (`'Mom’s'!B2`,
// the name iOS gives a sheet renamed to Mom's). Text that is not a formula is left alone. Pure.

const CURLY = /[“”„‟‘’]/;

/** `text` with the curly quotes of a formula made straight; anything else unchanged. */
export function straightenFormula(text: string): string {
  if (!/^\s*=/.test(text) || !CURLY.test(text)) return text;
  const chars = [...text.replace(/[“”„‟]/g, '"')];
  let out = '';
  let inString = false;
  let inName = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const curly = ch === '‘' || ch === '’';
    if (inName) {
      if (ch === "'" && chars[i + 1] === "'") {
        // A doubled '' is a quote inside the name.
        out += "''";
        i++;
      } else if (ch === "'" || (curly && chars[i + 1] === '!')) {
        out += "'";
        inName = false;
      } else out += ch;
    } else if (inString) {
      // A doubled "" inside a string flips twice, so it stays inside.
      if (ch === '"') inString = false;
      out += ch;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "'" || curly) {
      inName = true;
      out += "'";
    } else out += ch;
  }
  return out;
}
