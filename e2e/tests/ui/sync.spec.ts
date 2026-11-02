import { expect, test } from '@playwright/test';
import { createFile, eventually, readFile, unique } from '../../lib/api.ts';
import { editor, openNote, secondDevice, typeAtEndOf } from '../../lib/ui.ts';

/**
 * Two devices on one note (DESIGN §6.10): a change on one shows on the other without a reload,
 * and edits made on both while one was offline end in the conflict banner, never in a lost edit.
 */
test('live update between two devices, then a conflict resolved with Keep mine', async ({ page, browser }, testInfo) => {
  const path = `${unique('Shared')}.md`;
  await createFile(path, '# Shared\n\nfirst line\n');
  const b = await secondDevice(browser, testInfo);
  try {
    await openNote(page, path);
    await openNote(b.page, path);

    // A types; B sees it without doing anything.
    await typeAtEndOf(page, 'first line', ' from A');
    await eventually(() => readFile(path), (f) => f.content.includes('first line from A'));
    await expect(editor(b.page)).toContainText('first line from A');

    // B loses the network and keeps typing; A edits the same line meanwhile.
    await b.context.setOffline(true);
    await typeAtEndOf(b.page, 'first line', ' and B offline');
    await typeAtEndOf(page, 'first line', ' again');
    await eventually(() => readFile(path), (f) => f.content.includes('first line from A again'));

    // Back online, B is told its version and the server's differ, and keeps its own.
    await b.context.setOffline(false);
    const banner = b.page.getByRole('alert').filter({ hasText: 'changed on another device while you were editing it' });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(editor(b.page)).toContainText('first line from A and B offline');
    await banner.getByRole('button', { name: 'Keep mine' }).click();
    await expect(banner).toHaveCount(0);
    const final = await eventually(() => readFile(path), (f) => f.content.includes('and B offline'));
    expect(final.content).toBe('# Shared\n\nfirst line from A and B offline\n');
    // A, which had no unsaved edits, follows.
    await expect(editor(page)).toContainText('first line from A and B offline');
  } finally {
    await b.context.close();
  }
});

test('Take theirs drops the local edit and shows the other device’s text', async ({ page, browser }, testInfo) => {
  const path = `${unique('Theirs')}.md`;
  await createFile(path, 'start\n');
  const b = await secondDevice(browser, testInfo);
  try {
    await openNote(page, path);
    await openNote(b.page, path);
    await b.context.setOffline(true);
    await typeAtEndOf(b.page, 'start', ' (B)');
    await typeAtEndOf(page, 'start', ' (A)');
    await eventually(() => readFile(path), (f) => f.content === 'start (A)\n');
    await b.context.setOffline(false);
    const banner = b.page.getByRole('alert').filter({ hasText: 'changed on another device' });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await banner.getByRole('button', { name: 'Take theirs' }).click();
    await expect(banner).toHaveCount(0);
    await expect(editor(b.page)).toHaveText('start (A)');
    // Nothing of B's reached the server.
    await b.page.waitForTimeout(1500);
    expect((await readFile(path)).content).toBe('start (A)\n');
  } finally {
    await b.context.close();
  }
});
