import { test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_URL, call, createFile, day, unique } from '../../lib/api.ts';
import { desktop, prefs } from '../../lib/device.ts';
import { SECOND_VAULT, isSeeded, seedVault } from '../../lib/seed.ts';
import { editor, noteUrl, typeAtEndOf } from '../../lib/ui.ts';

/**
 * The screen inventory: every page, panel and sheet at iPhone size (dark, then the main ones
 * light), then the PC at 1366 × 860, over the lived-in vault of lib/seed.ts (seeded here when the
 * vault is not). `npm run screens` turns the result into screens-output/screens.pdf.
 *
 * Not a test of behaviour: a step that fails is listed in screens-output/missed.txt and skipped,
 * so a moved button costs one picture, not the run. For clean pictures run it on a fresh vault:
 * `npm run reset && npm run screens`.
 */
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../screens-output');
type Shot = { file: string; title: string; note: string; group: string; wide: boolean };
const shots: Shot[] = [];
const missed: string[] = [];
let group = '';

async function step(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    missed.push(`${group} / ${label}: ${String(e).split('\n')[0].slice(0, 200)}`);
  }
}

async function shot(page: Page, title: string, note = '', { settle = 600 } = {}) {
  await page.waitForTimeout(settle); // sheets slide in, lazy chunks load, charts draw
  const file = `${String(shots.length + 1).padStart(3, '0')}.png`;
  await page.screenshot({ path: join(OUT, 'img', file), scale: 'css', animations: 'disabled' });
  const wide = (page.viewportSize()?.width ?? 0) > 700;
  shots.push({ file, title, note, group, wide });
}

async function go(page: Page, url: string) {
  await page.goto(url);
  await page.waitForTimeout(900);
}

/** Scrolls the open note so the line showing `text` is near the top. */
async function scrollTo(page: Page, text: string) {
  const line = editor(page).locator('.cm-line, table', { hasText: text }).first();
  await line.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
}

async function device(browser: Browser, opts: Record<string, unknown>, theme: 'dark' | 'light') {
  const context = await browser.newContext({
    ...opts,
    baseURL: WEB_URL,
    locale: 'en-US',
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [{ origin: new URL(WEB_URL).origin, localStorage: [{ name: 'notesapp:prefs', value: prefs(theme) }] }] },
  });
  return { context, page: await context.newPage() };
}

