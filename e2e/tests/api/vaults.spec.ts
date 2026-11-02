import { expect, test } from '@playwright/test';
import { call, createFile, newList, newTask, q, readFile, refusal, search, tree, unique } from '../../lib/api.ts';

/**
 * Multiple vaults (API.md §41): an extra vault has the same API under /api/v/<name>/ and shares
 * nothing with the default vault. The suite keeps one extra vault for this (the server allows 20),
 * so repeated runs do not use them up.
 */
const VAULT = 'e2e-isolation';

test.beforeAll(async () => {
  const { vaults } = await call('GET', '/api/vaults');
  if (!vaults.some((v: any) => v.name === VAULT)) {
    const made = await call('POST', '/api/vaults', { body: { name: VAULT } });
    expect(made).toMatchObject({ name: VAULT, isDefault: false, state: 'starting', url: `/v/${VAULT}/` });
  }
  await expect.poll(async () => (await call('GET', '/api/vaults')).vaults.find((v: any) => v.name === VAULT)?.state, { timeout: 60_000 }).toBe('ready');
});

test('the same path in two vaults is two files', async () => {
  const path = `${unique('Same')}/Note.md`;
  const word = `iso${Date.now().toString(36)}`;
  await createFile(path, `main ${word}\n`);
  await createFile(path, `extra ${word}\n`, { vault: VAULT });
  expect((await readFile(path)).content).toBe(`main ${word}\n`);
  expect((await readFile(path, VAULT)).content).toBe(`extra ${word}\n`);

  const only = `${unique('Only extra')}.md`;
  await createFile(only, 'x\n', { vault: VAULT });
  expect((await tree(VAULT)).files.some((f) => f.path === only)).toBe(true);
  expect((await tree()).files.some((f) => f.path === only)).toBe(false);
  expect(await refusal('GET', `/api/files?path=${q(only)}`)).toMatchObject({ status: 404 });

  // Search, tasks and the trash are per vault too.
  expect((await search(word)).results.map((r: any) => r.path)).toEqual([path]);
  expect((await search(word, '', VAULT)).results.map((r: any) => r.path)).toEqual([path]);
  const list = await newList(unique('Extra list'), {}, VAULT);
  const task = await newTask({ title: 'Only here', listId: list.id }, VAULT);
  expect(await refusal('GET', `/api/tasks/${task.id}`)).toMatchObject({ status: 404 });
  expect((await call('GET', `/api/tasks/${task.id}`, { vault: VAULT })).title).toBe('Only here');
  const entry = await call('DELETE', `/api/files?path=${q(only)}`, { vault: VAULT });
  expect((await call('GET', '/api/trash')).entries.some((e: any) => e.id === entry.id)).toBe(false);
});

test('paths in an extra vault never reach the default vault', async () => {
  for (const p of ['../vault/Welcome.md', '..%2Fvault%2FWelcome.md', '/Welcome.md', 'C:/Windows/win.ini']) {
    const r = await refusal('GET', `/api/v/${VAULT}/files?path=${encodeURIComponent(p)}`);
    expect(r.status, p).toBeGreaterThanOrEqual(400);
  }
});

test('names: the default vault answers as main; unknown and malformed names are 404', async () => {
  const main = await call('GET', '/api/v/main/tree');
  expect(main.files.length).toBe((await tree()).files.length);
  expect(await refusal('GET', '/api/v/nope-not-here/tree')).toMatchObject({ status: 404, code: 'vault-not-found' });
  expect((await refusal('GET', `/api/v/${VAULT.toUpperCase()}/tree`)).status).toBe(404);
  expect((await refusal('GET', `/api/v/${VAULT}/vaults`)).status).toBe(404); // server-wide only
  expect(await refusal('POST', '/api/vaults', { body: { name: 'Bad Name' } })).toMatchObject({ status: 400, code: 'invalid-name' });
  expect(await refusal('POST', '/api/vaults', { body: { name: 'main' } })).toMatchObject({ status: 409, code: 'already-exists' });
  expect(await refusal('POST', '/api/vaults', { body: { name: VAULT } })).toMatchObject({ status: 409, code: 'already-exists' });
});

test('the app of an extra vault is served under /v/<name>/', async () => {
  const { vaults } = await call('GET', '/api/vaults');
  expect(vaults[0]).toMatchObject({ name: 'main', isDefault: true, url: '/' });
  expect(vaults.find((v: any) => v.name === VAULT)).toMatchObject({ url: `/v/${VAULT}/` });
});
