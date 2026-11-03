// Kept apart from markdown.ts so that note.ts (in the Shortcut page and the extension's settings)
// does not pull in turndown.
const URL_ESCAPES: Record<string, string> = { ' ': '%20', '(': '%28', ')': '%29' };

/** `(` and `)` and spaces in a URL would end the destination (encodeURIComponent leaves parentheses alone). */
export function markdownUrl(url: string): string {
  return url.replace(/[ ()]/g, (c) => URL_ESCAPES[c]);
}
