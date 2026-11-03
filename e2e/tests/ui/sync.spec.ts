import { expect, test } from '@playwright/test';
import { createFile, eventually, readFile, unique } from '../../lib/api.ts';
import { editor, focusEditor, openNote, secondDevice, typeAtEndOf } from '../../lib/ui.ts';

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

    // B is editing too. Then it loses the network and keeps typing, while A edits the same line.
    await focusEditor(b.page);
    await b.context.setOffline(true);
    await typeAtEndOf(b.page, 'first line', ' and B offline');
    await typeAtEndOf(page, 'first line', ' again');
    await eventually(() => readFile(path), (f) => f.content.includes('first line from A again'));

    // Back online, B is told its version and the server's differ, and keeps its own.
    await b.context.setOffline(false);
    const banner = b.page.getByRole('alert').filter({ hasText: 'changed on another device while you were editing it' });
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(editor(b.page)).toContainText('first line from A and B offline');

    // Compare shows both versions; its legend keeps each colour with its label, also on a phone.
    await banner.getByRole('button', { name: 'Compare' }).click();
    const compare = b.page.getByRole('dialog', { name: 'Compare your version with theirs' });
    await expect(compare).toBeVisible();
    await expect(compare.locator('.compare-key')).toHaveCount(2);
    for (const key of await compare.locator('.compare-key').all()) {
      const [swatch, label] = await key.evaluate((el) => {
        const s = el.querySelector('.compare-swatch')!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()];
        return [s.top + s.height / 2, rects[rects.length - 1].top + rects[rects.length - 1].height / 2];
      });
      expect(Math.abs(swatch - label)).toBeLessThan(8);
    }
    await compare.getByRole('button', { name: 'Cancel' }).click();
    await expect(compare).toHaveCount(0);

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
    await focusEditor(b.page);
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

// QA F1: without a service worker (a first visit, every Playwright run), a lazy chunk that could
// not load offline was taken for a new deploy and the built app reloaded into the browser's
// offline page.
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
