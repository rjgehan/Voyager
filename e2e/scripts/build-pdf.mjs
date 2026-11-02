// Lays the screen inventory (screens-output/screens.json + img/) out as a PDF: a cover with the
// groups, an optional introduction, then each group's screens: phone frames three to a row, PC
// screens one to a row.
//
//   SCREENS_INTRO=../qa/<date>/FINDINGS.md   Markdown (or .html) placed after the cover
//   SCREENS_TITLE="NotesApp QA 2026-11-02"   the cover's title
//   SCREENS_PDF=path/to/out.pdf              where to write it (default screens-output/screens.pdf)
import { chromium } from '@playwright/test';
import MarkdownIt from 'markdown-it';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const E2E = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(E2E, 'screens-output');
const manifest = JSON.parse(readFileSync(join(OUT, 'screens.json'), 'utf8'));

let intro = '';
if (process.env.SCREENS_INTRO && existsSync(process.env.SCREENS_INTRO)) {
  const text = readFileSync(process.env.SCREENS_INTRO, 'utf8');
  intro = process.env.SCREENS_INTRO.endsWith('.md') ? new MarkdownIt({ html: false, linkify: true }).render(text) : text;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const groups = [];
for (const s of manifest.shots) {
  let g = groups.at(-1);
  if (!g || g.name !== s.group) groups.push((g = { name: s.group, shots: [] }));
  g.shots.push(s);
}

const img = (f) => pathToFileURL(join(OUT, 'img', f)).href;
const figure = (s) => `
  <figure class="${s.wide ? 'wide' : ''}"><div class="frame"><img src="${img(s.file)}"></div>
  <figcaption>${esc(s.title)}${s.note ? `<small>${esc(s.note)}</small>` : ''}</figcaption></figure>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.45in; }
  body { font: 10pt "Segoe UI", -apple-system, Helvetica, sans-serif; color: #1c1c1e; margin: 0; }
  .cover { height: 9.8in; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover h1 { font-size: 32pt; margin: 0 0 6pt; letter-spacing: -0.02em; }
  .cover p { color: #6e6e73; font-size: 12pt; margin: 2pt 0; }
  .toc { margin-top: 28pt; columns: 2; }
  .toc div { padding: 3pt 0; border-bottom: 0.5pt solid #e5e5ea; }
  h2 { font-size: 18pt; margin: 0 0 10pt; page-break-after: avoid; }
  section { page-break-before: always; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16pt 14pt; }
  figure { margin: 0; break-inside: avoid; }
  figure.wide { grid-column: 1 / -1; }
  .frame { border: 0.75pt solid #d1d1d6; border-radius: 12pt; overflow: hidden; background: #f2f2f7; }
  figure.wide .frame { border-radius: 6pt; }
  .frame img { width: 100%; display: block; }
  figcaption { margin-top: 5pt; font-weight: 600; font-size: 9pt; }
  figcaption small { display: block; font-weight: 400; color: #6e6e73; margin-top: 1pt; }
  .intro { font-size: 9.5pt; line-height: 1.45; page-break-after: always; }
  .intro h1 { font-size: 22pt; margin: 0 0 8pt; }
  .intro h2 { font-size: 15pt; margin: 18pt 0 6pt; page-break-after: avoid; }
  .intro h3 { font-size: 11.5pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  .intro table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 8.6pt; }
  .intro th, .intro td { border: 0.5pt solid #d1d1d6; padding: 4pt 6pt; vertical-align: top; text-align: left; }
  .intro th { background: #f2f2f7; }
  .intro tr { break-inside: avoid; }
  .intro code { font: 8.5pt Consolas, ui-monospace, Menlo, monospace; background: #f2f2f7; padding: 0 2pt; border-radius: 3pt; }
  .intro pre { background: #f2f2f7; padding: 6pt 8pt; border-radius: 6pt; white-space: pre-wrap; }
  .intro pre code { background: none; padding: 0; }
  .intro li { margin: 2pt 0; break-inside: avoid; }
  .intro hr { border: 0; border-top: 0.5pt solid #d1d1d6; margin: 14pt 0; }
</style></head><body>
  <div class="cover">
    <h1>${esc(process.env.SCREENS_TITLE ?? 'NotesApp — Screen Inventory')}</h1>
    <p>Every page, panel and sheet at iPhone size (390 × 844 pt), dark and light, then the PC (1366 × 860).</p>
    <p>Captured ${esc(new Date(manifest.capturedAt).toLocaleString('en-US'))} · ${manifest.shots.length} screens</p>
    <div class="toc">${groups.map((g) => `<div>${esc(g.name)} — ${g.shots.length}</div>`).join('')}</div>
  </div>
  ${intro ? `<div class="intro">${intro}</div>` : ''}
  ${groups.map((g) => `<section><h2>${esc(g.name)}</h2><div class="grid">${g.shots.map(figure).join('')}</div></section>`).join('')}
</body></html>`;

const channel = process.env.PW_CHANNEL === 'chromium' ? undefined : (await import('../lib/device.ts').catch(() => null))?.browserChannel?.() ?? process.env.PW_CHANNEL ?? 'chrome';
const browser = await chromium.launch({ channel });
const page = await browser.newPage();
const tmp = join(OUT, 'screens.html');
writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
const pdfPath = process.env.SCREENS_PDF ?? join(OUT, 'screens.pdf');
await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(`Wrote ${pdfPath}`);
