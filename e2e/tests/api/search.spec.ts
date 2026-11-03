import { expect, test } from '@playwright/test';
import { createFile, madeUpWord, newList, newTask, refusal, search, unique, uploadRaw } from '../../lib/api.ts';
import { pdf } from '../../lib/fixtures.ts';

/**
 * Full-text search (API.md §12.1): words, phrases, filters and negation over notes, and over the
 * indexed text of task lists, spreadsheets and PDFs (§1.8, §12.5). Every test searches for a
 * made-up word of its own, so the shared vault never answers for it.
 */
const word = () => `zq${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const paths = (r: any) => r.results.map((x: any) => x.path).sort();

test('a word, a phrase, a tag, a folder and a negation', async () => {
  const w = word();
  const dir = unique('Search');
  await createFile(`${dir}/Work/Weekly review.md`, `---\ntags: [work]\n---\n# Weekly review\n\nThe ${w} weekly review covers open loops.\n`);
  await createFile(`${dir}/Home/Draft.md`, `A ${w} draft about the weekly plan. #home/draft\n`);
  await createFile(`${dir}/Home/Other.md`, `Nothing to see.\n`);

  expect(paths(await search(w))).toEqual([`${dir}/Home/Draft.md`, `${dir}/Work/Weekly review.md`]);
  expect(paths(await search(`"${w} weekly review"`))).toEqual([`${dir}/Work/Weekly review.md`]);
  expect(paths(await search(`${w} tag:#work`))).toEqual([`${dir}/Work/Weekly review.md`]);
  // Nested tags match their parent.
  expect(paths(await search(`${w} tag:#home`))).toEqual([`${dir}/Home/Draft.md`]);
  expect(paths(await search(`${w} path:"${dir}/Home"`))).toEqual([`${dir}/Home/Draft.md`]);
  expect(paths(await search(`${w} -draft`))).toEqual([`${dir}/Work/Weekly review.md`]);

  const hit = (await search(`"${w} weekly review"`)).results[0];
  expect(hit).toMatchObject({ kind: 'note', basename: 'Weekly review' });
  const m = hit.matches[0];
  expect(m.text.slice(m.ranges[0].from, m.ranges[0].to).toLowerCase()).toContain(w);
  expect(m.line).toBe(5); // 0-based, frontmatter counted
});

test('typos are corrected and say so; prefix matching for search-as-you-type', async () => {
  // Runs pile up in the vault until the next reset, so an earlier run's word is there as well.
  await createFile(`${unique('Fuzzy')}.md`, `The ${madeUpWord('vermillion')} door.\n`);
  const w = madeUpWord('vermillion');
  await createFile(`${unique('Fuzzy')}.md`, `The ${w} door.\n`);
  const typo = w.slice(0, 3) + w[4] + w[3] + w.slice(5); // two letters swapped
  const r = await search(typo);
  expect(r.total).toBe(1);
  expect(r.corrections[0].replacements).toContain(w);
  expect((await search(typo, '&fuzzy=false')).total).toBe(0);
  expect((await search(w.slice(0, -3), '&prefix=true')).total).toBe(1);
});

test('properties are searchable as [name] and [name:value]', async () => {
  const w = word();
  const dir = unique('Props');
  await createFile(`${dir}/Active.md`, `---\nstatus: active\nrating: 5\n---\n${w}\n`);
  await createFile(`${dir}/Done.md`, `---\nstatus: done\n---\n${w}\n`);
  await createFile(`${dir}/None.md`, `${w}\n`);
  expect(paths(await search(`${w} [status]`))).toEqual([`${dir}/Active.md`, `${dir}/Done.md`]);
  expect(paths(await search(`${w} [status:active]`))).toEqual([`${dir}/Active.md`]);
  expect(paths(await search(`${w} [rating:5]`))).toEqual([`${dir}/Active.md`]);
});

test('tasks, spreadsheet cells and PDF text are found like notes', async () => {
  const w = word();
  const dir = unique('Docs');
  const list = await newList(unique('Search list'));
  await newTask({ title: `Buy ${w} for the hall`, listId: list.id });
  const sheet = {
    type: 'notesapp-sheet', version: 1, engine: '', named: {},
    sheets: [{ id: 's1', name: 'Costs', cells: { A1: { v: `${w} paint` }, B1: { v: 12 } }, cols: {}, rows: {}, frozen: { rows: 0, cols: 0 } }],
  };
  await createFile(`${dir}/Costs.sheet`, JSON.stringify(sheet) + '\n');
  await uploadRaw(`${dir}/Spec.pdf`, pdf('Spec', [`The ${w} cabinets are oak.`]), 'application/pdf');

  // PDF text is extracted in the background.
  await expect.poll(async () => paths(await search(w)), { timeout: 20_000 }).toEqual([`${dir}/Costs.sheet`, `${dir}/Spec.pdf`, list.path].sort());
  const r = await search(w);
  const pdfHit = r.results.find((x: any) => x.path.endsWith('.pdf'));
  expect(pdfHit).toMatchObject({ kind: 'pdf' });
  expect(pdfHit.matches[0].page).toBe(1);
  const taskHit = r.results.find((x: any) => x.path === list.path);
  expect(taskHit.matches[0].text).toContain(`Buy ${w} for the hall`);
  // Never the file's JSON: a key name is not a hit.
  expect((await search(`notesapp-sheet ${w}`)).total).toBe(0);
});

test('search refuses bad parameters with a field error', async () => {
  expect(await refusal('GET', '/api/search?q=x&limit=0')).toMatchObject({ status: 400, code: 'bad-request' });
  expect(await refusal('GET', '/api/search?q=x&sort=sideways')).toMatchObject({ status: 400, code: 'bad-request' });
  const tooLong = await refusal('GET', `/api/search?q=${'a'.repeat(2001)}`);
  expect(tooLong).toMatchObject({ status: 400, code: 'bad-request' });
  expect(tooLong.problem.errors[0].field).toBe('q');
  expect((await search('')).total).toBe(0);
});
