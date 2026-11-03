// Search matches and backlink contexts are lines of the indexed text (API.md §1.8), where a task's
// related note is a Markdown link with a percent-encoded path (`[Home renovation](/Projects/Home%20renovation.md)`).
// They are shown with each Markdown link as its label; the highlight ranges move with the text, and
// one inside a link's destination moves onto its label. Images and wikilinks stay as they are.
import type { TextRange } from '../api/types';

// `[label](dest "title")`, not `![alt](src)`; dest is `<...>` or has no spaces (balanced parentheses allowed).
const LINK = /(?<!!)\[([^[\]\n]*)\]\((?:<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g;

export function displaySnippet(text: string, ranges: readonly TextRange[]): { text: string; ranges: TextRange[] } {
  LINK.lastIndex = 0;
  if (!LINK.test(text)) return { text, ranges: [...ranges] };
  // Where each character of `text` ends up: [from, to) in the shown text (a removed character of a
  // link stands for the link's whole label).
  const spans: Array<[number, number]> = new Array(text.length);
  let out = '';
  let pos = 0;
  LINK.lastIndex = 0;
  for (let m = LINK.exec(text); m !== null; m = LINK.exec(text)) {
    for (; pos < m.index; pos++) {
      spans[pos] = [out.length, out.length + 1];
      out += text[pos];
    }
    const label = m[1];
    const labelStart = out.length;
    const labelEnd = labelStart + label.length;
    for (let i = 0; i < m[0].length; i++) {
      const inLabel = i >= 1 && i <= label.length;
      spans[m.index + i] = inLabel ? [labelStart + i - 1, labelStart + i] : [labelStart, labelEnd];
    }
    out += label;
    pos = m.index + m[0].length;
  }
  for (; pos < text.length; pos++) {
    spans[pos] = [out.length, out.length + 1];
    out += text[pos];
  }
  const mapped: TextRange[] = [];
  for (const r of ranges) {
    let from = Infinity;
    let to = -Infinity;
    for (let i = Math.max(0, r.from); i < Math.min(r.to, text.length); i++) {
      from = Math.min(from, spans[i][0]);
      to = Math.max(to, spans[i][1]);
    }
    if (to > from) mapped.push({ from, to });
  }
  return { text: out, ranges: mapped };
}
