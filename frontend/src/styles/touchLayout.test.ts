// Guards for the iPhone and iPad layout (DESIGN §6.16): safe areas, the rail that scrolls when its
// buttons do not fit. Vitest has no layout engine, so these read the stylesheets.
import { beforeAll, describe, expect, it } from 'vitest';
import { sourceFiles } from '../test/sources';

let sheets: Record<string, string> = {};

const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

beforeAll(async () => {
  const files = await sourceFiles('.css');
  sheets = Object.fromEntries(Object.entries(files).map(([file, css]) => [file, uncommented(css)]));
});

/** The declarations of every rule (inside @media too) that lists `selector`, joined. */
function declarations(file: string, selector: string): string {
  const out: string[] = [];
  for (const m of sheets[file].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) out.push(m[2]);
  }
  return out.join('\n');
}

interface Rule {
  selectors: string[];
  body: string;
  /** The preludes of the at-rules around it, outermost first: `@media (hover: hover)`. */
  context: string[];
}

/** Every style rule of a stylesheet with the at-rules it sits in. */
function rules(file: string): Rule[] {
  const css = sheets[file];
  const out: Rule[] = [];
  const context: string[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      const prelude = css.slice(start, i).trim();
      if (prelude.startsWith('@')) {
        context.push(prelude.replace(/\s+/g, ' '));
        start = i + 1;
      } else {
        const end = css.indexOf('}', i);
        out.push({ selectors: prelude.split(',').map((s) => s.trim()), body: css.slice(i + 1, end), context: [...context] });
        i = end;
        start = end + 1;
      }
    } else if (css[i] === '}') {
      context.pop();
      start = i + 1;
    } else if (css[i] === ';' && context.length === 0) {
      start = i + 1;
    }
  }
  return out;
}

/** The declarations of the rules that list `selector` inside an at-rule whose prelude is `at`. */
function declarationsIn(file: string, at: string, selector: string): string {
  return rules(file)
    .filter((r) => r.context.includes(at) && r.selectors.includes(selector))
    .map((r) => r.body)
    .join('\n');
}

describe('safe areas', () => {
  it('the drawer and the side panels keep their footers above the home indicator', () => {
    expect(declarations('styles/app.css', '.overlay-left .overlay-panel')).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/);
    expect(declarations('styles/app.css', '.overlay-right .overlay-panel')).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  });

  it('the bottom sheet keeps its tabs and content off the notch of a phone on its side', () => {
    expect(declarations('styles/app.css', '.overlay-bottom .overlay-panel')).toMatch(
      /padding:\s*0 env\(safe-area-inset-right\) env\(safe-area-inset-bottom\) env\(safe-area-inset-left\)/,
    );
  });

  it('above the keyboard the panels drop the home indicator’s inset', () => {
    expect(declarations('styles/app.css', '.keyboard-open .overlay-panel')).toMatch(/padding-bottom:\s*0/);
  });

  it('a long ⋯ menu scrolls instead of running under the home indicator or off a short screen', () => {
    const more = declarations('styles/features.css', '.top-bar .menu');
    expect(more).toMatch(/max-height:\s*calc\(var\(--vvh, 100dvh\) - var\(--header-height\) - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\) - 12px\)/);
    expect(more).toMatch(/overflow-y:\s*auto/);
    expect(declarations('styles/features.css', '.context-menu')).toMatch(/env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)/);
  });

  it('the / menu docks above the editing toolbar, whose height includes the home indicator until the keyboard opens', () => {
    const slash = '.cm-editor .cm-tooltip.cm-tooltip-autocomplete.cm-slash-menu';
    expect(declarations('styles/editor.css', slash)).toMatch(/top:\s*calc\(var\(--vv-top, 0px\) \+ var\(--vvh, 100dvh\) - 56px - env\(safe-area-inset-bottom\)\) !important/);
    expect(declarations('styles/editor.css', `.keyboard-open ${slash}`)).toMatch(/top:\s*calc\(var\(--vv-top, 0px\) \+ var\(--vvh, 100dvh\) - 56px\) !important/);
    expect(declarations('styles/mobile.css', '.keyboard-open .mobile-toolbar')).toMatch(/padding-bottom:\s*0/);
  });

  it('full-screen dialogs on a phone keep clear of the notch on either side', () => {
    const sheet = declarations('styles/features.css', '.modal-sheet .modal-panel');
    expect(sheet).toMatch(/padding-left:\s*env\(safe-area-inset-left\)/);
    expect(sheet).toMatch(/padding-right:\s*env\(safe-area-inset-right\)/);
    expect(declarations('styles/features.css', '.modal')).toMatch(/max\(12px, env\(safe-area-inset-left\)\)/);
  });
});

