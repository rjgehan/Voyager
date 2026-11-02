// The user guide's structure (DESIGN §6.45): pages in the order the index lists them, their titles,
// GitHub's heading anchors, links between pages, and a small full-text search over the guide's
// sections. Pure, so the Help page and the tests share it; the pages come from `virtual:user-guide`.

export type GuidePages = Readonly<Record<string, string>>;

/** The guide's front page, `docs/guide/index.md`. */
export const INDEX = 'index';

/** The route of the Help page, or of one guide page (and a heading's anchor). */
export function helpRoute(page: string = INDEX, anchor?: string | null): string {
  return (page === INDEX ? '/x/help' : `/x/help/${encodeURIComponent(page)}`) + (anchor ? `#${encodeURIComponent(anchor)}` : '');
}

/** A page's title: its first `# ` heading, without inline markup; else its name. */
export function pageTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split('\n')) {
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) return stripInline(m[1]);
  }
  return fallback;
}

/** Heading text as it reads: code, emphasis, highlight and link markup removed. */
export function stripInline(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!|=~<>])/g, '$1')
    .trim();
}

/**
 * GitHub's anchor for a heading (github-slugger): lower case, everything but letters, marks,
 * numbers, `_`, `-` and spaces removed, spaces as `-`. Repeated slugs take `-1`, `-2`, …
 */
export function headingSlug(text: string, seen?: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
  if (!seen) return base;
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

export interface GuideHeading {
  level: number;
  text: string;
  slug: string;
  /** 0-based line of the heading in the page. */
  line: number;
}

/** The ATX headings of a page outside code blocks, with their GitHub anchors. */
export function pageHeadings(markdown: string): GuideHeading[] {
  const out: GuideHeading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;
  markdown.split('\n').forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return;
    }
    if (fence !== null) return;
    const h = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (!h) return;
    const text = stripInline(h[2]);
    out.push({ level: h[1].length, text, slug: headingSlug(text, seen), line: i });
  });
  return out;
}

export interface GuideLink {
  /** The guide page linked to, or null for a link that is not to a guide page. */
  page: string | null;
  anchor: string | null;
}

/**
 * Where a link written in a guide page goes: `other.md`, `other.md#anchor`, `#anchor` (this page),
 * `./other.md`. Web links and other files are not guide links (page null).
 */
export function guideLink(href: string, current: string): GuideLink {
  const trimmed = href.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) return { page: null, anchor: null };
  const hash = trimmed.indexOf('#');
  const target = hash < 0 ? trimmed : trimmed.slice(0, hash);
  const anchor = hash < 0 ? null : decodeURIComponent(trimmed.slice(hash + 1)) || null;
  if (target === '') return { page: current, anchor };
  const m = /^(?:\.\/)?([a-z0-9-]+)\.md$/i.exec(target);
  return m ? { page: m[1], anchor } : { page: null, anchor: null };
}

/** The Markdown links of a page outside code: `[text](href)`, href as written. */
export function pageLinks(markdown: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const text = line.replace(/`+[^`]*`+/g, '');
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) out.push(m[1]);
  }
  return out;
}

/**
 * The guide's pages in the order of the index's contents: the list items that start with a link to a
 * page (`- [Writing](writing.md): …`), not the links in its other text. Pages it does not list come
 * last, by name.
 */
export function pageOrder(pages: GuidePages): string[] {
  const order: string[] = [INDEX];
  for (const line of (pages[INDEX] ?? '').split('\n')) {
    const m = /^\s*[-*+]\s+\[[^\]]*\]\(([^)\s]+)\)/.exec(line);
    const page = m ? guideLink(m[1], INDEX).page : null;
    if (page && page in pages && !order.includes(page)) order.push(page);
  }
  for (const page of Object.keys(pages).sort()) if (!order.includes(page)) order.push(page);
  return order;
}

export interface GuideHit {
  page: string;
  pageTitle: string;
  /** The section's heading, or null for the text before the first heading under the title. */
  heading: string | null;
  anchor: string | null;
  snippet: string;
}

interface Section {
  page: string;
  heading: GuideHeading | null;
  text: string;
}

function sections(page: string, markdown: string): Section[] {
  const lines = markdown.split('\n');
  const headings = pageHeadings(markdown).filter((h) => h.level <= 3);
  const out: Section[] = [];
  const starts = [{ heading: null as GuideHeading | null, line: 0 }, ...headings.map((h) => ({ heading: h, line: h.line }))];
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].line : lines.length;
    const body = lines.slice(s.heading ? s.line + 1 : 0, end);
    if (!s.heading && body.every((l) => l.trim() === '')) return;
    // The text under the page's title is the page's introduction: a hit there opens the page's top.
    out.push({ page, heading: s.heading && s.heading.level > 1 ? s.heading : null, text: body.join('\n') });
  });
  return out;
}

/** Plain words of Markdown, for matching and snippets. */
function plain(text: string): string {
  return stripInline(text)
    .replace(/^\s*(?:[-*+]|\d+[.)]|>|\|)\s*/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\[!(\w+)\][+-]?/g, '')
    .replace(/[ \t]+/g, ' ');
}

/** The first line of `text` holding `word`, cut to about `max` characters around it. */
function snippetOf(text: string, word: string, max = 140): string {
  const lines = plain(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^[-:| ]+$/.test(l) && !/^(`{3,}|~{3,})/.test(l));
  const line = lines.find((l) => l.toLowerCase().includes(word)) ?? lines[0] ?? '';
  if (line.length <= max) return line;
  const at = Math.max(0, line.toLowerCase().indexOf(word) - Math.floor(max / 3));
  const cut = line.slice(at, at + max).trim();
  return (at > 0 ? '…' : '') + cut + (at + max < line.length ? '…' : '');
}

/**
 * The guide's sections holding every word of `query` (any case), best first: words in the page
 * title or the heading count most. At most `limit` hits.
 */
export function searchGuide(pages: GuidePages, query: string, limit = 30): GuideHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const order = pageOrder(pages);
  const hits: Array<GuideHit & { score: number; rank: number }> = [];
  order.forEach((page, rank) => {
    const markdown = pages[page];
    const title = pageTitle(markdown, page);
    for (const s of sections(page, markdown)) {
      const heading = s.heading?.text ?? null;
      const head = `${title} ${heading ?? ''}`.toLowerCase();
      const body = plain(s.text).toLowerCase();
      if (!words.every((w) => head.includes(w) || body.includes(w))) continue;
      const score = words.reduce((n, w) => n + ((heading ?? '').toLowerCase().includes(w) ? 4 : 0) + (title.toLowerCase().includes(w) ? 2 : 0) + (body.includes(w) ? 1 : 0), 0);
      hits.push({ page, pageTitle: title, heading, anchor: s.heading?.slug ?? null, snippet: snippetOf(s.text, words[0]), score, rank });
    }
  });
  hits.sort((a, b) => b.score - a.score || a.rank - b.rank);
  return hits.slice(0, limit).map(({ page, pageTitle: t, heading, anchor, snippet }) => ({ page, pageTitle: t, heading, anchor, snippet }));
}
