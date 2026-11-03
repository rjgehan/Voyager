#!/usr/bin/env node
/*
 * Renders the pictures that show the app's name (BRAND.md) from the live demo build:
 *
 *   docs/images/social-preview.png  1280×640: the icon, the name, the pitch and the Trip to Lisbon note
 *                                   (the repository's social preview and the demo's og:image)
 *   docs/images/light-theme.webp    the Welcome note in the light theme, outline open (README gallery)
 *   docs/images/drawing.webp        the demo's System sketch drawing (README gallery)
 *
 *   cd frontend && npm run build:demo && npx vite preview --mode demo --port 5230
 *   node scripts/brand/render-images.mjs [http://127.0.0.1:5230/notesapp/]
 *
 * Screenshots are 1280×800 at device scale 1.5 (1920 px wide), as the rest of the gallery; WebP is
 * encoded by the browser itself. It uses e2e/'s Playwright (npm ci there first) with the installed
 * Edge or Chrome (PW_CHANNEL picks one). The other gallery images show no name and are left alone.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const base = (process.argv[2] ?? 'http://127.0.0.1:5230/notesapp/').replace(/\/?$/, '/');
const { chromium } = createRequire(join(repo, 'e2e', 'package.json'))('@playwright/test');

const PREFS = (theme) => JSON.stringify({ theme, spellcheck: false, autocorrect: false, loadRemoteImages: false, offlineNotes: true, vimMode: false, syntaxVisibility: 'hide-all', scripts: 'auto' });
const UI = (rightOpen) => JSON.stringify({ state: { leftOpen: false, rightOpen, rightTab: 'outline' }, version: 1 });

async function launch() {
  const asked = process.env.PW_CHANNEL;
  const channels = asked ? [asked === 'chromium' ? undefined : asked] : ['msedge', 'chrome', undefined];
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel });
    } catch (e) {
      if (channel === channels.at(-1)) throw e;
    }
  }
}

const browser = await launch();

/** A fresh demo tab at 1280×800 (scale 1.5) with the theme and sidebars set, showing `path`. */
async function open(path, { theme, rightOpen, scale = 1.5, width = 1280, height = 800 }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale: 'en-US', colorScheme: theme });
  await context.addInitScript(([prefs, ui]) => {
    if (!sessionStorage.getItem('voyager-shot')) {
      localStorage.setItem('notesapp:prefs', prefs);
      localStorage.setItem('notesapp:ui', ui);
      sessionStorage.setItem('voyager-shot', '1');
    }
  }, [PREFS(theme), UI(rightOpen)]);
  const page = await context.newPage();
  await page.goto(base + path);
  await page.locator('.demo-banner-close').click();
  await page.locator('.status-bar, [class*="status"]').first().waitFor();
  await page.waitForTimeout(2500);
  return { page, context };
}

async function webp(page, png, quality) {
  return page.evaluate(
    async ({ data, quality }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', quality).split(',')[1];
    },
    { data: png.toString('base64'), quality },
  );
}

function write(rel, bytes) {
  writeFileSync(join(repo, rel), bytes);
  console.log(`${String(bytes.length).padStart(8)} B  ${rel}`);
}

// ---------------------------------------------------------------- the README gallery

{
  const { page, context } = await open('n/Welcome.md', { theme: 'light', rightOpen: true });
  const shot = await page.screenshot();
  write('docs/images/light-theme.webp', Buffer.from(await webp(page, shot, 0.86), 'base64'));
  await context.close();
}
{
  const { page, context } = await open('n/Drawings/System%20sketch.excalidraw', { theme: 'dark', rightOpen: false });
  await page.locator('.excalidraw').first().waitFor();
  await page.waitForTimeout(2000);
  const shot = await page.screenshot();
  write('docs/images/drawing.webp', Buffer.from(await webp(page, shot, 0.86), 'base64'));
  await context.close();
}

// ---------------------------------------------------------------- the social preview

// The note as the preview shows it: the desktop app at scale 1, its editor's left edge 112 px into the window.
const { page: notePage, context: noteContext } = await open('n/Trip%20to%20Lisbon.md', { theme: 'dark', rightOpen: false, scale: 1, width: 1366, height: 800 });
const content = await notePage.locator('.cm-content').first().boundingBox();
const app = (await notePage.screenshot()).toString('base64');
const shiftX = Math.round(112 - content.x);
await noteContext.close();

const icon = readFileSync(join(repo, 'docs', 'images', 'icon.svg')).toString('base64');
const chips = ['Notes', 'Spreadsheets', 'Drawings', 'Canvas', 'Tasks &amp; Kanban', 'Plain files + git history', 'PWA + desktop'];
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><head><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1280px; height: 640px; overflow: hidden; font-family: 'Segoe UI', 'Inter', system-ui, sans-serif;
    background: radial-gradient(900px 520px at 30% 112%, rgba(138, 92, 245, 0.22), transparent 70%),
      linear-gradient(135deg, #0b0a1d 0%, #14102f 55%, #1b1440 100%); color: #ece9f7; }
  .left { position: absolute; left: 64px; top: 70px; width: 560px; }
  .brand { display: flex; align-items: center; gap: 28px; }
  .brand img { width: 104px; height: 104px; filter: drop-shadow(0 10px 30px rgba(138, 92, 245, 0.35)); }
  h1 { margin: 0; font-size: 92px; font-weight: 700; letter-spacing: -2px; color: #f4f2fb; }
  .pitch { margin: 34px 0 30px; font-size: 31px; line-height: 1.32; font-weight: 600; color: #e3defa; }
  .pitch span { color: #b9a2fb; }
  .chips { display: flex; flex-wrap: wrap; gap: 11px; }
  .chip { padding: 8px 16px; border-radius: 999px; font-size: 19px; color: #d9cdfd; background: rgba(138, 92, 245, 0.16);
    border: 1px solid rgba(166, 138, 249, 0.42); }
  .stack { position: absolute; left: 64px; bottom: 48px; font-size: 20px; color: #9890b5; letter-spacing: 0.2px; }
  .window { position: absolute; left: 662px; top: 74px; width: 700px; height: 640px; border-radius: 14px; overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(138, 92, 245, 0.18);
    background: #1e1e1e url(data:image/png;base64,${app}) ${shiftX}px 0 no-repeat; }
</style></head><body>
  <div class="left">
    <div class="brand"><img src="data:image/svg+xml;base64,${icon}" alt=""><h1>Voyager</h1></div>
    <div class="pitch">Your notes, sheets, drawings and tasks, <span>built to last</span> and with you on every device.</div>
    <div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>
  </div>
  <div class="stack">Self-hosted · Spring Boot · React · TypeScript · Tailscale</div>
  <div class="window"></div>
</body></html>`);
await page.waitForTimeout(300);
write('docs/images/social-preview.png', await page.screenshot());

await browser.close();
