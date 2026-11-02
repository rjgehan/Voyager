import { expect, test } from '@playwright/test';
import { call, createFile, readFile, refusal, unique } from '../../lib/api.ts';

/** Properties across the vault (API.md §38): names, values, types and renaming. */

test('every property is listed with a count and what its values look like', async () => {
  const p = `e2eprop${Date.now().toString(36)}`;
  const dir = unique('Props');
  await createFile(`${dir}/A.md`, `---\n${p}_n: 3\n${p}_d: 2026-10-21\n${p}_b: true\n${p}_l: [a, b]\n---\n`);
  await createFile(`${dir}/B.md`, `---\n${p}_n: 4\n${p}_d: 2026-10-22\n---\n`);
  const all = (await call('GET', '/api/properties')).properties;
  const mine = Object.fromEntries(all.filter((x: any) => x.name.startsWith(p)).map((x: any) => [x.name, x]));
  expect(mine[`${p}_n`]).toMatchObject({ count: 2, inferred: 'number', type: null });
  expect(mine[`${p}_d`]).toMatchObject({ count: 2, inferred: 'date' });
  expect(mine[`${p}_b`]).toMatchObject({ count: 1, inferred: 'checkbox' });
  expect(mine[`${p}_l`]).toMatchObject({ count: 1, inferred: 'multitext' });

  const values = await call('GET', `/api/properties/values?name=${p}_n`);
  expect(values.values.map((v: any) => v.value).sort()).toEqual(['3', '4']);
});

test('a property type is stored in Obsidian’s types.json format', async () => {
  const name = `e2etype${Date.now().toString(36)}`;
  const set = await call('PUT', '/api/properties/types', { body: { name, type: 'date' } });
  expect(set.types[name]).toBe('date');
  expect(set.source).toBe('notesapp');
  expect(await refusal('PUT', '/api/properties/types', { body: { name, type: 'colour' } })).toMatchObject({ status: 400 });
  const cleared = await call('PUT', '/api/properties/types', { body: { name, type: null } });
  expect(cleared.types[name]).toBeUndefined();
});

test('renaming a property rewrites only its key, in every note', async () => {
  const from = `e2estatus${Date.now().toString(36)}`;
  const to = `${from}_phase`;
  const dir = unique('Rename');
  const a = `---\n# a comment\n${from}: open   # trailing\nother: 1\n---\nBody stays.\n`;
  await createFile(`${dir}/A.md`, a);
  await createFile(`${dir}/B.md`, `---\n${from.toUpperCase()}: done\n---\n`);
  await createFile(`${dir}/C.md`, `---\n${from}: x\n${to}: already\n---\n`);

  const dry = await call('POST', '/api/properties/rename', { body: { from, to, dryRun: true } });
  expect(dry.updates.map((u: any) => u.path).sort()).toEqual([`${dir}/A.md`, `${dir}/B.md`]);
  expect(dry.failed).toEqual([{ path: `${dir}/C.md`, reason: 'property-exists' }]);
  expect((await readFile(`${dir}/A.md`)).content).toBe(a);

  const res = await call('POST', '/api/properties/rename', { body: { from, to } });
  expect(res.commitId).toMatch(/^[0-9a-f]{40}$/);
  // Byte for byte except the key: comments, spacing and the body are untouched.
  expect((await readFile(`${dir}/A.md`)).content).toBe(a.replace(`${from}: open`, `${to}: open`));
  expect((await readFile(`${dir}/B.md`)).content).toBe(`---\n${to}: done\n---\n`);
  expect(await refusal('POST', '/api/properties/rename', { body: { from: to, to } })).toMatchObject({ status: 400 });
});
