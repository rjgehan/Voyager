/**
 * The browser and the two devices the suite drives: the user's Windows PC (desktop Chrome) and
 * their iPhone (the Home-Screen app, emulated in Chrome at 390 × 844).
 *
 * The browser is the Chrome already installed (`channel: 'chrome'`), so nothing is downloaded. On a
 * machine without Chrome the suite falls back to the installed Edge (also Chromium); PW_CHANNEL
 * picks one explicitly (`chrome`, `msedge`, or `chromium` for Playwright's own build, which CI may
 * install instead).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function candidates(product: 'chrome' | 'msedge'): string[] {
  const env = process.env;
  if (process.platform === 'win32') {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter(Boolean) as string[];
    const rel = product === 'chrome' ? ['Google', 'Chrome', 'Application', 'chrome.exe'] : ['Microsoft', 'Edge', 'Application', 'msedge.exe'];
    return roots.map((r) => join(r, ...rel));
  }
  if (process.platform === 'darwin') {
    return [product === 'chrome' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  }
  return [product === 'chrome' ? '/opt/google/chrome/chrome' : '/opt/microsoft/msedge/msedge'];
}

/** The Playwright `channel` to launch: undefined means Playwright's bundled Chromium. */
export function browserChannel(): string | undefined {
  const asked = process.env.PW_CHANNEL;
  if (asked) return asked === 'chromium' ? undefined : asked;
  if (candidates('chrome').some((p) => existsSync(p))) return 'chrome';
  if (candidates('msedge').some((p) => existsSync(p))) return 'msedge';
  return 'chrome'; // Playwright then says it is missing and how to get it.
}

/** A device that has used the app before: dark theme (the app's default), nothing else stored. */
export const prefs = (theme: 'dark' | 'light' = 'dark') =>
  JSON.stringify({ theme, spellcheck: false, autocorrect: false, loadRemoteImages: false, offlineNotes: true, vimMode: false, syntaxVisibility: 'hide-all', scripts: 'auto' });

export const desktop = {
  viewport: { width: 1366, height: 860 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

/**
 * An iPhone 15-sized phone. Chrome is also told it has no hover and a coarse pointer, as the
 * phone has: without that, anything the app keeps for `@media (hover: hover)` would show.
 */
export const iphone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  launchOptions: {
    args: ['--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2'],
  },
};
