// Accessibility audit in a real browser (docs/ACCESSIBILITY.md): axe-core (WCAG 2.0/2.1/2.2 A and AA)
// on every page, panel, dialog and view of the app, at desktop size and on a 375×812 phone, in the
// dark and the light theme, plus checks axe cannot make: Esc closes overlays and focus comes back,
// Tab never lands on an invisible element or one without a focus indicator, and at 320 CSS px
// (a 1280 px window zoomed to 400 %) nothing scrolls sideways (WCAG 1.4.10).
//
//   npm run test:a11y                      # starts Vite with the in-memory mock API on port 5149
//   npm run test:a11y -- --url http://127.0.0.1:5149   # audits a server that is already running
//   npm run test:a11y -- --only note,palette --themes dark --sizes phone
//
// It drives an installed Chrome or Edge through playwright-core (A11Y_BROWSER=chrome|msedge|chromium;
// "chromium" needs `npx playwright install chromium`). Exit code 1 when a violation is found that is
// not in KNOWN below. Screens marked `advisory` (the spreadsheet view, which another work package
// owns, and Excalidraw's own UI) are reported but do not fail the run.
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    port: { type: 'string', default: process.env.A11Y_PORT || '5149' },
    only: { type: 'string' },
    themes: { type: 'string', default: 'dark,light' },
    sizes: { type: 'string', default: 'desktop,phone' },
    verbose: { type: 'boolean', default: false },
  },
});

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Violations that are known and tracked in docs/ACCESSIBILITY.md ("Known gaps"), as
 * `rule` or `rule@selector-substring`. Keep this list short; fix rather than add.
 */
const KNOWN = [];

