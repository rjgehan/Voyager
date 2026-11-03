// Heading targets (DESIGN §6.4): what a heading is and how `#Heading` subpaths find one. No
// CodeMirror here: outline.ts reads headings from the Lezer tree.

export interface OutlineHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** 0-based line number. */
  line: number;
  /** Document offset of the heading line start. */
  from: number;
}

/** What a wikilink cannot hold (`[[Note#C# tips]]` would name ` tips`): heading targets read them as spaces. */
const NOT_IN_WIKILINKS = /[#|^[\]]/g;

/** A heading as a wikilink names it, as in Obsidian: `# | ^ [ ]` become spaces, whitespace collapsed. */
export function wikilinkHeading(text: string): string {
  return text.replace(NOT_IN_WIKILINKS, ' ').replace(/\s+/g, ' ').trim();
}

/** Normalizes heading text for target comparison: case-insensitive, whitespace collapsed, `# | ^ [ ]` as spaces. */
export function headingKey(text: string): string {
  return wikilinkHeading(text).toLowerCase();
}

/**
 * Finds the heading addressed by a subpath (DESIGN §6.4): the last `#` segment, compared
 * case-insensitively with whitespace collapsed; the first match in document order wins.
 * `^blockid` subpaths address no heading in v1.
 */
export function findHeading<T extends { text: string }>(headings: T[], subpath: string): T | null {
  const last = subpath.split('#').pop() ?? '';
  if (last === '' || last.startsWith('^')) return null;
  const key = headingKey(last);
  return headings.find((h) => headingKey(h.text) === key) ?? null;
}
