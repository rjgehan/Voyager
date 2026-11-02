// Colour contrast of the theme tokens (WCAG 2.2 AA 1.4.3 and 1.4.11, DESIGN §6.17, docs/ACCESSIBILITY.md):
// every text colour at least 4.5:1 on every background of its theme, and the colours that draw
// controls and the focus ring at least 3:1. The browser audit (`npm run test:a11y`) checks the
// rendered pages; this test keeps the tokens themselves from drifting.
import { beforeAll, describe, expect, it } from 'vitest';
import { sourceFiles } from '../test/sources';

type Rgba = [number, number, number, number];
type Theme = Record<string, string>;

let themes: Record<'dark' | 'light', Theme>;
/** rich.css: the callout colours, as Obsidian's `r, g, b` triples. */
let callouts: Record<'dark' | 'light', Theme>;

/** The custom properties of the first rule whose selector list is `selector`. */
function block(css: string, selector: string): Theme {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

beforeAll(async () => {
  const css = (await sourceFiles('tokens.css'))['styles/tokens.css'];
  themes = { dark: block(css, ":root[data-theme='dark'] {"), light: block(css, ":root[data-theme='light'] {") };
  const rich = (await sourceFiles('rich.css'))['styles/rich.css'];
  callouts = { dark: block(rich, ":root[data-theme='dark'] {"), light: block(rich, ":root[data-theme='light'] {") };
});

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }
  throw new Error(`Not a colour: ${value}`);
}

/** A translucent colour over an opaque one. */
function over(fg: Rgba, bg: Rgba): Rgba {
  return [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as Rgba;
}

function luminance(c: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `fg` on `bg` (both token names; a translucent `bg` lies over the primary background). */
function ratio(theme: Theme, fg: string, bg: string): number {
  const base = parse(theme['--background-primary']);
  const back = over(parse(theme[bg]), base);
  return contrast(over(parse(theme[fg]), back), back);
}

const BACKGROUNDS = ['--background-primary', '--background-primary-alt', '--background-secondary', '--background-secondary-alt', '--background-modifier-form-field'];
const TEXT = ['--text-normal', '--text-muted', '--text-faint', '--text-accent', '--link', '--link-unresolved', '--tag-fg', '--code-fg', '--text-error', '--text-warning', '--text-success'];
const SYNTAX = ['--tok-property', '--tok-keyword', '--tok-string', '--tok-number', '--tok-comment', '--tok-function', '--tok-type', '--tok-variable'];
/** Colours that draw a control's boundary or state (1.4.11): 3:1. */
const NON_TEXT = ['--focus-ring', '--checkbox-border', '--input-border', '--interactive-accent'];

function failures(theme: Theme, fgs: string[], bgs: string[], min: number): string[] {
  return fgs.flatMap((fg) => bgs.filter((bg) => ratio(theme, fg, bg) < min).map((bg) => `${fg} on ${bg}: ${ratio(theme, fg, bg).toFixed(2)}`));
}

describe.each(['dark', 'light'] as const)('the %s theme', (name) => {
  it('has every token this test checks', () => {
    const theme = themes[name];
    const missing = [...BACKGROUNDS, ...TEXT, ...SYNTAX, ...NON_TEXT, '--code-bg', '--tag-bg', '--text-on-accent', '--text-on-error', '--interactive-accent-hover', '--text-highlight-bg', '--text-selection'].filter((t) => !theme[t]);
    expect(missing).toEqual([]);
  });

  it('shows text at 4.5:1 or more on every background', () => {
    expect(failures(themes[name], TEXT, BACKGROUNDS, 4.5)).toEqual([]);
  });

  it('keeps text at 4.5:1 on hovered and selected rows, in the note and in the sidebars', () => {
    const theme = themes[name];
    const low = TEXT.flatMap((fg) =>
      ['--background-primary', '--background-secondary'].flatMap((base) =>
        ['--background-modifier-hover', '--background-modifier-active-hover'].flatMap((tint) => {
          const bg = over(parse(theme[tint]), parse(theme[base]));
          const r = contrast(parse(theme[fg]), bg);
          return r < 4.5 ? [`${fg} on ${tint} over ${base}: ${r.toFixed(2)}`] : [];
        }),
      ),
    );
    expect(low).toEqual([]);
  });

  it('shows code and syntax colours at 4.5:1 on code blocks and on the page', () => {
    expect(failures(themes[name], [...SYNTAX, '--text-normal', '--text-muted', '--text-faint'], ['--code-bg', '--background-primary'], 4.5)).toEqual([]);
  });

  it('keeps text readable on highlights, selections and tags', () => {
    const theme = themes[name];
    expect(ratio(theme, '--text-normal', '--text-highlight-bg')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, '--text-normal', '--text-selection')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, '--tag-fg', '--tag-bg')).toBeGreaterThanOrEqual(4.5);
  });

  it('puts readable text on the accent and on the error colour (buttons)', () => {
    const theme = themes[name];
    expect(ratio(theme, '--text-on-accent', '--interactive-accent')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, '--text-on-accent', '--interactive-accent-hover')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, '--text-on-error', '--text-error')).toBeGreaterThanOrEqual(4.5);
  });

  it('draws focus rings, checkboxes and field borders at 3:1 or more', () => {
    expect(failures(themes[name], NON_TEXT, ['--background-primary', '--background-secondary', '--background-modifier-form-field'], 3)).toEqual([]);
  });

  it('shows callout titles at 4.5:1 on the callout’s tinted background', () => {
    const page = parse(themes[name]['--background-primary']);
    const alpha = Number(callouts[name]['--callout-bg-alpha']);
    const colours = Object.entries(callouts[name]).filter(([k]) => k !== '--callout-bg-alpha');
    expect(colours.length).toBeGreaterThanOrEqual(7);
    const low = colours.flatMap(([k, v]) => {
      const [r, g, b] = v.split(',').map(Number);
      const ratioOnTint = contrast([r, g, b, 1], over([r, g, b, alpha], page));
      return ratioOnTint < 4.5 ? [`${k}: ${ratioOnTint.toFixed(2)}`] : [];
    });
    expect(low).toEqual([]);
  });
});

describe('the dark values', () => {
  it('are the defaults on :root, so the first paint has them too', async () => {
    const css = (await sourceFiles('tokens.css'))['styles/tokens.css'];
    expect(css).toContain(":root,\n:root[data-theme='dark'] {");
  });
});

describe('contrast()', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
    expect(contrast([118, 118, 118, 1], [255, 255, 255, 1])).toBeCloseTo(4.54, 2);
  });
});
