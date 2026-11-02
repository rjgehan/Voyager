// The demo's banner (DESIGN §6.46): one slim line above the app saying that everything runs in this
// browser tab and nothing is saved, with a link to the repository. Plain DOM, so it shows before
// React renders; closing it gives the app its full height back for this page load.
import { REPO_URL } from './mode';
import './demo.css';

export const BANNER_CLASS = 'has-demo-banner';

export function showDemoBanner(doc: Document = document): HTMLElement {
  const bar = doc.createElement('div');
  bar.className = 'demo-banner';
  bar.setAttribute('role', 'note');
  const text = doc.createElement('span');
  text.className = 'demo-banner-text';
  text.textContent = 'Demo: runs in your browser, nothing is saved.';
  const link = doc.createElement('a');
  link.className = 'demo-banner-link';
  link.href = REPO_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Source on GitHub';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'demo-banner-close';
  close.setAttribute('aria-label', 'Hide the demo banner');
  close.textContent = '×';
  close.addEventListener('click', () => {
    bar.remove();
    doc.body.classList.remove(BANNER_CLASS);
    // Layouts measure the window; tell them the app's box changed.
    window.dispatchEvent(new Event('resize'));
  });
  bar.append(text, link, close);
  doc.body.prepend(bar);
  doc.body.classList.add(BANNER_CLASS);
  return bar;
}
