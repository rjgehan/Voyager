import { expect, test } from '@playwright/test';
import { ApiError, call, createFile, move, q, readFile, refusal, saveFile, trashFile, tree, unique } from '../../lib/api.ts';

/**
 * Text files and the version protocol (API.md §4, §8): the rules that keep a keystroke from
 * ever being lost between the phone and the PC.
 */
const EMPTY = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';

test('create, read and save: the version is the git blob id of the bytes', async () => {
  const path = `${unique('Files')}/Plan.md`;
  const made = await createFile(path, '');
  expect(made.created).toBe(true);
  expect(made.file).toMatchObject({ path, kind: 'note', extension: 'md', basename: 'Plan', version: EMPTY });
  expect(made.createdFolders).toEqual([path.split('/')[0]]);

  const saved = await saveFile(path, 'hello\n', EMPTY);
  // API.md §1.6: "hello\n" hashes to this, on any machine.
  expect(saved.file.version).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  const read = await readFile(path);
  expect(read).toMatchObject({ content: 'hello\n', version: saved.file.version, lossy: false });
  expect((await tree()).files.find((f) => f.path === path)?.version).toBe(saved.file.version);
});

test('a save from a stale version is a 409 that carries the server copy', async () => {
  const path = `${unique('Conflict')}.md`;
  const v1 = (await createFile(path, 'from the PC\n')).file.version;
  const v2 = (await saveFile(path, 'edited on the iPhone\n', v1)).file.version;

  const r = await refusal('PUT', `/api/files?path=${q(path)}`, { body: { content: 'typed on the PC\n', baseVersion: v1 } });
  expect(r.status).toBe(409);
  expect(r.problem).toMatchObject({
    code: 'version-conflict',
    type: 'urn:notesapp:problem:version-conflict',
    path,
    currentVersion: v2,
    currentContent: 'edited on the iPhone\n',
    movedTo: null,
  });
  expect(r.problem.currentMtime).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  // Nothing was written.
  expect((await readFile(path)).content).toBe('edited on the iPhone\n');

  // Keep mine: the same content on top of the server's version, flushing history first.
  const kept = await saveFile(path, 'typed on the PC\n', v2, { flushHistory: true });
  expect((await readFile(path)).version).toBe(kept.file.version);
});

test('equal content is never a conflict: a retried save succeeds whatever its base says', async () => {
  const path = `${unique('Idempotent')}.md`;
  const v1 = (await createFile(path, 'one\n')).file.version;
  const v2 = (await saveFile(path, 'two\n', v1)).file.version;
  // The response to the first save was "lost" and the client retries it with the old base.
  const again = await saveFile(path, 'two\n', v1);
  expect(again.file.version).toBe(v2);
});

test('a null base creates; on an existing file it conflicts', async () => {
  const path = `${unique('Create')}/Deep/Note.md`;
  const made = await saveFile(path, '# Made by PUT\n', null);
  expect(made.created).toBe(true);
  const r = await refusal('PUT', `/api/files?path=${q(path)}`, { body: { content: 'other\n', baseVersion: null } });
  expect(r).toMatchObject({ status: 409, code: 'version-conflict' });
  expect(r.problem.currentContent).toBe('# Made by PUT\n');
});

test('saving a note that was deleted or moved meanwhile says so', async () => {
  const dir = unique('Gone');
  const deleted = `${dir}/Deleted.md`;
  const v = (await createFile(deleted, 'x\n')).file.version;
  await trashFile(deleted);
  const r1 = await refusal('PUT', `/api/files?path=${q(deleted)}`, { body: { content: 'y\n', baseVersion: v } });
  expect(r1.problem).toMatchObject({ code: 'version-conflict', currentVersion: null, currentContent: null, movedTo: null });

  const moved = `${dir}/Before.md`;
  const mv = (await createFile(moved, 'x\n')).file.version;
  await move(moved, `${dir}/After.md`);
  const r2 = await refusal('PUT', `/api/files?path=${q(moved)}`, { body: { content: 'y\n', baseVersion: mv } });
  expect(r2.problem).toMatchObject({ code: 'version-conflict', currentVersion: null, movedTo: `${dir}/After.md` });
  // Follow the move: the same base works at the new path, since a pure move keeps the version.
  await saveFile(`${dir}/After.md`, 'y\n', mv);
  expect((await readFile(`${dir}/After.md`)).content).toBe('y\n');
});

