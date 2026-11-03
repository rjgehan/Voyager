import { expect, test } from '@playwright/test';
import { createFile, unique } from '../../lib/api.ts';
import { editor, newNote, noteTitle, openNote } from '../../lib/ui.ts';

/**
 * Known bugs, as tests (the convention of e2e/README.md): each is marked `test.fail` with a
 * `KNOWN BUG` reason, so a run is green while the bug exists and Playwright reports "Expected to
 * fail, but passed" once it is fixed: then delete the `test.fail` line. Found in the QA pass of
 * 2026-11-02 (qa/2026-11-02/FINDINGS.md).
 */

// On the PC every time; on the phone (the drawer's New note) only sometimes, so not tested there.
test('New note pressed while the app is still opening keeps what is typed into its title @desktop', async ({ page }) => {
  test.fail(true, 'KNOWN BUG (FINDINGS F2): before the tree has loaded, New note does not focus the title, so typing is lost; or the start page then replaces the new note');
  // A slow tailnet on a phone's cold start: the tree takes a while.
  await page.route('**/api/tree', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto('/');
  await newNote(page, { waitForTitle: false });
  const title = unique('Typed at once');
  await page.keyboard.type(title);
  await page.waitForTimeout(2500);
  await expect(noteTitle(page)).toHaveValue(title, { timeout: 2000 });
});

test('going offline just after opening a note does not reload the page', async ({ page, context }) => {
  const path = `${unique('Offline')}.md`;
  await createFile(path, '# Offline\n\nstart\n');
  await openNote(page, path);
  await context.setOffline(true);
  await editor(page).locator('.cm-line', { hasText: 'start' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' typed offline');
  await page.waitForTimeout(1500);
  await expect(editor(page)).toContainText('start typed offline', { timeout: 2000 });
  await context.setOffline(false);
});
