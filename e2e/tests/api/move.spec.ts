import { expect, test } from '@playwright/test';
import { backlinks, call, createFile, move, newList, newTask, readFile, refusal, tree, unique } from '../../lib/api.ts';

/** Rename and move rewrite the links that point at what moved (API.md §10.3, DESIGN §5.6). */

test('renaming a note rewrites every link to it, in notes and in task lists', async () => {
  // Basenames are unique too: `[[Plan]]` resolves vault-wide, and other tests make notes.
  const dir = unique('Move');
  const plan = unique('Plan');
  const roadmap = unique('Roadmap');
  await createFile(`${dir}/${plan}.md`, '# Plan\n\n## Goals\n\nShip it.\n');
  await createFile(`${dir}/Uses.md`, [
    `Wiki [[${plan}]] and [[${plan}|our plan]] and [[${plan}#Goals]].`,
    `Markdown [the plan](${encodeURI(plan)}.md) and an embed ![[${plan}]].`,
    `\`[[${plan}]]\` in code stays.`,
    '',
  ].join('\n'));
  const list = await newList(unique('Move list'));
  const task = await newTask({ title: `Read [[${plan}]]`, listId: list.id, links: [`${dir}/${plan}.md`] });

  const preview = await move(`${dir}/${plan}.md`, `${dir}/${roadmap}.md`, { dryRun: true });
  expect(preview.dryRun).toBe(true);
  expect(preview.linkUpdates.map((u: any) => u.path).sort()).toEqual([`${dir}/Uses.md`, list.path].sort());
  expect(preview.linkUpdates.every((u: any) => u.version === null)).toBe(true);
  expect((await tree()).files.some((f) => f.path === `${dir}/${plan}.md`)).toBe(true); // nothing moved yet

  const res = await move(`${dir}/${plan}.md`, `${dir}/${roadmap}.md`);
  expect(res).toMatchObject({ type: 'file', from: `${dir}/${plan}.md`, to: `${dir}/${roadmap}.md`, failed: [] });
  expect(res.moved).toEqual([{ from: `${dir}/${plan}.md`, to: `${dir}/${roadmap}.md` }]);
  const uses = res.linkUpdates.find((u: any) => u.path === `${dir}/Uses.md`);
  expect(uses.links).toBe(5);

  const text = (await readFile(`${dir}/Uses.md`)).content;
  expect(text).toContain(`[[${roadmap}]] and [[${roadmap}|our plan]] and [[${roadmap}#Goals]]`);
  expect(text).toContain(`[the plan](${encodeURI(roadmap)}.md) and an embed ![[${roadmap}]]`);
  expect(text).toContain(`\`[[${plan}]]\` in code stays.`);
  expect((await readFile(`${dir}/Uses.md`)).version).toBe(uses.version);

  const after = await call('GET', `/api/tasks/${task.id}`);
  expect(after.title).toBe(`Read [[${roadmap}]]`);
  expect(after.links).toEqual([`${dir}/${roadmap}.md`]);

  // Backlinks follow: the new path has them, the old one has none.
  const bl = await backlinks(`${dir}/${roadmap}.md`);
  expect(bl.linked.map((g: any) => g.source).sort()).toEqual([`${dir}/Uses.md`, list.path].sort());
});

test('moving with updateLinks off leaves links alone (they become unresolved)', async () => {
  const dir = unique('NoUpdate');
  await createFile(`${dir}/A.md`, '# A\n');
  await createFile(`${dir}/B.md`, 'See [[A]].\n');
  const res = await move(`${dir}/A.md`, `${dir}/Sub/A2.md`, { updateLinks: false });
  expect(res.linkUpdates).toEqual([]);
  expect(res.createdFolders).toEqual([`${dir}/Sub`]);
  expect((await readFile(`${dir}/B.md`)).content).toBe('See [[A]].\n');
});

test('moving a folder moves everything in it and rewrites path-style links', async () => {
  const dir = unique('Folder');
  await createFile(`${dir}/Old/One.md`, '# One\n');
  await createFile(`${dir}/Old/Deep/Two.md`, 'Back to [[One]].\n');
  await createFile(`${dir}/Index.md`, `[[${dir}/Old/Deep/Two]] and [one](Old/One.md)\n`);
  const res = await move(`${dir}/Old`, `${dir}/New`);
  expect(res.type).toBe('folder');
  expect(res.moved.map((m: any) => m.to).sort()).toEqual([`${dir}/New/Deep/Two.md`, `${dir}/New/One.md`]);
  // Rewritten links are written in the vault's link format ("shortest" by default), so check
  // where they lead rather than their text.
  const index = (await readFile(`${dir}/Index.md`)).content;
  expect(index).not.toContain('Old/');
  expect((await backlinks(`${dir}/New/Deep/Two.md`)).linked.map((g: any) => g.source)).toContain(`${dir}/Index.md`);
  expect((await backlinks(`${dir}/New/One.md`)).linked.map((g: any) => g.source)).toContain(`${dir}/Index.md`);
  const folders = (await tree()).folders.map((f) => f.path);
  expect(folders).toContain(`${dir}/New/Deep`);
  expect(folders).not.toContain(`${dir}/Old`);
});

test('a move is refused when the target exists, or a folder goes into itself', async () => {
  const dir = unique('Refuse');
  await createFile(`${dir}/A.md`);
  await createFile(`${dir}/B.md`);
  await createFile(`${dir}/Box/C.md`);
  expect(await refusal('POST', '/api/move', { body: { from: `${dir}/A.md`, to: `${dir}/B.md` } })).toMatchObject({ status: 409, code: 'already-exists' });
  expect(await refusal('POST', '/api/move', { body: { from: `${dir}/Box`, to: `${dir}/Box/Inner` } })).toMatchObject({ status: 400, code: 'move-into-self' });
  expect(await refusal('POST', '/api/move', { body: { from: `${dir}/Missing.md`, to: `${dir}/X.md` } })).toMatchObject({ status: 404 });
  expect(await refusal('POST', '/api/move', { body: { from: `${dir}/A.md`, to: `${dir}/A?.md` } })).toMatchObject({ status: 400, code: 'invalid-name' });
  // A case-only rename is allowed.
  const res = await move(`${dir}/A.md`, `${dir}/a.md`);
  expect(res.to).toBe(`${dir}/a.md`);
});

test('a drawing or spreadsheet that links to a moved note is reported, not rewritten', async () => {
  const dir = unique('NotRewritable');
  const target = unique('Target');
  await createFile(`${dir}/${target}.md`, '# Target\n');
  const sheet = {
    type: 'notesapp-sheet', version: 1, engine: '', named: {},
    sheets: [{ id: 's1', name: 'Sheet1', cells: { A1: { v: `[[${target}]]` } }, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } }],
  };
  await createFile(`${dir}/Links.sheet`, JSON.stringify(sheet, null, 2) + '\n');
  expect((await backlinks(`${dir}/${target}.md`)).linked.map((g: any) => g.source)).toEqual([`${dir}/Links.sheet`]);
  const res = await move(`${dir}/${target}.md`, `${dir}/${target} renamed.md`);
  expect(res.failed).toEqual([{ path: `${dir}/Links.sheet`, reason: 'not-rewritable' }]);
});