test('"rename" picks the next free name; "fail" and case variants are refused', async () => {
  const dir = unique('Untitled');
  await createFile(`${dir}/Untitled.md`);
  const second = await createFile(`${dir}/Untitled.md`, '', { onConflict: 'rename' });
  expect(second.file.path).toBe(`${dir}/Untitled 1.md`);
  const third = await createFile(`${dir}/Untitled.md`, '', { onConflict: 'rename' });
  expect(third.file.path).toBe(`${dir}/Untitled 2.md`);

  expect(await refusal('POST', '/api/files', { body: { path: `${dir}/Untitled.md` } })).toMatchObject({ status: 409, code: 'already-exists' });
  const cased = await refusal('POST', '/api/files', { body: { path: `${dir}/UNTITLED.md` } });
  expect(cased).toMatchObject({ status: 409 });
  expect(['already-exists', 'case-collision']).toContain(cased.code);
  expect(cased.problem.existingPath).toBe(`${dir}/Untitled.md`);
  // An implicit parent resolves to the existing folder whatever its case.
  const lower = await createFile(`${dir.toLowerCase()}/Lower.md`);
  expect(lower.file.path).toBe(`${dir}/Lower.md`);
});

test('an Idempotency-Key makes a retried create return the first result', async () => {
  const dir = unique('Idem');
  const key = `k-${Date.now()}-abcdef`;
  const body = { path: `${dir}/Untitled.md`, content: '', onConflict: 'rename' };
  const a = await call('POST', '/api/files', { body, headers: { 'idempotency-key': key } });
  const b = await call('POST', '/api/files', { body, headers: { 'idempotency-key': key } });
  expect(b.file.path).toBe(a.file.path);
  expect((await tree()).files.filter((f) => f.path.startsWith(`${dir}/`))).toHaveLength(1);
});

test('names and paths are checked before anything touches the disk', async () => {
  const dir = unique('Names');
  const cases: [string, number, string][] = [
    [`${dir}/a:b.md`, 400, 'invalid-name'],
    [`${dir}/what?.md`, 400, 'invalid-name'],
    [`${dir}/Plan #2.md`, 400, 'invalid-name'],
    [`${dir}/[[x]].md`, 400, 'invalid-name'],
    [`${dir}/con.md`, 400, 'invalid-name'],
    [`${dir}/ends with a dot./x.md`, 400, 'invalid-name'],
    [`${dir}/ leading space.md`, 400, 'invalid-name'],
    [`${dir}/../escape.md`, 400, 'invalid-path'],
    [`/${dir}/leading.md`, 400, 'invalid-path'],
    [`${dir}\\back.md`, 400, 'invalid-path'],
    ['.git/config.md', 403, 'reserved-path'],
    [`${dir}/.hidden.md`, 403, 'reserved-path'],
    ['.notesapp/settings.md', 403, 'reserved-path'],
  ];
  for (const [path, status, code] of cases) {
    expect(await refusal('POST', '/api/files', { body: { path, content: '' } }), path).toMatchObject({ status, code });
  }
  // Reads are checked the same way: nothing under a dot folder is ever served.
  expect(await refusal('GET', `/api/files?path=${q('.notesapp/settings.json')}`)).toMatchObject({ status: 403, code: 'reserved-path' });
  expect(await refusal('GET', `/api/files?path=${q('../outside.md')}`)).toMatchObject({ status: 400, code: 'invalid-path' });
  expect(await refusal('GET', `/api/files?path=${q(`${dir}/missing.md`)}`)).toMatchObject({ status: 404, code: 'not-found' });
});

test('a + in a path survives the query string when encoded', async () => {
  const path = `${unique('Plus')} + notes.md`;
  await createFile(path, 'plus\n');
  expect((await readFile(path)).path).toBe(path);
});

test('binary files are not text: the text API refuses them with 415', async () => {
  const path = `${unique('Bin')}.png`;
  await call('PUT', `/api/files/raw?path=${q(path)}`, { raw: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), headers: { 'content-type': 'image/png' } });
  const r = await refusal('GET', `/api/files?path=${q(path)}`);
  expect(r).toMatchObject({ status: 415, code: 'not-text' });
  const entry = (await tree()).files.find((f) => f.path === path);
  expect(entry).toMatchObject({ kind: 'image', version: null });
});

test('JSON endpoints refuse other media types', async () => {
  const r = await refusal('POST', '/api/files', { raw: '{"path":"x.md"}', headers: { 'content-type': 'text/plain' } });
  expect(r).toMatchObject({ status: 415, code: 'unsupported-media-type' });
});

test('every API error is problem+json with a stable code', async () => {
  try {
    await call('GET', `/api/files?path=${q(`${unique('Nope')}.md`)}`);
    throw new Error('expected a 404');
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    const err = e as ApiError;
    expect(err.problem).toMatchObject({ status: 404, code: 'not-found', type: 'urn:notesapp:problem:not-found', title: 'Not found' });
  }
});
