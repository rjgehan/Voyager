// Note HTML stays inside the note (DESIGN §5.14 #7): wherever the app shows rendered note HTML,
// a `contain: paint` box clips it, so a style the sanitizer missed still cannot draw a fake app UI
// over the page (security audit).
import { beforeAll, describe, expect, it } from 'vitest';
import { sourceFiles } from '../test/sources';

let reading = '';
let editor = '';

const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

beforeAll(async () => {
  const files = await sourceFiles('.css');
  reading = uncommented(files['styles/reading.css']);
  editor = uncommented(files['styles/editor.css']);
});

function body(sheet: string, selector: string): string {
  for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) return m[2];
  }
  return '';
}

describe('containment of rendered note HTML', () => {
  it('clips the reading pipeline and transcluded notes', () => {
    expect(body(reading, '.markdown-rendered')).toMatch(/contain:\s*paint/);
    expect(body(reading, '.markdown-embed')).toMatch(/contain:\s*paint/);
  });

  it('clips a callout in Live Preview, where the rich block itself is not contained', () => {
    expect(body(editor, '.cm-lp-rich.markdown-rendered')).toMatch(/contain:\s*none/);
    expect(body(editor, '.cm-lp-rich .callout')).toMatch(/contain:\s*paint/);
  });
});
