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

  it('full-screen dialogs on a phone keep clear of the notch on either side', () => {
    const sheet = declarations('styles/features.css', '.modal-sheet .modal-panel');
    expect(sheet).toMatch(/padding-left:\s*env\(safe-area-inset-left\)/);
    expect(sheet).toMatch(/padding-right:\s*env\(safe-area-inset-right\)/);
    expect(declarations('styles/features.css', '.modal')).toMatch(/max\(12px, env\(safe-area-inset-left\)\)/);
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
