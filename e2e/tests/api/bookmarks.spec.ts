import { expect, test } from '@playwright/test';
import { call, createFile, move, refusal, trashFile, unique } from '../../lib/api.ts';

/**
 * Bookmarks (API.md §21): one list per vault in Obsidian's format, saved with a version. Saved
 * searches are being folded into bookmarks (`type: "search"`), so searches are tested here.
 *
 * Each test adds its own items to the shared list and removes them again, keeping whatever else
 * is bookmarked (the seed's, a person's).
 */
const get = () => call('GET', '/api/bookmarks');
const put = (items: unknown[], baseVersion: string | null) => call('PUT', '/api/bookmarks', { body: { items, baseVersion } });

async function withItems<T>(mine: any[], fn: (version: string) => Promise<T>) {
  const before = await get();
  const saved = await put([...before.items, ...mine], before.version);
  try {
    return await fn(saved.version);
  } finally {
    const now = await get();
    const keys = new Set(mine.map((i) => JSON.stringify(i)));
    const kept = now.items.filter((i: any) => !keys.has(JSON.stringify(i)) && !(i.title ?? '').startsWith('e2e '));
    await put(kept, now.version);
  }
}

test('files, headings, folders, searches and groups round-trip in Obsidian’s shape', async () => {
  const dir = unique('Bm');
  await createFile(`${dir}/Plan.md`, '# Plan\n\n## Goals\n');
  const now = Date.now();
  const mine = [
    { type: 'file', ctime: now, path: `${dir}/Plan.md` },
    { type: 'file', ctime: now, path: `${dir}/Plan.md`, subpath: '#Goals', title: 'e2e goals' },
    { type: 'folder', ctime: now, path: dir },
    { type: 'search', ctime: now, query: 'tag:#work -path:Archive', title: 'e2e open work' },
    { type: 'group', ctime: now, title: 'e2e group', items: [{ type: 'file', ctime: now, path: `${dir}/Plan.md` }] },
    // Obsidian's own kinds this app does not show are kept as they are.
    { type: 'url', ctime: now, url: 'https://example.com', title: 'e2e url', extra: { kept: true } },
  ];
  await withItems(mine, async () => {
    const r = await get();
    for (const item of mine) expect(r.items).toContainEqual(item);
    expect(r.version).toMatch(/^[0-9a-f]{40}$/);
  });
});

test('a stale version is a conflict; the same list saved again is not', async () => {
  const before = await get();
  const item = { type: 'search', ctime: 1, query: `e2e-${Date.now()}`, title: 'e2e stale' };
  const saved = await put([...before.items, item], before.version);
  // Another device saved meanwhile: this one's change must be re-applied on top.
  const r = await refusal('PUT', '/api/bookmarks', { body: { items: before.items, baseVersion: before.version } });
  expect(r).toMatchObject({ status: 409, code: 'version-conflict' });
  expect(JSON.parse(r.problem.currentContent).items).toContainEqual(item);
  // Saving exactly what is stored succeeds whatever the base.
  const same = await put([...before.items, item], before.version);
  expect(same.version).toBe(saved.version);
  await put(before.items, saved.version);
});

test('invalid items are refused with the field that is wrong', async () => {
  const { version, items } = await get();
  const r = await refusal('PUT', '/api/bookmarks', {
    body: { baseVersion: version, items: [...items, { type: 'file' }, { type: 'search', query: '   ' }, { type: 'file', path: '../x.md' }] },
  });
  expect(r).toMatchObject({ status: 400, code: 'bad-request' });
  const fields = r.problem.errors.map((e: any) => e.field);
  expect(fields).toContain(`items[${items.length}].path`);
  expect(fields).toContain(`items[${items.length + 1}].query`);
  expect(fields).toContain(`items[${items.length + 2}].path`);
});

test('bookmarks follow a moved note, and stay (as missing) when it is trashed', async () => {
  const dir = unique('BmMove');
  await createFile(`${dir}/Note.md`, '# Note\n\n## Part\n');
  const mine = [
    { type: 'file', ctime: 2, path: `${dir}/Note.md`, title: 'e2e follow' },
    { type: 'file', ctime: 2, path: `${dir}/Note.md`, subpath: '#Part', title: 'e2e follow part' },
  ];
  await withItems(mine, async () => {
    await move(`${dir}/Note.md`, `${dir}/Moved/Renamed.md`);
    await expect.poll(async () => (await get()).items.filter((i: any) => i.title?.startsWith('e2e follow')).map((i: any) => i.path))
      .toEqual([`${dir}/Moved/Renamed.md`, `${dir}/Moved/Renamed.md`]);
    await trashFile(`${dir}/Moved/Renamed.md`);
    expect((await get()).items.filter((i: any) => i.title?.startsWith('e2e follow'))).toHaveLength(2);
  });
});