const SIZES = {
  desktop: { viewport: { width: 1280, height: 800 } },
  phone: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  // Not in the default run: `--sizes tablet` (an iPad in landscape: the icon rail and overlay sidebars).
  tablet: { viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

const note = '/n/Welcome.md';
const editorReady = '.cm-content';

/** Opens a sidebar panel: a tab of the desktop sidebars, or the drawer and the bottom sheet on a phone. */
function panel(side, title) {
  return async (page, size) => {
    if (size === 'desktop') {
      const strip = page.locator(side === 'left' ? '.sidebar-left' : '.sidebar-right');
      if (!(await strip.count())) await page.getByRole('button', { name: side === 'left' ? 'Toggle left sidebar' : 'Toggle right sidebar' }).first().click();
      await page.locator(side === 'left' ? '.sidebar-left' : '.sidebar-right').getByRole('tab', { name: title, exact: true }).click();
      return;
    }
    if (side === 'left') {
      await page.getByRole('button', { name: 'Open sidebar' }).click();
      await page.locator('.overlay-left.is-open').getByRole('tab', { name: title, exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'More' }).click();
      const item = page.getByRole('menuitem', { name: title, exact: true });
      if (await item.count()) await item.click();
      else {
        await page.keyboard.press('Escape');
        // Panels without a ⋯ entry: open the sheet from the palette command "Show <title>".
        await openPalette(page, size);
        await page.keyboard.type(title);
        await page.keyboard.press('Enter');
      }
      await page.locator('.overlay.is-open:not(.overlay-left)').getByRole('tab', { name: title, exact: true }).click();
    }
  };
}

async function key(page, combo, waitFor) {
  // From the editor when there is one, so Esc has somewhere to return focus to.
  const editor = page.locator('.cm-content').first();
  if (await editor.count()) await editor.focus();
  await page.keyboard.press(combo);
  if (waitFor) await page.waitForSelector(waitFor, { state: 'visible', timeout: 5000 });
}

/** Opens the command palette: Mod-P on a desktop, ⋯ › Command palette on a phone. */
async function openPalette(page, size) {
  if (size === 'desktop') return key(page, 'Control+P', '[role=dialog]');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Command palette' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'visible', timeout: 5000 });
}

/** Runs a palette command; by default it opens a dialog. `create`: it makes a file, whose name is confirmed with Enter. */
function command(text, waitFor = '.modal-panel', create = false) {
  return async (page, size) => {
    await openPalette(page, size);
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    if (create) {
      await page.waitForSelector('.inline-title-input', { state: 'visible', timeout: 10000 });
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector(waitFor, { state: 'visible', timeout: 15000 });
  };
}

/** Writes a file into the mock vault (as another device would) and opens it. */
function mockFile(path, content, waitFor) {
  return async (page, size) => {
    await page.evaluate(([p, c]) => window.notesMock.externalEdit(p, c), [path, content]);
    // The new file reaches the tree through the mock's event stream; then the quick switcher opens it.
    await page.waitForTimeout(600);
    if (size === 'desktop') await key(page, 'Control+O', '[role=dialog]');
    else {
      await page.getByRole('button', { name: 'Quick switcher' }).click();
      await page.waitForSelector('[role=dialog]', { state: 'visible', timeout: 5000 });
    }
    await page.keyboard.type(path.replace(/\.md$/, ''));
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForSelector(waitFor, { state: 'visible', timeout: 15000 });
  };
}

const KANBAN = '---\nkanban-plugin: basic\n---\n\n## To do\n\n- [ ] Write the report\n- [ ] Book the venue\n\n## Done\n\n- [x] Pick a date\n';

/** A one-page PDF with a line of text (PDF.js rebuilds the missing cross-reference table). */
const PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
  '4 0 obj<</Length 41>>stream',
  'BT /F1 18 Tf 20 60 Td (Hello, PDF) Tj ET',
  'endstream endobj',
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n');

/** Every screen: a route, what shows it is ready, and an optional action that opens a panel or overlay. */
const SCREENS = [
  { name: 'home', path: '/' },
  { name: 'note', path: note, ready: editorReady },
  { name: 'rich-note', path: '/n/Rich%20Markdown.md', ready: editorReady },
  { name: 'formulas-note', path: '/n/Ideas/Formulas.md', ready: editorReady },
  { name: 'canvas', path: '/n/Projects/Project%20board.canvas', ready: '.canvas-view, [class*=canvas]' },
  { name: 'image', path: '/n/Attachments/diagram.svg', ready: 'img' },
  { name: 'json', path: '/n/Scratch/data.json', ready: editorReady },
  { name: 'not-found', path: '/n/Nope/missing.md' },
  { name: 'search', path: '/search?q=plan' },
  { name: 'trash', path: '/trash' },
  ...['files', 'daily', 'templates', 'editor', 'hotkeys', 'capture', 'clipper', 'ai', 'reminders', 'publish', 'vaults', 'device', 'about'].map((s) => ({
    name: `settings-${s}`,
    path: `/settings/${s}`,
    ready: '.settings-section',
  })),
  { name: 'settings-index', path: '/settings', sizes: ['phone'] },
  ...['calendar', 'history', 'status', 'graph', 'compat', 'ask', 'flashcards', 'habits', 'tasks/today', 'tasks/upcoming', 'tasks', 'tasks/completed', 'tasks/filter'].map((r) => ({
    name: `page-${r.replace('/', '-')}`,
    path: `/x/${r}`,
  })),
  // Overlays.
  { name: 'palette', path: note, ready: editorReady, act: openPalette, escape: true },
  {
    name: 'switcher',
    path: note,
    ready: editorReady,
    act: async (p, size) => {
      if (size === 'desktop') return key(p, 'Control+O', '[role=dialog]');
      await p.getByRole('button', { name: 'Quick switcher' }).click();
      await p.waitForSelector('[role=dialog]', { state: 'visible', timeout: 5000 });
    },
    escape: true,
  },
  {
    name: 'more-menu',
    path: note,
    ready: editorReady,
    sizes: ['phone'],
    act: (p) => p.getByRole('button', { name: 'More' }).click(),
    escape: true,
  },
  {
    name: 'context-menu',
    path: note,
    ready: editorReady,
    sizes: ['desktop'],
    act: async (p) => {
      await p.locator('.sidebar-left [role=treeitem]').first().click({ button: 'right' });
      await p.waitForSelector('[role=menu]');
    },
    escape: true,
  },
  { name: 'move-dialog', path: note, ready: editorReady, act: command('Move current file'), escape: true },
  { name: 'delete-confirm', path: note, ready: editorReady, act: command('Delete current file'), escape: true },
  { name: 'templates', path: note, ready: editorReady, act: command('Insert template'), escape: true },
  { name: 'capture', path: note, ready: editorReady, act: command('Quick capture'), escape: true },
  { name: 'tab-switcher', path: note, ready: editorReady, sizes: ['phone'], act: (p) => p.locator('.top-bar-tabs').click(), escape: true },
  // Views made on the fly (the mock vault has none of these).
  { name: 'kanban', path: note, ready: editorReady, act: mockFile('Board.md', KANBAN, '.kanban-view') },
  { name: 'pdf', path: note, ready: editorReady, act: mockFile('Doc.pdf', PDF, '.pdf-view') },
  // Excalidraw's own toolbar and menus (a third-party package): reported, not failing.
  { name: 'drawing', path: note, ready: editorReady, act: command('Create new drawing', '.excalidraw', true), advisory: true },
  // The spreadsheet view belongs to the sheets work package: reported, not failing (docs/ACCESSIBILITY.md).
  { name: 'sheet', path: note, ready: editorReady, act: command('Create new spreadsheet', '.sheet-toolbar', true), advisory: true },
  { name: 'drawer', path: note, ready: editorReady, sizes: ['phone'], act: (p) => p.getByRole('button', { name: 'Open sidebar' }).click(), escape: true },
  // Panels.
  ...[
    ['left', 'Files'],
    ['left', 'Search'],
    ['left', 'Bookmarks'],
    ['left', 'Tags'],
    ['left', 'Recent files'],
    ['left', 'Properties'],
    ['right', 'Backlinks'],
    ['right', 'Outline'],
    ['right', 'History'],
    ['right', 'Local graph'],
  ].map(([side, title]) => ({
    name: `panel-${title.toLowerCase().replace(/ /g, '-')}`,
    path: note,
    ready: editorReady,
    act: panel(side, title),
  })),
];

function selectedScreens() {
  const only = args.only?.split(',').map((s) => s.trim());
  return only ? SCREENS.filter((s) => only.some((o) => s.name === o || s.name.startsWith(o + '-'))) : SCREENS;
}

function isKnown(rule, target) {
  return KNOWN.some((k) => {
    const [r, sel] = k.split('@');
    return r === rule && (!sel || target.includes(sel));
  });
}

async function launch() {
  const wanted = process.env.A11Y_BROWSER;
  const channels = wanted ? [wanted] : ['chrome', 'msedge', 'chromium'];
  let lastError;
  for (const channel of channels) {
    try {
      return await chromium.launch(channel === 'chromium' ? {} : { channel });
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`No browser found (tried ${channels.join(', ')}). Install Chrome or Edge, or run \`npx playwright install chromium\`.\n${lastError}`);
}

async function startServer() {
  if (args.url) return { url: args.url.replace(/\/$/, ''), close: async () => {} };
  process.env.VITE_MOCK_API = '1';
  const { createServer } = await import('vite');
  const server = await createServer({ server: { port: Number(args.port), strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
  await server.listen();
  return { url: `http://127.0.0.1:${args.port}`, close: () => server.close() };
}

/** WCAG 1.4.10: at 320 CSS px nothing but 2D content (tables, code, diagrams, canvases) scrolls sideways. */
async function reflow(page) {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const out = [];
    const exempt = 'table, pre, code, .cm-lp-table, .mermaid-svg, canvas, svg, .canvas-view, .excalidraw, .sheet-view, .graph-canvas, .katex-display';
    for (const el of document.querySelectorAll('.workspace-scroll, .settings-section, .page, .panel-body, .overlay-content, .modal-panel')) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const right = el.getBoundingClientRect().right;
      const culprit = [...el.querySelectorAll('*')].find((c) => c.getBoundingClientRect().right > right + 1 && !c.closest(exempt) && getComputedStyle(c).position !== 'fixed');
      if (culprit) out.push(`${el.className.split(' ')[0]} scrolls sideways at 320 px (${culprit.tagName.toLowerCase()}.${String(culprit.className).split(' ')[0]})`);
    }
    return out;
  });
}

/** Keyboard checks: Tab reaches only visible elements, each with a focus indicator. */
async function tabWalk(page, steps = 25) {
  const problems = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
      const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName;
      return { label, visible: r.width > 0 && r.height > 0 && s.visibility !== 'hidden', ring, inEditor: !!el.closest('.cm-editor') };
    });
    if (!info) continue;
    if (info.inEditor) break;
    if (!info.visible) problems.push(`Tab reached an invisible element (${info.label})`);
    else if (!info.ring) problems.push(`No visible focus indicator on "${info.label}"`);
  }
  return problems;
}

async function main() {
  const server = await startServer();
  const browser = await launch();
  const themes = args.themes.split(',');
  const sizes = args.sizes.split(',');
  const findings = new Map();
  const advisory = new Map();
  const keyboard = [];
  let runs = 0;
  let failedScreens = 0;
  try {
    for (const theme of themes) {
      for (const size of sizes) {
        const context = await browser.newContext({ ...SIZES[size], colorScheme: theme, reducedMotion: 'reduce' });
        await context.addInitScript((t) => {
          localStorage.setItem('notesapp:prefs', JSON.stringify({ theme: t }));
          // The keyboard hint and other one-time tips would otherwise cover parts of the page.
        }, theme);
        for (const screen of selectedScreens()) {
          if (screen.sizes && !screen.sizes.includes(size)) continue;
          const page = await context.newPage();
          const where = `${screen.name} [${theme}, ${size}]`;
          try {
            await page.goto(server.url + screen.path, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector(screen.ready ?? 'main', { timeout: 15000 });
            await page.waitForTimeout(400);
            if (screen.act) {
              await screen.act(page, size);
              await page.waitForTimeout(400);
            }
            const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
            runs++;
            for (const v of results.violations) {
              for (const node of v.nodes) {
                const target = node.target.join(' ');
                if (isKnown(v.id, target)) continue;
                const k = `${v.id} :: ${target}`;
                const into = screen.advisory ? advisory : findings;
                const entry = into.get(k) ?? { rule: v.id, impact: v.impact, help: v.help, target, summary: node.failureSummary ?? '', where: [] };
                entry.where.push(where);
                into.set(k, entry);
              }
            }
            if (screen.escape) {
              const before = await page.locator('[role=dialog][aria-modal=true]:visible, [role=menu]:visible').count();
              await page.keyboard.press('Escape');
              await page.waitForTimeout(300);
              const after = await page.locator('[role=dialog][aria-modal=true]:visible, [role=menu]:visible').count();
              if (before > 0 && after >= before) keyboard.push(`${where}: Esc did not close the overlay`);
              const focus = await page.evaluate(() => document.activeElement?.tagName ?? 'none');
              if (before > 0 && (focus === 'BODY' || focus === 'none')) keyboard.push(`${where}: focus was lost after Esc (on <body>)`);
            }
            if (screen.name === 'note' || screen.name === 'home' || screen.name === 'settings-files') {
              for (const p of await tabWalk(page)) keyboard.push(`${where}: ${p}`);
            }
            if (size === 'phone' && !screen.act && !screen.advisory) {
              for (const p of await reflow(page)) keyboard.push(`${where}: ${p}`);
            }
          } catch (e) {
            failedScreens++;
            keyboard.push(`${where}: could not audit (${String(e.message ?? e).split('\n')[0]})`);
          } finally {
            await page.close();
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const print = (f, mark) => {
    console.log(`\n${mark} ${f.rule} (${f.impact}): ${f.help}\n  ${f.target}\n  on ${f.where.length > 4 ? f.where.slice(0, 4).join('; ') + `; +${f.where.length - 4} more` : f.where.join('; ')}`);
    if (args.verbose) console.log('  ' + f.summary.replace(/\n/g, '\n  '));
  };
  const list = [...findings.values()].sort((a, b) => a.rule.localeCompare(b.rule));
  for (const f of list) print(f, '✗');
  if (advisory.size > 0) {
    console.log("\nAdvisory (the spreadsheet view and Excalidraw's own UI; listed in docs/ACCESSIBILITY.md, not failing):");
    for (const f of [...advisory.values()].sort((a, b) => a.rule.localeCompare(b.rule))) print(f, '!');
  }
  for (const k of keyboard) console.log(`\n✗ keyboard: ${k}`);
  console.log(`\naxe: ${runs} screens audited, ${list.length} distinct violations, ${keyboard.length} keyboard or reflow problems${failedScreens ? `, ${failedScreens} screens failed to open` : ''}${advisory.size ? `, ${advisory.size} advisory findings` : ''}.`);
  process.exitCode = list.length > 0 || keyboard.length > 0 ? 1 : 0;
}

await main();
