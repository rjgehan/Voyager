// axe-core in the unit tests (docs/ACCESSIBILITY.md): the WCAG 2.2 A and AA rules that work without
// layout. jsdom lays nothing out, so colour contrast, target sizes and reflow are left to the
// browser audit (`npm run test:a11y`) and the token test (styles/contrast.test.ts).
import axe from 'axe-core';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Rules that need a real layout or a real document (jsdom's has no `lang` or title). */
const LAYOUT = ['color-contrast', 'target-size', 'scrollable-region-focusable', 'document-title', 'html-has-lang'];
/** Rules about a whole page (landmarks, one main heading), off for a component on its own. */
const PAGE = ['region', 'landmark-one-main', 'page-has-heading-one', 'bypass', 'landmark-complementary-is-top-level', 'landmark-no-duplicate-main'];

interface Options {
  /** The whole app shell is rendered: check the page rules too. */
  page?: boolean;
  /** More rules to leave out, each with a reason at the call site. */
  disable?: string[];
}

/** The violations axe finds in `root`, one line each: `rule: target (help)`. */
export async function axeViolations(root: Element = document.body, { page = false, disable = [] }: Options = {}): Promise<string[]> {
  const off = [...LAYOUT, ...(page ? [] : PAGE), ...disable];
  const results = await axe.run(root, {
    runOnly: { type: 'tag', values: TAGS },
    rules: Object.fromEntries(off.map((id) => [id, { enabled: false }])),
    resultTypes: ['violations'],
  });
  return results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} (${v.help})`));
}
