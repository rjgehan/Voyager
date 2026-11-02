// Sanitizers for the output of the rich renderers (DESIGN §5.14 #7, §6.7). KaTeX (trust off) and
// Mermaid (securityLevel 'strict') already escape what they render; these are the second layer, and
// the only one the app controls. Each returns a DOM fragment, so the sanitized markup is never
// serialized and parsed again (no mutation-XSS window). The note HTML sanitizer in render.ts is
// separate: it forbids `<style>`, which Mermaid's SVG needs.
import DOMPurify from 'dompurify';
import { cssLoadsRemote, decodeCss, isRemoteUrl, safeInlineStyle, svgAttributeLoads } from '../urlSafety';

type Purifier = ReturnType<typeof DOMPurify>;

const REMOTE = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const CSS_REMOTE_URL = /url\(\s*(['"]?)\s*(?!#|data:image\/(?:png|gif|jpeg|webp);)[^)]*\)/gi;

/** As for note HTML (urlSafety.ts): no `position: fixed|sticky`, `z-index`, indirection or escapes, and nothing remote. */
function cleanStyleAttribute(node: Element): void {
  const style = node.getAttribute('style');
  if (!style) return;
  const cleaned = safeInlineStyle(style, true);
  if (cleaned) node.setAttribute('style', cleaned);
  else node.removeAttribute('style');
}

/**
 * A diagram's own stylesheet without `@import` and remote `url()`s. Should what is left still load
 * something once its escapes and comments are read as the browser reads them, the whole stylesheet
 * goes: the diagram loses its colours, never its privacy.
 */
export function cleanStylesheet(css: string): string {
  const cleaned = css.replace(/@import[^;]*;?/gi, '').replace(CSS_REMOTE_URL, 'none');
  const decoded = decodeCss(cleaned);
  return /@import/i.test(decoded) || cssLoadsRemote(decoded) ? '' : cleaned;
}

let mathPurifier: Purifier | null = null;

/** KaTeX output: HTML and MathML (with KaTeX's inline SVG for stretchy symbols). No links, images or styles. */
export function sanitizeMath(html: string): DocumentFragment {
  if (!mathPurifier) {
    mathPurifier = DOMPurify(window);
    mathPurifier.addHook('afterSanitizeAttributes', cleanStyleAttribute);
  }
  return mathPurifier.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    // KaTeX's MathML keeps the TeX source in <semantics><annotation encoding="application/x-tex">.
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: ['encoding'],
    FORBID_TAGS: ['a', 'img', 'image', 'style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'foreignobject', 'use'],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
}

let svgPurifier: Purifier | null = null;

/**
 * Mermaid output: SVG with its scoped `<style>` and, for HTML labels, `<foreignObject>` HTML.
 * Remote references (`<image href="https://…">`, `url(https://…)`) are dropped, so a diagram never
 * fetches from other hosts; `<a>` is unwrapped (strict mode has no links, this makes sure).
 */
export function sanitizeSvg(svg: string): DocumentFragment {
  if (!svgPurifier) {
    svgPurifier = DOMPurify(window);
    svgPurifier.addHook('afterSanitizeAttributes', (node) => {
      if (!(node instanceof Element)) return;
      cleanStyleAttribute(node);
      for (const name of ['href', 'xlink:href', 'src']) {
        const value = node.getAttribute(name);
        if (value !== null && (REMOTE.test(value) || isRemoteUrl(value))) node.removeAttribute(name);
      }
      // Presentation attributes are CSS too: fill="url(https://…)" loads.
      for (const attr of [...node.attributes]) {
        if (svgAttributeLoads(attr.name, attr.value)) node.removeAttribute(attr.name);
      }
    });
    svgPurifier.addHook('uponSanitizeElement', (node, data) => {
      // CSS inside the SVG's own <style>: no remote url(), no @import.
      if (data.tagName === 'style' && node.textContent) {
        node.textContent = cleanStylesheet(node.textContent);
      }
    });
  }
  return svgPurifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject', 'style'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ['a', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'img'],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
}
