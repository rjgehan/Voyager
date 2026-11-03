import { defineConfig } from '@playwright/test';
import { WEB_URL } from './lib/api';
import { browserChannel, desktop, iphone, prefs } from './lib/device';

/**
 * Runs against the scratch stack that `npm run reset` starts (e2e/.run, ports 18570 and 5153),
 * never against a real vault: the suite creates, moves and deletes notes freely.
 *
 * Three projects: `api` (no browser), `desktop` (the Windows PC) and `iphone` (the Home-Screen app),
 * plus `screens`, which is not a test but the screen inventory behind `npm run screens`.
 * Every UI test runs on both devices unless its title says `@desktop` or `@phone`.
 */
const channel = browserChannel();
// The inventory wipes screens-output/ and takes minutes: it runs only when asked for by name
// (`npm run screens`), never as part of a bare `npx playwright test`.
// Workers load this file again without the command line, so the choice travels in the environment.
// Only a project selection counts (`--project=screens`, `--project screens`): a
// substring of any argument also matched a checkout under ".../screenshots/" or `--grep screenshare`.
const namesScreens = (value: string | undefined) => value?.split(',').includes('screens') ?? false;
const projectArgs = process.argv.flatMap((a, i, all) =>
  a.startsWith('--project=') ? [a.slice('--project='.length)] : a === '--project' ? [all[i + 1]] : [],
);
if (projectArgs.some(namesScreens)) process.env.E2E_SCREENS = '1';
const wantScreens = process.env.E2E_SCREENS === '1';
const device = (d: typeof desktop | typeof iphone) => ({
  ...d,
  baseURL: WEB_URL,
  channel,
  // Dates and day names in the tests are written in US English, whatever the machine's language.
  locale: 'en-US',
  // Service workers would cache the app between tests; the suite tests the page itself.
  serviceWorkers: 'block' as const,
  storageState: {
    cookies: [],
    origins: [{ origin: new URL(WEB_URL).origin, localStorage: [{ name: 'notesapp:prefs', value: prefs('dark') }] }],
  },
});

export default defineConfig({
  testDir: './tests',
  // One vault for everything; tests use unique names, but live sync and the bookmark list are
  // shared, so keep runs serial and predictable.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  globalSetup: './lib/global-setup.ts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  // Each project by its folder, not by a pattern: testMatch is matched against the absolute path,
  // so a pattern like /ui\/.*\.spec\.ts/ also matched every spec of a checkout under ".../mobile-ui/".
  projects: [
    { name: 'api', testDir: './tests/api' },
    { name: 'desktop', testDir: './tests/ui', grepInvert: /@phone/, use: device(desktop) },
    { name: 'iphone', testDir: './tests/ui', grepInvert: /@desktop/, use: device(iphone) },
    ...(wantScreens ? [{ name: 'screens', testDir: './tests/screens', use: device(iphone), timeout: 600_000 }] : []),
  ],
});
