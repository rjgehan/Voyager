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

describe('the tablet rail', () => {
  it('scrolls its page buttons when they do not fit, keeping Trash, Settings and the theme at the bottom', () => {
    const pages = declarations('styles/app.css', '.ribbon-group:first-child');
    expect(pages).toMatch(/overflow-y:\s*auto/);
    expect(pages).toMatch(/min-height:\s*0/);
    expect(declarations('styles/app.css', '.ribbon-group:last-child')).toMatch(/flex:\s*none/);
  });
});
