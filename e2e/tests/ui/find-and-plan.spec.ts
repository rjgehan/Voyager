import { expect, test } from '@playwright/test';
import { call, createFile, day, eventually, madeUpWord, newList, newTask, readFile, tree, unique } from '../../lib/api.ts';
import { editor, noteTitle, noteUrl, openNote } from '../../lib/ui.ts';

/** Finding things and planning: search, task quick add, the calendar and a spreadsheet formula. */

test('search finds a word and opens the note at the match', async ({ page }) => {
  const word = madeUpWord('quokka');
  const path = `${unique('Found')}.md`;
  await createFile(path, `# Trip\n\n${'Filler line.\n'.repeat(40)}\nWe saw a ${word} on the island.\n`);
  await page.goto(`/search?q=${encodeURIComponent(word)}`);
  const input = page.getByRole('searchbox').or(page.getByRole('textbox', { name: /search/i })).first();
  await expect(input).toHaveValue(word);
  const hit = page.getByRole('main').getByText(`We saw a ${word} on the island.`).first();
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(noteTitle(page)).toHaveValue(path.replace(/\.md$/, ''));
  // Opened at the line, which is far below the top.
  await expect(editor(page).locator('.cm-line', { hasText: word })).toBeInViewport();
});

test('search from the box: typing shows results as you type', async ({ page }) => {
  const word = madeUpWord('wombat');
  await createFile(`${unique('Typed')}.md`, `A ${word} in the garden.\n`);
  await page.goto('/search');
  const input = page.getByRole('searchbox').or(page.getByRole('textbox', { name: /search/i })).first();
  await input.fill(word.slice(0, -2)); // prefix: search-as-you-type
  await expect(page.getByRole('main').getByText(`A ${word} in the garden.`)).toBeVisible();
});

test('quick add reads a date, a priority and a tag into a task', async ({ page }) => {
  const title = unique('Pay the gas bill');
  await page.goto('/x/tasks/today');
  await page.getByRole('button', { name: 'Add task', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add task' });
  await dialog.getByRole('textbox', { name: 'Task' }).fill(`${title} tomorrow 9am !high #home`);
  const chips = dialog.getByRole('list', { name: 'Recognized' });
  await expect(chips).toContainText('Tomorrow 9:00 AM');
  await expect(chips).toContainText('High priority');
  await dialog.getByRole('button', { name: 'Add' }).click();

  const found = await eventually(
    () => call('GET', `/api/tasks?view=search&q=${encodeURIComponent(title)}`),
    (r) => r.tasks.length === 1,
  );
  expect(found.tasks[0]).toMatchObject({ title, due: `${day(1)}T09:00`, priority: 3, tags: ['home'], status: 'open' });
});

test('a task checked off on Today is done on the server', async ({ page }) => {
  const list = await newList(unique('Today list'));
  const title = unique('Take out the bins');
  const task = await newTask({ title, listId: list.id, due: day(0) });
  await page.goto('/x/tasks/today');
  const row = page.getByRole('listitem').filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole('checkbox').first().click();
  await eventually(() => call('GET', `/api/tasks/${task.id}`), (t) => t.status === 'done');
});

test('the calendar shows a day’s tasks and dated notes, and opens its daily note', async ({ page }) => {
  // A day a few weeks out, so the daily note is this test's own (and may exist from an earlier run).
  const target = new Date();
  target.setDate(target.getDate() + 23);
  const iso = day(23);
  const title = unique('Dentist');
  await newTask({ title, due: iso });
  const dated = unique('Party plan');
  await createFile(`${dated}.md`, `---\ndate: ${iso}\n---\n# Party\n`);

  await page.goto(`/x/calendar?date=${iso}`);
  const label = target.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  // The day's button is named after the day, then what it holds ("…: 1 note, 1 open task").
  const cell = page.getByRole('button', { name: new RegExp(`^${label}`) });
  // Earlier runs may have dated things on the same day too.
  await expect(cell).toHaveAccessibleName(/\d+ notes?, \d+ open tasks?/);
  // The address focused the day, so its details are showing: the task and the dated note. (A
  // wide grid also writes titles in the day itself.)
  const details = page.locator('.cal-day-details');
  await expect(details.getByText(title)).toBeVisible();
  await expect(details.getByText(dated)).toBeVisible();

  // A tap on the focused day opens (or makes) its daily note.
  await cell.click();
  await expect(noteTitle(page)).toHaveValue(iso);
  await eventually(() => tree(), (t) => t.files.some((f) => f.path === `Daily/${iso}.md`));
});

test('a spreadsheet: a formula typed in the formula bar is computed and saved with its result', async ({ page }) => {
  const path = `${unique('Budget')}.sheet`;
  const sheet = {
    type: 'notesapp-sheet', version: 1, engine: '', named: {},
    sheets: [{ id: 's1', name: 'Costs', cells: { A1: { v: 'Item' }, B1: { v: 'Cost' }, A2: { v: 'Paint' }, B2: { v: 120 }, A3: { v: 'Tiles' }, B3: { v: 380.5 } }, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } }],
  };
  await createFile(path, JSON.stringify(sheet, null, 2) + '\n');
  await page.goto(noteUrl(path));
  const ref = page.getByRole('textbox', { name: 'Cell reference' });
  await expect(ref).toHaveValue('A1');

  // Go to B4 by name, as in Google Sheets' name box, and type a formula in the bar.
  await ref.fill('B4');
  await ref.press('Enter');
  const contents = page.getByRole('textbox', { name: 'Contents of B4' });
  await expect(contents).toBeVisible();
  await contents.click();
  await page.keyboard.type('=SUM(B2:B3)');
  await page.keyboard.press('Enter');

  const saved = await eventually(() => readFile(path), (f) => f.content.includes('=SUM(B2:B3)'));
  const model = JSON.parse(saved.content);
  expect(model.sheets[0].cells.B4).toMatchObject({ f: '=SUM(B2:B3)', c: 500.5 });
  // Back on B4, the bar shows the formula; the grid its value.
  await ref.fill('B4');
  await ref.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Contents of B4' })).toHaveValue('=SUM(B2:B3)');
});

test('a note embeds a range of a spreadsheet with its computed values @desktop', async ({ page }) => {
  const name = unique('Embedded');
  const sheet = {
    type: 'notesapp-sheet', version: 1, engine: 'hyperformula@3.5.0+1', named: {},
    sheets: [{ id: 's1', name: 'Data', cells: { A1: { v: 'Total' }, B1: { f: '=6*7', c: 42 } }, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } }],
  };
  await createFile(`${name}.sheet`, JSON.stringify(sheet) + '\n');
  const note = `${unique('Uses sheet')}.md`;
  await createFile(note, `# Report\n\n![[${name}.sheet#Data!A1:B1]]\n`);
  await openNote(page, note);
  await expect(editor(page).getByText('42', { exact: true })).toBeVisible();
});
