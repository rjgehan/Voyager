import { expect, type Browser, type BrowserContextOptions, type Locator, type Page, type TestInfo } from '@playwright/test';

/** The phone layout (drawer, bottom sheets) is used below 768 px, as the app's breakpoint says. */
export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1366) < 768;

/** `/n/<path>` for a vault path, each segment encoded (DESIGN §6.4). */
export const noteUrl = (path: string) => `/n/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Opens a note and waits until its editor shows the text. */
export async function openNote(page: Page, path: string) {
  await page.goto(noteUrl(path));
  await expect(editor(page)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toBeVisible();
}

/** The note editor (Live Preview) of the active pane. */
export const editor = (page: Page): Locator => page.locator('.note-editor > .cm-editor > .cm-scroller > .cm-content').first();

/** The open note's inline title. */
export const noteTitle = (page: Page) => page.getByRole('textbox', { name: 'Note title' }).first();

/** New note, the way each device reaches it: the ribbon on the PC, the drawer on the phone. */
export async function newNote(page: Page, { waitForTitle = true } = {}) {
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Open sidebar' }).click();
    await page.getByRole('dialog', { name: 'Sidebar' }).getByRole('button', { name: 'New note' }).first().click();
  } else {
    await page.getByRole('button', { name: 'Create new note' }).click();
  }
  if (waitForTitle) await expect(noteTitle(page)).toBeFocused();
}

/**
 * Puts the caret at the end of the line that shows `lineText` and types, as a person would: a
 * click on the line, then End (no Mod- shortcuts, which differ between the PC and the phone).
 */
export async function typeAtEndOf(page: Page, lineText: string, text: string) {
  const line = editor(page).locator('.cm-line', { hasText: lineText }).first();
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
}

/**
 * Another device of the same kind as the test's (the second phone, the other PC tab), as a new
 * browser context with the project's settings.
 */
export async function secondDevice(browser: Browser, testInfo: TestInfo) {
  const u = testInfo.project.use as BrowserContextOptions;
  const context = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    userAgent: u.userAgent,
    storageState: u.storageState,
    serviceWorkers: u.serviceWorkers,
    locale: u.locale,
  });
  return { context, page: await context.newPage() };
}

/** A page section of the app (Tasks, Calendar, ...) by its route under /x/. */
export async function openPage(page: Page, route: string) {
  await page.goto(`/x/${route}`);
}

/** Waits for the "Saved" state of the note header (after typing, autosave runs on a short delay). */
export async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ }).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Leaves a table cell being edited. Escape first closes the formula help box when it is open, so
 * it is pressed until the cell's editor has gone.
 */
export async function leaveCell(page: Page, cellName: string) {
  const cell = page.getByRole('textbox', { name: cellName });
  for (let i = 0; i < 3 && (await cell.count()) > 0; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }
  await expect(cell).toHaveCount(0);
}

/**
 * Puts the caret in the note and waits until the editor's lazily loaded parts (rich paste and the
 * like) have arrived, as they have for anyone who has been editing for a moment.
 */
export async function focusEditor(page: Page) {
  await editor(page).locator('.cm-line').first().click();
  // Not 'networkidle': the live event stream never ends. The chunks load in well under a second.
  await page.waitForTimeout(1000);
}