describe('text fields on a touch screen', () => {
  /** The bodies of the rules inside `@media (pointer: coarse)` and `@supports (-webkit-touch-callout: none)` blocks of mobile.css. */
  function floorRules(): string[] {
    const css = sheets['styles/mobile.css'];
    const out: string[] = [];
    for (const m of css.matchAll(/@(?:media \(pointer: coarse\)|supports \(-webkit-touch-callout: none\))\s*\{\s*([^{}]+)\{([^{}]*)\}\s*\}/g)) {
      if (/font-size/.test(m[2])) out.push(`${m[1].replace(/\s+/g, ' ').trim()} { ${m[2].trim()} }`);
    }
    return out;
  }

  it('are at least 16 px whatever their class or inherited size, so iOS never zooms into them', () => {
    const rules = floorRules();
    // Once for a touch screen, once for iOS with a trackpad.
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule).toMatch(/^:is\( input:not\(\[type='checkbox'\], \[type='radio'\], \[type='range'\]/);
      expect(rule).toMatch(/textarea, select \)/);
      expect(rule).toMatch(/font-size: max\(16px, 1em\) !important;/);
      // What sizes itself to what it edits keeps its size.
      expect(rule).toMatch(/:not\(\.excalidraw \*, \.annotationLayer \*\)/);
    }
  });

  it('no other rule forces a field’s size, so the floor is never outranked', () => {
    const forced = Object.entries(sheets).flatMap(([file, css]) =>
      file === 'styles/mobile.css' ? [] : [...css.matchAll(/font(-size)?:[^;{}]*!important/g)].map((m) => `${file}: ${m[0]}`),
    );
    expect(forced).toEqual([]);
  });
});

describe('scrolling', () => {
  it('a table in a note scrolls sideways only, so a vertical swipe on it scrolls the note', () => {
    const table = declarations('styles/editor.css', '.cm-lp-table-scroll');
    expect(table).toMatch(/overflow-x:\s*auto/);
    expect(table).toMatch(/overflow-y:\s*hidden/);
  });

  it('a panel that does not scroll a list of its own (the calendar) scrolls in the sheet or sidebar', () => {
    const body = declarations('styles/app.css', '.panel-body');
    expect(body).toMatch(/min-height:\s*0/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });
});

describe('hover and touch', () => {
  // On iOS a tap leaves :hover on until the next tap: a top bar button stayed highlighted after the
  // switcher it opened had closed.
  const shared = [
    ['styles/app.css', ['.ribbon-button:hover', '.icon-button:hover', '.panel-tab:hover', '.tree-row:hover', '.outline-item:hover', '.button:hover', '.button-primary:hover', '.menu-item:hover', '.link-button:hover']],
    ['styles/features.css', ['.button-danger:hover', '.search-hit-title:hover', '.tag-row:hover', '.history-row:hover', '.settings-nav-item:hover', '.timeline-file-main:hover', '.backlink-block:hover']],
  ] as const;

  it.each(shared)('the shared controls of %s highlight on hover only where there is a hover', (file, selectors) => {
    for (const selector of selectors) {
      const found = rules(file).filter((r) => r.selectors.includes(selector));
      expect(found.length, selector).toBeGreaterThan(0);
      for (const rule of found) expect(rule.context, selector).toContain('@media (hover: hover)');
    }
  });

  it('a press shows on a touch screen instead', () => {
    expect(declarationsIn('styles/mobile.css', '@media (hover: none)', '.icon-button:not(:disabled):active')).toMatch(/background:/);
    expect(declarationsIn('styles/mobile.css', '@media (hover: none)', '.button-primary:not(:disabled):active')).toMatch(/--interactive-accent-hover/);
  });

  it('switches are the size of iOS’s, with a 44 px touch area', () => {
    const coarse = '@media (pointer: coarse)';
    expect(declarationsIn('styles/mobile.css', coarse, '.toggle')).toMatch(/width:\s*51px;[\s\S]*height:\s*31px/);
    expect(declarationsIn('styles/mobile.css', coarse, '.toggle::after')).toMatch(/inset:\s*-7px -4px/);
    expect(declarationsIn('styles/mobile.css', coarse, '.toggle.is-on .toggle-knob')).toMatch(/translateX\(20px\)/);
  });

  it('segmented controls and the panel tabs are 44 px targets; tabs that do not fit scroll', () => {
    const coarse = '@media (pointer: coarse)';
    expect(declarationsIn('styles/mobile.css', coarse, '.segmented button')).toMatch(/min-height:\s*40px/);
    expect(declarationsIn('styles/mobile.css', coarse, '.panel-tab')).toMatch(/flex:\s*none/);
    expect(declarationsIn('styles/mobile.css', coarse, '.panel-tab-strip')).toMatch(/overflow-x:\s*auto/);
  });

  it('phones hide the key hints of the switcher and the palette', () => {
    expect(declarationsIn('styles/mobile.css', '@media (max-width: 767px), (max-height: 500px) and (pointer: coarse)', '.picker-kbd')).toMatch(/display:\s*none/);
  });
});

describe('the tablet rail', () => {
  it('scrolls its page buttons when they do not fit, keeping Trash, Settings and the theme at the bottom', () => {
    const pages = declarations('styles/app.css', '.ribbon-group:first-child');
    expect(pages).toMatch(/overflow-y:\s*auto/);
    expect(pages).toMatch(/min-height:\s*0/);
    expect(declarations('styles/app.css', '.ribbon-group:last-child')).toMatch(/flex:\s*none/);
  });
});
