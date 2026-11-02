import { expect, test } from '@playwright/test';
import { createFile, eventually, readFile, tree, unique } from '../../lib/api.ts';
import { editor, isPhone, leaveCell, newNote, noteTitle, openNote } from '../../lib/ui.ts';

/**
 * The everyday loop, on the PC and on the iPhone: make a note, write in Live Preview, link it,
 * rename it, compute in a table. Arranged through the API, checked on screen and on disk (the
 * app saves in the background, so the file is polled rather than trusted from the screen).
 */

test('create a note, write in Live Preview and link another note from autocomplete', async ({ page }) => {
  const target = unique('Garden plan');
  await createFile(`${target}.md`, `# ${target}\n\nRaised beds.\n`);
  const title = unique('Ideas');

  // Start from an open note: New note in the first moment after the app opens races the start
  // page (a known bug, tests/ui/known-bugs.spec.ts).
  await openNote(page, `${target}.md`);
  await newNote(page);
  await page.keyboard.type(title);
  await page.keyboard.press('Enter'); // from the title into the body
  await page.keyboard.type('Plant **tomatoes** near the ');
  // Earlier runs left other "Garden plan …" notes: typing the whole name puts this one first.
  await page.keyboard.type(`[[${target}`);
  // The first suggestion is selected; Enter takes it (after CodeMirror's 75 ms guard against
  // accepting a list that just changed under the finger).
  const suggestion = page.locator('.cm-tooltip-autocomplete [role="option"][aria-selected="true"]', { hasText: target });
  await expect(suggestion).toBeVisible();
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.keyboard.type(' this spring.');

  // On disk: plain Markdown with a wikilink, in a note named after its title.
  const saved = await eventually(() => readFile(`${title}.md`).catch(() => null), (f) => !!f?.content.includes('this spring.'));
  expect(saved!.content).toContain(`Plant **tomatoes** near the [[${target}]] this spring.`);

  // On screen: the markup is hidden and the link opens its note: Mod-click on the PC, a tap on
  // the phone (a plain click puts the caret in the link to edit it).
  await expect(editor(page).locator('.cm-line', { hasText: 'Plant tomatoes' })).toBeVisible();
  const link = editor(page).getByText(target, { exact: true });
  await expect(link).toBeVisible();
  await page.keyboard.press('ArrowUp'); // the caret off the link line, so it shows as a link
  if (isPhone(page)) await link.tap();
  else await link.click({ modifiers: ['ControlOrMeta'] });
  await expect(noteTitle(page)).toHaveValue(target);
});

test('renaming a note from its title updates the links to it', async ({ page }) => {
  const dir = unique('Rename');
  const name = unique('Old name');
  await createFile(`${dir}/${name}.md`, '# Body\n');
  await createFile(`${dir}/Linker.md`, `See [[${name}]] and [[${name}#Body|the body]].\n`);

  await openNote(page, `${dir}/${name}.md`);
  const title = noteTitle(page);
  const renamed = `${name} renamed`;
  await title.click();
  await title.press('End');
  await title.pressSequentially(' renamed');
  await title.press('Enter');

  await eventually(() => tree(), (t) => t.files.some((f) => f.path === `${dir}/${renamed}.md`));
  const linker = await eventually(() => readFile(`${dir}/Linker.md`), (f) => f.content.includes(renamed));
  expect(linker.content).toBe(`See [[${renamed}]] and [[${renamed}#Body|the body]].\n`);
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(renamed).replace(/%20/g, '(%20|\\+| )')));
});

test('a table computes its formulas, and editing a cell recalculates and saves', async ({ page }) => {
  const path = `${unique('Table')}.md`;
  await createFile(path, [
    '# Costs', '',
    '| Item | Cost | Qty | Total |',
    '| --- | --- | --- | --- |',
    '| Cabinets | 450 | 6 | =B2*C2 |',
    '| Tiles | 35 | 40 | =B3*C3 |',
    '| All | | | =SUM(D2:D3) |',
    '',
  ].join('\n'));
  await openNote(page, path);
  const table = editor(page).locator('table').first();
  await expect(table.getByRole('cell', { name: '2700', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '4100', exact: true })).toBeVisible();

  // Change Cabinets' quantity from 6 to 8: its total and the sum follow.
  await table.getByRole('cell', { name: '6', exact: true }).click();
  const cell = page.getByRole('textbox', { name: 'Row 1, column C' });
  await expect(cell).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('8');
  await leaveCell(page, 'Row 1, column C');
  await expect(table.getByRole('cell', { name: '3600', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '5000', exact: true })).toBeVisible();

  // A new formula in the empty Cost cell of the last row.
  await table.locator('td[data-row="3"][data-column="1"]').click();
  await expect(page.getByRole('textbox', { name: 'Row 3, column B' })).toBeFocused();
  await page.keyboard.type('=SUM(B2:B3)');
  // The formula bar above the table shows the result while typing.
  await expect(page.getByText('B4', { exact: true })).toBeVisible();
  await leaveCell(page, 'Row 3, column B');
  await expect(table.getByRole('cell', { name: '485', exact: true })).toBeVisible();

  // The file keeps exactly what was typed; results are never written back.
  const f = await eventually(() => readFile(path), (x) => x.content.includes('=SUM(B2:B3)'));
  expect(f.content).toContain('| Cabinets | 450 | 8 | =B2*C2 |');
  expect(f.content).toMatch(/\| All \| =SUM\(B2:B3\) \| +\| =SUM\(D2:D3\) \|/);
  expect(f.content).not.toContain('3600');
});
