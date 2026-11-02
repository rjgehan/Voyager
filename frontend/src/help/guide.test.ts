// The user guide's helpers, and the guide itself (docs/guide/*.md through `virtual:user-guide`):
// every page has a title and is in the index, every link between pages lands on a page and a
// heading that exist, and the anchors match what the Help page and GitHub make of the headings.
import pages from 'virtual:user-guide';
import { describe, expect, it } from 'vitest';
import { guideLink, headingSlug, helpRoute, INDEX, pageHeadings, pageLinks, pageOrder, pageTitle, searchGuide, stripInline } from './guide';
import { renderGuidePage } from './renderGuide';

interface NodeFs {
  existsSync(path: string): boolean;
}

async function nodeFs(): Promise<NodeFs> {
  const name = 'node:fs';
  return (await import(/* @vite-ignore */ name)) as NodeFs;
}

const cwd = () => (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

describe('guide helpers', () => {
  it('makes the Help routes', () => {
    expect(helpRoute()).toBe('/x/help');
    expect(helpRoute(INDEX, 'quick-answers')).toBe('/x/help#quick-answers');
    expect(helpRoute('tables-and-formulas', 'when-a-formula-shows-an-error')).toBe('/x/help/tables-and-formulas#when-a-formula-shows-an-error');
  });

  it('makes anchors as GitHub does', () => {
    expect(headingSlug('Add up a column: your first formula')).toBe('add-up-a-column-your-first-formula');
    expect(headingSlug('Tasks in notes')).toBe('tasks-in-notes');
    expect(headingSlug('The / menu: insert anything')).toBe('the--menu-insert-anything');
    expect(headingSlug('Ctrl+Alt+T opens a new tab instead of adding a task')).toBe('ctrlaltt-opens-a-new-tab-instead-of-adding-a-task');
    expect(headingSlug('My formula shows #NAME?')).toBe('my-formula-shows-name');
    expect(headingSlug('Über_cool 2026')).toBe('über_cool-2026');
    const seen = new Map<string, number>();
    expect(['Notes', 'Notes', 'Notes'].map((h) => headingSlug(h, seen))).toEqual(['notes', 'notes-1', 'notes-2']);
  });

  it('reads titles and headings without their markup, outside code', () => {
    expect(pageTitle('Intro\n\n# The **big** `=SUM` guide\n', 'x')).toBe('The big =SUM guide');
    expect(pageTitle('No heading', 'fallback')).toBe('fallback');
    expect(stripInline('Use [links](a.md) and *italic* and ==marks== and \\#hash')).toBe('Use links and italic and marks and #hash');
    const headings = pageHeadings('# Title\n\n```md\n## Not a heading\n```\n\n## Real `code` heading\n### Again\n## Again\n');
    expect(headings.map((h) => [h.level, h.text, h.slug])).toEqual([
      [1, 'Title', 'title'],
      [2, 'Real code heading', 'real-code-heading'],
      [3, 'Again', 'again'],
      [2, 'Again', 'again-1'],
    ]);
  });

  it('tells guide links from web links', () => {
    expect(guideLink('writing.md', 'index')).toEqual({ page: 'writing', anchor: null });
    expect(guideLink('./writing.md#code', 'index')).toEqual({ page: 'writing', anchor: 'code' });
    expect(guideLink('#locking', 'encryption')).toEqual({ page: 'encryption', anchor: 'locking' });
    expect(guideLink('https://github.com/rjgehan/notesapp', 'index')).toEqual({ page: null, anchor: null });
    expect(guideLink('../DESKTOP.md', 'index')).toEqual({ page: null, anchor: null });
    expect(pageLinks('[a](a.md) and `[b](b.md)`\n```\n[c](c.md)\n```\n[d](d.md#x)')).toEqual(['a.md', 'd.md#x']);
  });

  it('orders pages as the index lists them, unlisted ones last', () => {
    const index = ['See [A](a.md) first.', '', '- **Quick**: [C](c.md)', '- [B](b.md): the second', '- [A](a.md#x)', '* [B again](b.md)'].join('\n');
    expect(pageOrder({ index, a: '# A', b: '# B', c: '# C', z: '# Z' })).toEqual(['index', 'b', 'a', 'c', 'z']);
  });

  it('searches sections, best matches first', () => {
    const guide = {
      index: '# Guide\n\n[Writing](writing.md) [Tables](tables.md)',
      writing: '# Writing\n\n## Code\n\nType three backticks for a code block.\n\n## Lists\n\nA list mentions code once.',
      tables: '# Tables\n\n## Errors\n\n`#NAME?` means a function without brackets.',
    };
    const hits = searchGuide(guide, 'code');
    expect(hits.map((h) => [h.page, h.heading])).toEqual([
      ['writing', 'Code'],
      ['writing', 'Lists'],
    ]);
    expect(hits[0]).toMatchObject({ pageTitle: 'Writing', anchor: 'code', snippet: 'Type three backticks for a code block.' });
    expect(searchGuide(guide, '#name?')[0]).toMatchObject({ page: 'tables', anchor: 'errors' });
    expect(searchGuide(guide, 'code brackets')).toEqual([]);
    expect(searchGuide(guide, '   ')).toEqual([]);
  });
});

describe('the user guide', () => {
  const names = Object.keys(pages);
  const order = pageOrder(pages);

  it('has an index and the pages the help promises', () => {
    expect(names).toContain(INDEX);
    for (const page of ['getting-started', 'writing', 'links-and-tags', 'tables-and-formulas', 'spreadsheets', 'keyboard-shortcuts', 'troubleshooting']) expect(names).toContain(page);
  });

  it('gives every page a title and lists every page in the index', () => {
    for (const page of names) expect(pageTitle(pages[page], ''), page).not.toBe('');
    const linked = new Set(pageLinks(pages[INDEX]).map((href) => guideLink(href, INDEX).page));
    expect(names.filter((p) => p !== INDEX && !linked.has(p))).toEqual([]);
    expect(order).toHaveLength(names.length);
  });

  it('links only to pages and headings that exist', () => {
    const anchors = new Map(names.map((p) => [p, new Set(pageHeadings(pages[p]).map((h) => h.slug))]));
    const broken: string[] = [];
    for (const page of names) {
      for (const href of pageLinks(pages[page])) {
        if (/^https?:/.test(href)) continue;
        const { page: target, anchor } = guideLink(href, page);
        if (target === null || !anchors.has(target)) broken.push(`${page}: ${href}`);
        else if (anchor !== null && !anchors.get(target)!.has(anchor)) broken.push(`${page}: ${href} (no such heading)`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('links to repository documents that exist', async () => {
    const fs = await nodeFs();
    const missing: string[] = [];
    for (const page of names) {
      for (const href of pageLinks(pages[page])) {
        const m = /^https:\/\/github\.com\/rjgehan\/notesapp\/blob\/main\/(.+?)(#.*)?$/.exec(href);
        if (m && !fs.existsSync(`${cwd()}/../${m[1]}`)) missing.push(`${page}: ${href}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('gives headings the same anchors on the Help page as in the source', () => {
    for (const page of names) {
      const el = document.createElement('article');
      renderGuidePage(el, page);
      const rendered = [...el.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].map((h) => h.dataset.anchor);
      expect(rendered, page).toEqual(pageHeadings(pages[page]).map((h) => h.slug));
    }
  });

  it('answers the questions that started it', () => {
    expect(searchGuide(pages, 'code block').map((h) => h.page)).toContain('writing');
    expect(searchGuide(pages, 'google sheets').map((h) => h.page)).toContain('spreadsheets');
    expect(searchGuide(pages, '#NAME?').map((h) => h.page)).toContain('tables-and-formulas');
  });
});
