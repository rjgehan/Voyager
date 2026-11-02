// Renders a page of the user guide (DESIGN §6.45) read-only through the reading pipeline: anchors on
// headings as GitHub makes them, links between guide pages turned into Help routes, web links in a
// new tab, inert checkboxes. Guide links resolve against the guide, never the vault.
import pages from 'virtual:user-guide';
import type { FileEntry } from '../api/types';
import { renderNote, type RenderContext } from '../render/render';
import { hydrateRich } from '../render/rich';
import { guideLink, headingSlug, helpRoute, type GuidePages } from './guide';

export const guide: GuidePages = pages;

/** A stand-in file for a guide page, so the renderer marks links to it as resolved. */
function guideEntry(page: string): FileEntry {
  return { path: `${page}.md`, name: `${page}.md`, basename: page, extension: 'md', kind: 'note', size: 0, mtime: '', version: null, aliases: [] };
}

function renderContext(page: string): RenderContext {
  return {
    sourcePath: `${page}.md`,
    resolve: (target) => {
      const { page: linked } = guideLink(target, page);
      return linked !== null && linked in guide ? guideEntry(linked) : null;
    },
    rawUrl: () => '',
    // GitHub's rule for Markdown files: a single line break is a space.
    strictLineBreaks: true,
    loadRemoteImages: false,
    depth: 0,
  };
}

/** Renders a guide page into `el`: anchors on headings (`data-anchor`), links into Help, web links in a new tab. */
export function renderGuidePage(el: HTMLElement, page: string): void {
  const { fragment } = renderNote(guide[page] ?? '', renderContext(page));
  el.replaceChildren(fragment);
  const seen = new Map<string, number>();
  // `data-anchor`, not `id`: a page loaded with `#anchor` would otherwise be scrolled by the browser itself,
  // which moves the shell's overflow-hidden boxes too. HelpPage scrolls the pane to it.
  for (const h of el.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) h.dataset.anchor = headingSlug(h.textContent ?? '', seen);
  for (const a of el.querySelectorAll<HTMLAnchorElement>('a')) {
    if (a.classList.contains('internal-link')) {
      const target = guideLink(a.dataset.href ?? '', page);
      if (target.page !== null && target.page in guide) {
        a.classList.remove('is-unresolved');
        a.setAttribute('href', helpRoute(target.page, target.anchor));
        a.dataset.helpRoute = helpRoute(target.page, target.anchor);
      }
    } else if (a.classList.contains('external-link')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }
  for (const box of el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) box.disabled = true;
  hydrateRich(el);
}
