// Where a block goes in (a table, a callout, a code block, a rule), a line holding nothing but list,
// task or quote markup counts as blank: the block replaces it instead of leaving an empty bullet
// above it (DESIGN §6.6.2). `/table` typed on a fresh bullet leaves `- ` once the command is gone.
const MARKUP_ONLY = /^\s*(?:>\s?)*\s*(?:(?:[-+*]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s*)?)?$/;

/** True for an empty line, or one with only a list marker, a task box or quote markers. */
export function isBlankForBlock(text: string): boolean {
  return MARKUP_ONLY.test(text);
}
