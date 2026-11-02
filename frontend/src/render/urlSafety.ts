// What rendered note HTML may load and draw (DESIGN §5.14 #7, §6.7): note text, clipped pages,
// script output and AI answers are untrusted. The checks resolve URLs the way the browser will,
// instead of matching their spelling: `https:\\host`, `/\host` and a srcset's later candidates
// all load from another site, and CSS escapes, comments and `var()` can spell any property or
// function. The CSP allows `https:` images and media, so these checks are what keeps "Load remote
// images: off" (and the promise that a script's output loads nothing) true.

/** True when loading `value` (a src, href, poster, …) would fetch from another origin than the page's. */
export function isRemoteUrl(value: string, base: string = document.baseURI): boolean {
  const v = value.trim();
  if (v === '') return false;
  let url: URL;
  try {
    url = new URL(v, base);
  } catch {
    // The browser would not load it either, but it is not worth keeping.
    return true;
  }
  if (url.protocol === 'data:') return false;
  return url.origin !== new URL(base).origin;
}

/** The CSS functions that load a resource, with their argument (unquoted, up to a quote or `)`). */
const CSS_LOADER = /(url|image-set|image|cross-fade|element|src)\s*\(\s*['"]?([^'")]*)/gi;

/** `url(#id)` and inline raster images load nothing from the network. */
function isLocalCssUrl(arg: string): boolean {
  const a = arg.trim();
  return a.startsWith('#') || /^data:image\/(?:png|gif|jpeg|webp);/i.test(a);
}

/** True when CSS text would load something from the network: a `url()` other than `#id` or an inline raster image, or any other image function. */
export function cssLoadsRemote(css: string): boolean {
  for (const m of css.matchAll(CSS_LOADER)) {
    if (m[1].toLowerCase() === 'url' && isLocalCssUrl(m[2])) continue;
    return true;
  }
  return false;
}

/** CSS text with its escapes resolved and its comments removed, as the browser's tokenizer reads it. */
export function decodeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')
    .replace(/\\(?:([0-9a-f]{1,6})\s?|\r\n|\n|([\s\S]))/gi, (_m, hex: string | undefined, ch: string | undefined) => {
      if (hex) {
        const cp = parseInt(hex, 16);
        return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : '�';
      }
      return ch ?? '';
    });
}

const PROPERTY = /^-?[a-z][a-z0-9-]*$/;
const INDIRECT = /(?:var|attr|env|if)\s*\(/;

/**
 * An inline `style` without what note HTML must not do: `position: fixed|sticky` and `z-index`
 * (drawing over the app), custom properties and `var()`, `attr()`, `env()` or `if()` (a value the
 * checks cannot see), CSS escapes and comments (a spelling the checks cannot see), and, with
 * `blockRemote`, anything that loads from the network. Declarations are kept or dropped whole;
 * the result never holds a declaration the checks did not see as it is.
 */
export function safeInlineStyle(style: string, blockRemote: boolean): string {
  const kept: string[] = [];
  for (const part of style.split(';')) {
    const decl = part.trim();
    if (decl === '' || decl.includes('\\') || decl.includes('/*') || decl.includes('*/')) continue;
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim().toLowerCase();
    if (!PROPERTY.test(prop) || INDIRECT.test(value)) continue;
    if (prop === 'z-index') continue;
    if (prop === 'position' && /fixed|sticky/.test(value)) continue;
    if (blockRemote && cssLoadsRemote(value)) continue;
    kept.push(decl);
  }
  return kept.join(';');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG attributes that hold text or names, never CSS. */
const SVG_TEXT_ATTRIBUTES = /^(?:aria-.*|data-.*|id|class|title|role|lang|xml:lang|alt|name)$/i;

/**
 * True when an SVG attribute would load from the network: presentation attributes are CSS
 * (`fill="url(https://…)"`, `filter`, `mask`, `clip-path`, `marker-*`, `cursor`), escapes included.
 * `style` and the `href`s are checked on their own.
 */
export function svgAttributeLoads(name: string, value: string): boolean {
  if (name === 'style' || name === 'href' || name === 'xlink:href' || SVG_TEXT_ATTRIBUTES.test(name)) return false;
  return value.includes('\\') || cssLoadsRemote(value);
}

/** Attributes whose URL the browser loads by itself (links, `<a href>`, are followed only on a click). */
const LOADING_ATTRIBUTES = ['src', 'poster', 'background', 'data', 'lowsrc', 'dynsrc'];

/**
 * Removes everything under `root` that would load from another origin by itself: remote `src`,
 * `poster`, `background` and `data`, every `srcset` (its candidates are not worth parsing), remote
 * `href`s of SVG images, uses and filters (not of links), and SVG presentation attributes that load
 * (`fill="url(https://…)"`). Inline styles are left to `safeInlineStyle`.
 */
export function removeRemoteLoads(root: ParentNode): void {
  for (const el of root.querySelectorAll('*')) {
    el.removeAttribute('srcset');
    for (const name of LOADING_ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value !== null && isRemoteUrl(value)) el.removeAttribute(name);
    }
    if (el.localName !== 'a') {
      for (const name of ['href', 'xlink:href']) {
        const value = el.getAttribute(name);
        if (value !== null && isRemoteUrl(value)) el.removeAttribute(name);
      }
    }
    if (el.namespaceURI === SVG_NS) {
      for (const attr of [...el.attributes]) {
        if (svgAttributeLoads(attr.name, attr.value)) el.removeAttribute(attr.name);
      }
    }
  }
}
