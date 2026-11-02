import { expect, test } from '@playwright/test';
import { createFile, unique } from '../../lib/api.ts';
import { editor, openNote } from '../../lib/ui.ts';

/**
 * Layout that only a real browser can check (jsdom has no layout): regressions found in the QA
 * pass of 2026-11-02 (qa/2026-11-02/FINDINGS.md).
 */

test('a note in a narrow split pane: the breadcrumb never runs under the save status @desktop', async ({ page }) => {
  const path = `${unique('A rather long note name for a narrow pane')}.md`;
  await createFile(path, '# Body\n');
  await openNote(page, path);
  await page.getByRole('button', { name: 'Split right' }).click();
  await expect(page.locator('.note-header-bar')).toHaveCount(2);
  const boxes = await page.locator('.note-header-bar').evaluateAll((bars) =>
    bars.map((bar) => {
      const crumb = bar.querySelector('.note-breadcrumb')!.getBoundingClientRect();
      // The buttons themselves, not their column: content can overflow a column that is too narrow.
      const buttons = [...bar.querySelector('.note-header-actions')!.children].map((c) => c.getBoundingClientRect());
      return {
        crumbRight: crumb.right,
        actionsLeft: Math.min(...buttons.map((r) => r.left)),
        actionsRight: Math.max(...buttons.map((r) => r.right)),
        barRight: bar.getBoundingClientRect().right,
      };
    }),
  );
  for (const b of boxes) {
    expect(b.crumbRight).toBeLessThanOrEqual(b.actionsLeft);
    expect(b.actionsRight).toBeLessThanOrEqual(b.barRight);
  }
});

test('a Dataview table keeps its words whole on a narrow screen @phone', async ({ page }) => {
  const dir = unique('Dataview');
  const tag = `dvtag${Date.now().toString(36)}`;
  for (const [name, status] of [['First', 'reading'], ['Second', 'abandoned'], ['Third', 'to-read']]) {
    await createFile(`${dir}/${name}.md`, `---\nauthor: Someone Withalongname\nrating: 4\nstatus: ${status}\ntags: [${tag}]\n---\n`);
  }
  const list = `${dir}/List.md`;
  await createFile(list, `# List\n\n\`\`\`dataview\nTABLE author, rating, status\nFROM #${tag}\n\`\`\`\n`);
  await openNote(page, list);
  const table = editor(page).locator('.cm-lp-script-output table');
  await expect(table.getByRole('cell', { name: 'abandoned' })).toBeVisible();
  // Every single-word cell is one line: no word was split to squeeze the table in.
  const split = await table.locator('th, td').evaluateAll((cells) =>
    cells
      .filter((c) => /^\S+$/.test(c.textContent!.trim()))
      .filter((c) => {
        const range = document.createRange();
        range.selectNodeContents(c);
        const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        return lines.size > 1;
      })
      .map((c) => c.textContent),
  );
  expect(split).toEqual([]);
});
