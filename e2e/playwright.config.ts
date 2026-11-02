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
const device = (d: typeof desktop | typeof iphone) => ({
  ...d,
  baseURL: WEB_URL,
  channel,
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
  projects: [
    { name: 'api', testMatch: /api\/.*\.spec\.ts/ },
    { name: 'desktop', testMatch: /ui\/.*\.spec\.ts/, grepInvert: /@phone/, use: device(desktop) },
    { name: 'iphone', testMatch: /ui\/.*\.spec\.ts/, grepInvert: /@desktop/, use: device(iphone) },
    { name: 'screens', testMatch: /screens\/.*\.spec\.ts/, use: device(iphone), timeout: 600_000 },
  ],
});
