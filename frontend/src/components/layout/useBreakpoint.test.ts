// The phone layout (DESIGN §6.16) covers a phone on its side: an iPhone in landscape is 812–956 px
// wide, which used to give it the tablet layout, whose icon rail cannot fit 20 buttons in 390 px.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isPhoneLayout, PHONE_QUERY } from '../../features/platform';
import { sourceFiles } from '../../test/sources';
import { currentBreakpoint } from './useBreakpoint';

interface Screen {
  width: number;
  height: number;
  coarse: boolean;
}

/** Evaluates the media queries the app uses: `a and b, c` with width, height and pointer features. */
function evaluate(query: string, screen: Screen): boolean {
  return query.split(',').some((alternative) =>
    alternative
      .trim()
      .split(/\s+and\s+/)
      .every((feature) => {
        const m = /^\((min|max)-(width|height):\s*(\d+)px\)$/.exec(feature.trim());
        if (m) {
          const value = m[2] === 'width' ? screen.width : screen.height;
          return m[1] === 'min' ? value >= Number(m[3]) : value <= Number(m[3]);
        }
        const pointer = /^\(pointer:\s*(coarse|fine)\)$/.exec(feature.trim());
        if (pointer) return (pointer[1] === 'coarse') === screen.coarse;
        throw new Error(`unexpected media feature ${feature}`);
      }),
  );
}

function useScreen(screen: Screen): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: evaluate(query, screen),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the layout for a screen', () => {
  it.each([
    ['an iPhone upright', { width: 390, height: 844, coarse: true }, 'phone'],
    ['an iPhone on its side', { width: 844, height: 390, coarse: true }, 'phone'],
    ['a large iPhone on its side', { width: 956, height: 440, coarse: true }, 'phone'],
    ['an iPad upright', { width: 820, height: 1180, coarse: true }, 'tablet'],
    ['an iPad on its side', { width: 1180, height: 820, coarse: true }, 'tablet'],
    ['a short desktop window', { width: 900, height: 400, coarse: false }, 'tablet'],
    ['a desktop window', { width: 1440, height: 900, coarse: false }, 'desktop'],
  ] as const)('%s is %s', (_name, screen, expected) => {
    useScreen(screen);
    expect(currentBreakpoint()).toBe(expected);
    expect(isPhoneLayout()).toBe(expected === 'phone');
  });
});

describe('the stylesheets’ phone rules', () => {
  let sheets: Record<string, string> = {};
  beforeAll(async () => {
    sheets = await sourceFiles('.css');
  });

  it('use the same media query as the layout, so a phone on its side gets them too', () => {
    const phoneQueries = Object.entries(sheets).flatMap(([file, css]) =>
      [...css.matchAll(/@media ([^{]*max-width:\s*767px[^{]*)\{/g)].map((m) => ({ file, query: m[1].trim() })),
    );
    expect(phoneQueries.length).toBeGreaterThan(10);
    expect(phoneQueries.filter((q) => q.query !== PHONE_QUERY)).toEqual([]);
  });
});