test('capture every screen', async ({ page, browser }, testInfo) => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'img'), { recursive: true });
  if (!(await isSeeded())) await seedVault();
  const phoneOpts = testInfo.project.use as Record<string, unknown>;

  // ------------------------------------------------------------------------------------------
  group = 'Notes on the iPhone';
  await step('welcome', async () => {
    // What a new vault starts with (its content changes with the user guide; nothing here depends on it).
    const files = (await call('GET', '/api/tree')).files.map((f: { path: string }) => f.path);
    for (const [path, title] of [['Welcome.md', 'Welcome note'], ['Live Preview demo.md', 'Live Preview demo']] as const) {
      if (!files.includes(path)) continue;
      await go(page, noteUrl(path));
      await shot(page, title, 'What a new vault starts with.');
    }
  });
  await step('drawer', async () => {
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await shot(page, 'Drawer: files', 'Vault switcher, New note / Today / Capture, the pages, the side tabs and the file tree.');
    const drawer = page.getByRole('dialog', { name: 'Sidebar' });
    for (const tab of ['Search', 'Bookmarks', 'Tags', 'Recent files', 'Properties']) {
      await drawer.getByRole('tab', { name: tab }).click();
      await shot(page, `Drawer: ${tab.toLowerCase()}`);
    }
    await page.keyboard.press('Escape');
  });
  await step('note with properties', async () => {
    await go(page, noteUrl('Projects/Home renovation.md'));
    await shot(page, 'Note: properties', 'Typed properties (text, date, number, checkbox, tags, aliases) edited in place.');
    await scrollTo(page, 'Costs');
    await shot(page, 'Note: a table with formulas', '`=B2*C2` and `=SUM(D2:D4)` computed in the grid; formats from the %% formats %% line.');
    await scrollTo(page, 'Next steps');
    await shot(page, 'Note: tasks, callout, links and a sheet embed');
  });
  await step('table cell editing', async () => {
    await go(page, noteUrl('Projects/Home renovation.md'));
    await scrollTo(page, 'Costs');
    // The total's cell: the caret goes inside SUM( ) so the signature hint shows. Nothing is typed.
    await editor(page).locator('table td[data-row="4"][data-column="3"]').first().click();
    await page.waitForTimeout(300);
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await shot(page, 'Table: editing a formula', 'The formula bar names the cell and shows its result; the signature hint under the cell.');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  });
  await step('garden', async () => {
    await go(page, noteUrl('Projects/Garden.md'));
    await shot(page, 'Note: image embed and table', 'An attachment embedded at 240 px, then a second table.');
    await scrollTo(page, 'The slope');
    await shot(page, 'Note: math and a footnote');
  });
  await step('dataview', async () => {
    await go(page, noteUrl('Reading/Reading list.md'));
    await page.waitForTimeout(1500);
    await shot(page, 'Note: a Dataview table', 'Runs in the sandbox; the file keeps the query.');
  });
  await step('new note', async () => {
    await go(page, noteUrl('Reading/Dune.md'));
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('dialog', { name: 'Sidebar' }).getByRole('button', { name: 'New note' }).first().click();
    await shot(page, 'New note', 'Untitled.md is made at once, its title selected for typing.');
    await page.keyboard.press('Escape');
  });
  await step('editing toolbar', async () => {
    await go(page, noteUrl('Reading/Dune.md'));
    await typeAtEndOf(page, 'Compare with', '');
    await shot(page, 'Editing: the keyboard toolbar', 'Formatting buttons above the iPhone keyboard (the keyboard itself is not drawn by Chrome).');
  });
  await step('more menu', async () => {
    await go(page, noteUrl('Reading/Dune.md'));
    await page.getByRole('button', { name: 'More' }).click();
    await shot(page, 'Note ⋯ menu');
    await page.keyboard.press('Escape');
  });
  await step('panels', async () => {
    for (const item of ['Backlinks', 'Outline', 'History', 'Local graph']) {
      await go(page, noteUrl('Projects/Home renovation.md'));
      await page.getByRole('button', { name: 'More' }).click();
      await page.getByRole('menuitem', { name: item }).click();
      await shot(page, `Panel: ${item}`, 'Side panels open as a bottom sheet on the phone.', { settle: 1200 });
    }
  });
  await step('switcher and palette', async () => {
    await go(page, noteUrl('Reading/Dune.md'));
    await page.getByRole('button', { name: 'Quick switcher' }).click();
    await page.keyboard.type('ren');
    await shot(page, 'Quick switcher', 'Fuzzy over names and aliases ("Renovation").');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Command palette' }).click();
    await shot(page, 'Command palette');
    await page.keyboard.press('Escape');
  });
  await step('quick capture', async () => {
    await go(page, noteUrl('Reading/Dune.md'));
    await page.getByRole('button', { name: 'Quick capture' }).click();
    await shot(page, 'Quick capture', 'The + in the top bar: a thought to the Inbox or today’s note.');
    await page.keyboard.press('Escape');
  });
  await step('search', async () => {
    await go(page, `/search?q=${encodeURIComponent('cabinets')}`);
    await shot(page, 'Search', 'Notes, the PDF’s text (with its page) and spreadsheet cells in one list.');
    await go(page, `/search?q=${encodeURIComponent('tag:#book [rating:5]')}`);
    await shot(page, 'Search with filters');
  });
  await step('conflict', async () => {
    const path = `Scratch/${unique('Conflict')}.md`;
    await createFile(path, '# Shopping\n\nmilk\n');
    await go(page, noteUrl(path));
    await page.context().setOffline(true);
    await typeAtEndOf(page, 'milk', ', eggs');
    await page.waitForTimeout(800);
    await shot(page, 'Offline while editing', 'Edits are kept on the device and saved when the connection is back.');
    const f = await call('GET', `/api/files?path=${encodeURIComponent(path)}`);
    await call('PUT', `/api/files?path=${encodeURIComponent(path)}`, { body: { content: '# Shopping\n\nmilk, bread\n', baseVersion: f.version } });
    await page.context().setOffline(false);
    await page.getByRole('alert').filter({ hasText: 'another device' }).waitFor({ timeout: 30_000 });
    await shot(page, 'Conflict banner', 'Keep mine, Take theirs, or Compare side by side.');
    await page.getByRole('button', { name: 'Compare' }).click();
    await shot(page, 'Conflict: compare', '', { settle: 1200 });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Keep mine' }).click();
  });
  await step('trash', async () => {
    await go(page, '/trash');
    await shot(page, 'Trash', 'Restore or delete for good.');
  });

  // ------------------------------------------------------------------------------------------
  group = 'Files that are not notes';
  await step('sheet', async () => {
    await go(page, noteUrl('Budget.sheet'));
    await page.waitForTimeout(1200);
    await shot(page, 'Spreadsheet', 'Formula bar, toolbar, the grid, sheet tabs; charts below.');
    await page.getByRole('textbox', { name: 'Cell reference' }).fill('B8');
    await page.getByRole('textbox', { name: 'Cell reference' }).press('Enter');
    await shot(page, 'Spreadsheet: a formula cell', '`=SUMIF(C2:C5,FALSE,B2:B5)` in the bar.');
  });
  await step('drawing', async () => {
    await go(page, noteUrl('Floor plan.excalidraw'));
    await page.waitForTimeout(2500);
    await shot(page, 'Excalidraw drawing', '', { settle: 1000 });
  });
  await step('canvas', async () => {
    await go(page, noteUrl('Garden plan.canvas'));
    await page.waitForTimeout(1500);
    await shot(page, 'Canvas', 'Text cards, a note card, a link card, a group and labelled edges.');
  });
  await step('kanban', async () => {
    await go(page, noteUrl('Boards/Renovation board.md'));
    await shot(page, 'Kanban board (Obsidian Kanban format)', '', { settle: 1200 });
  });
  await step('pdf', async () => {
    await go(page, noteUrl('Attachments/Cabinet spec.pdf'));
    await shot(page, 'PDF viewer', '', { settle: 2000 });
  });
  await step('image', async () => {
    await go(page, noteUrl('Attachments/Paint swatch.png'));
    await shot(page, 'Image');
  });
  await step('tasks file', async () => {
    await go(page, noteUrl('Tasks/Home.tasks'));
    await shot(page, 'A .tasks file opens as its list');
  });

  // ------------------------------------------------------------------------------------------
  group = 'Tasks';
  await step('today', async () => {
    await go(page, '/x/tasks/today');
    await shot(page, 'Today', 'Overdue, then today; repeats and priorities on each row.');
  });
  await step('upcoming', async () => {
    await go(page, '/x/tasks/upcoming');
    await shot(page, 'Upcoming', 'Fourteen days with a week strip.');
  });
  await step('lists', async () => {
    await go(page, '/x/tasks');
    await shot(page, 'Lists');
  });
  await step('a list', async () => {
    const lists = (await call('GET', '/api/tasks/lists')).lists;
    const home = lists.find((l: any) => l.name === 'Home');
    await go(page, `/x/tasks/list/${encodeURIComponent(home.id)}`);
    await shot(page, 'A list with sections and subtasks');
    await page.getByRole('button', { name: /^Open “Book the electrician/ }).first().click({ timeout: 5000 }).catch(async () => {
      await page.getByText('Book the electrician').first().click();
    });
    await shot(page, 'Task details', 'Every field: dates, repeat, reminders, priority, tags, notes, subtasks.', { settle: 900 });
    await page.keyboard.press('Escape');
    const board = page.getByRole('button', { name: /board/i }).first();
    if (await board.count()) {
      await board.click();
      await shot(page, 'The list as a board');
    }
  });
  await step('quick add', async () => {
    await go(page, '/x/tasks/today');
    await page.getByRole('button', { name: 'Add task', exact: true }).first().click();
    await page.keyboard.type('Pay rent tomorrow 9am every month !high #home');
    await shot(page, 'Quick add', 'Dates, repeats, priority and tags read into chips as you type.');
    await page.keyboard.press('Escape');
  });
  await step('completed and filter', async () => {
    await go(page, '/x/tasks/completed');
    await shot(page, 'Completed');
    await go(page, '/x/tasks/filter');
    await shot(page, 'Filter');
  });

  // ------------------------------------------------------------------------------------------
  group = 'Calendar, daily notes, habits, flashcards';
  await step('calendar', async () => {
    await go(page, '/x/calendar');
    await shot(page, 'Calendar: month', 'Daily notes (dot), dated notes (square), tasks (rings), repeats (dashed).');
    await page.getByRole('button', { name: new RegExp(`^${new Date(day(3) + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`) }).click();
    await shot(page, 'Calendar: a day’s details');
    await page.getByRole('button', { name: 'Week' }).click();
    await shot(page, 'Calendar: week');
  });
  await step('daily', async () => {
    await go(page, noteUrl(`Daily/${day(0)}.md`));
    await shot(page, 'Today’s daily note');
  });
  await step('habits', async () => {
    await go(page, '/x/habits');
    await shot(page, 'Habits', 'Streaks, the 30-day rate and a year of check-ins.', { settle: 1000 });
  });
  await step('flashcards', async () => {
    await go(page, '/x/flashcards');
    await shot(page, 'Flashcards: decks');
    await page.getByRole('button', { name: /Study now|Review/ }).first().click();
    await shot(page, 'Flashcards: a card', '', { settle: 900 });
    await page.getByRole('button', { name: 'Show answer' }).click();
    await shot(page, 'Flashcards: the answer and the four buttons');
  });

  // ------------------------------------------------------------------------------------------
  group = 'Other pages';
  for (const [route, title, note] of [
    ['graph', 'Graph', ''],
    ['history', 'Vault history', 'Every commit, filterable by note and author.'],
    ['status', 'Status', 'Problems first, then version, history, vault, disk, backups and alerts.'],
    ['compat', 'Compatibility report', 'What an Obsidian vault uses that NotesApp does not.'],
    ['ask', 'Ask your vault', 'Off until switched on in Settings.'],
  ] as const) {
    await step(route, async () => {
      await go(page, `/x/${route}`);
      await shot(page, title, note, { settle: route === 'graph' ? 2500 : 800 });
    });
  }
  await step('settings', async () => {
    for (const s of ['files', 'daily', 'editor', 'hotkeys', 'reminders', 'vaults', 'device', 'about']) {
      await go(page, `/settings/${s}`);
      await shot(page, `Settings: ${s}`);
    }
  });
  await step('second vault', async () => {
    await go(page, `/v/${SECOND_VAULT}/n/Roadmap.md`);
    await shot(page, `A second vault (“${SECOND_VAULT}”)`, 'The same app at /v/<name>/; nothing is shared with the main vault.');
  });

  // ------------------------------------------------------------------------------------------
  group = 'Light theme (iPhone)';
  const light = await device(browser, phoneOpts, 'light');
  try {
    for (const [url, title] of [
      [noteUrl('Projects/Home renovation.md'), 'Note'],
      ['/x/tasks/today', 'Today'],
      ['/x/calendar', 'Calendar'],
      [noteUrl('Budget.sheet'), 'Spreadsheet'],
    ] as const) {
      await step(title, async () => {
        await go(light.page, url);
        await shot(light.page, `${title} (light)`, '', { settle: 1000 });
      });
    }
  } finally {
    await light.context.close();
  }

  // ------------------------------------------------------------------------------------------
  group = 'The PC (1366 × 860)';
  const pc = await device(browser, desktop, 'dark');
  try {
    const p = pc.page;
    await step('note', async () => {
      await go(p, noteUrl('Projects/Home renovation.md'));
      await shot(p, 'Note with the file tree and the outline', 'Ribbon, left sidebar, tabs, the note, right sidebar, status bar.');
      await scrollTo(p, 'Costs');
      await shot(p, 'A table with formulas');
    });
    await step('split', async () => {
      await go(p, noteUrl('Projects/Home renovation.md'));
      await p.getByRole('button', { name: 'Split right' }).click();
      await p.waitForTimeout(500);
      await go(p, noteUrl('Budget.sheet'));
      await shot(p, 'Two panes: a note and its spreadsheet', '', { settle: 1200 });
    });
    for (const [url, title] of [
      [noteUrl('Budget.sheet'), 'Spreadsheet'],
      [noteUrl('Garden plan.canvas'), 'Canvas'],
      [noteUrl('Boards/Renovation board.md'), 'Kanban board'],
      [noteUrl('Floor plan.excalidraw'), 'Excalidraw'],
      ['/x/tasks/today', 'Tasks: Today'],
      ['/x/tasks/upcoming', 'Tasks: Upcoming'],
      ['/x/calendar', 'Calendar'],
      ['/x/habits', 'Habits'],
      ['/x/graph', 'Graph'],
      ['/x/history', 'Vault history'],
      [`/search?q=${encodeURIComponent('renovation')}`, 'Search'],
      ['/settings/files', 'Settings'],
    ] as const) {
      await step(title, async () => {
        await go(p, url);
        await shot(p, title, '', { settle: title === 'Excalidraw' || title === 'Graph' ? 2500 : 1000 });
      });
    }
    await step('palette', async () => {
      await go(p, noteUrl('Reading/Dune.md'));
      await p.getByRole('button', { name: 'Open command palette' }).click();
      await shot(p, 'Command palette');
      await p.keyboard.press('Escape');
    });
  } finally {
    await pc.context.close();
  }

  writeFileSync(join(OUT, 'screens.json'), JSON.stringify({ capturedAt: new Date().toISOString(), shots }, null, 2));
  writeFileSync(join(OUT, 'missed.txt'), missed.join('\n') + (missed.length ? '\n' : ''));
  if (missed.length) console.log(`Screens missed (${missed.length}):\n  ${missed.join('\n  ')}`);
  console.log(`${shots.length} screens in ${OUT}`);
});
