import { expect, test } from '@playwright/test';
import { call, commitNow, createFile, move, q, readFile, refusal, saveFile, trashFile, tree, unique } from '../../lib/api.ts';

/** The trash (API.md §13) and the git history of every change (§14). */

test('a deleted note goes to the trash and comes back as it was', async () => {
  const path = `${unique('Trash')}/Note.md`;
  await createFile(path, '# Keep me\n\nWith [[Links]].\n');
  const entry = await trashFile(path);
  expect(entry).toMatchObject({ originalPath: path, type: 'file', fileCount: 1, deletedBy: 'owner@notes' });
  expect(entry.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  expect((await tree()).files.some((f) => f.path === path)).toBe(false);

  const list = await call('GET', '/api/trash');
  expect(list.entries[0]).toMatchObject({ id: entry.id, originalPath: path }); // newest first
  const raw = await call('GET', `/api/trash/${entry.id}/raw`);
  expect(raw).toBe('# Keep me\n\nWith [[Links]].\n');

  const restored = await call('POST', `/api/trash/${entry.id}/restore`, { body: {} });
  expect(restored).toMatchObject({ type: 'file', path });
  expect((await readFile(path)).content).toBe('# Keep me\n\nWith [[Links]].\n');
  expect((await call('GET', '/api/trash')).entries.some((e: any) => e.id === entry.id)).toBe(false);
});

test('restoring over a path that was taken again asks, or picks a free name', async () => {
  const path = `${unique('Taken')}/Note.md`;
  await createFile(path, 'old\n');
  const entry = await trashFile(path);
  await createFile(path, 'new\n');
  expect(await refusal('POST', `/api/trash/${entry.id}/restore`, { body: {} })).toMatchObject({ status: 409, code: 'already-exists' });
  const renamed = await call('POST', `/api/trash/${entry.id}/restore`, { body: { onConflict: 'rename' } });
  expect(renamed.path).toBe(path.replace('Note.md', 'Note 1.md'));
  expect((await readFile(renamed.path)).content).toBe('old\n');
  expect((await readFile(path)).content).toBe('new\n');
});

test('a folder is one trash entry and is restored whole', async () => {
  const dir = unique('TrashFolder');
  await createFile(`${dir}/A.md`, 'a\n');
  await createFile(`${dir}/Sub/B.md`, 'b\n');
  const entry = await call('DELETE', `/api/folders?path=${q(dir)}`);
  expect(entry).toMatchObject({ type: 'folder', fileCount: 2, originalPath: dir });
  expect((await tree()).files.some((f) => f.path.startsWith(`${dir}/`))).toBe(false);
  const restored = await call('POST', `/api/trash/${entry.id}/restore`, { body: {} });
  expect(restored.files.map((f: any) => f.path).sort()).toEqual([`${dir}/A.md`, `${dir}/Sub/B.md`]);
});

test('an entry can be deleted for good; a file path is not a folder', async () => {
  const path = `${unique('Purge')}.md`;
  await createFile(path, 'bye\n');
  const entry = await trashFile(path);
  await call('DELETE', `/api/trash/${entry.id}`);
  expect((await call('GET', '/api/trash')).entries.some((e: any) => e.id === entry.id)).toBe(false);
  expect(await refusal('POST', `/api/trash/${entry.id}/restore`, { body: {} })).toMatchObject({ status: 404 });
  const dir = unique('NotAFile');
  await createFile(`${dir}/x.md`);
  expect(await refusal('DELETE', `/api/files?path=${q(dir)}`)).toMatchObject({ status: 409, code: 'type-mismatch' });
});

test('history lists each saved version, newest first, and shows its content', async () => {
  const path = `${unique('History')}.md`;
  let v = (await createFile(path, 'v1\n')).file.version;
  await commitNow();
  v = (await saveFile(path, 'v2\n', v)).file.version;
  await commitNow();
  await saveFile(path, 'v3\n', v);
  // Not committed yet: the history says so.
  const pending = await call('GET', `/api/history?path=${q(path)}`);
  expect(pending.pending).toBe(true);
  await commitNow();

  const h = await call('GET', `/api/history?path=${q(path)}`);
  expect(h.pending).toBe(false);
  expect(h.entries.map((e: any) => e.change)).toEqual(['modified', 'modified', 'added']);
  expect(h.entries[0]).toMatchObject({ path, authorName: 'Owner', authorLogin: 'owner@notes' });
  expect(h.entries[0].commitId).toMatch(/^[0-9a-f]{40}$/);
  const oldest = h.entries[2];
  const content = await call('GET', `/api/history/content?path=${q(path)}&commit=${oldest.commitId}`);
  expect(content).toMatchObject({ content: 'v1\n', binary: false });
  // Short commit ids are refused: only full ids address a version.
  expect(await refusal('GET', `/api/history/content?path=${q(path)}&commit=${oldest.shortId}`)).toMatchObject({ status: 400 });
});

test('restoring an old version keeps the current one in history first', async () => {
  const path = `${unique('Restore')}.md`;
  let v = (await createFile(path, 'first draft\n')).file.version;
  await commitNow();
  v = (await saveFile(path, 'second draft\n', v)).file.version;
  await commitNow();
  const h = await call('GET', `/api/history?path=${q(path)}`);
  const first = h.entries.at(-1);
  // A stale base is refused like any save.
  expect(await refusal('POST', '/api/history/restore', { body: { path, commit: first.commitId, baseVersion: 'f'.repeat(40) } })).toMatchObject({ status: 409, code: 'version-conflict' });
  const res = await call('POST', '/api/history/restore', { body: { path, commit: first.commitId, baseVersion: v } });
  expect(res.commitId).toMatch(/^[0-9a-f]{40}$/);
  expect((await readFile(path)).content).toBe('first draft\n');
  const after = await call('GET', `/api/history?path=${q(path)}`);
  expect(after.entries[0].message).toMatch(/^Restore /);
  expect(after.entries.length).toBe(h.entries.length + 1);
});

test('history follows a rename, and a deleted file keeps its history', async () => {
  const dir = unique('Follow');
  await createFile(`${dir}/Before.md`, 'text\n');
  await commitNow();
  await move(`${dir}/Before.md`, `${dir}/After.md`);
  await commitNow();
  const h = await call('GET', `/api/history?path=${q(`${dir}/After.md`)}`);
  expect(h.entries[0]).toMatchObject({ change: 'renamed', renamedFrom: `${dir}/Before.md` });
  expect(h.entries.at(-1)).toMatchObject({ change: 'added', path: `${dir}/Before.md` });

  await trashFile(`${dir}/After.md`);
  await commitNow();
  const gone = await call('GET', `/api/history?path=${q(`${dir}/After.md`)}`);
  expect(gone.entries[0].change).toBe('deleted');
  const deleted = await call('GET', `/api/history/deleted?q=${encodeURIComponent(dir)}`);
  expect(JSON.stringify(deleted)).toContain(`${dir}/After.md`);
});
