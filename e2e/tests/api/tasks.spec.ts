import { expect, test } from '@playwright/test';
import { TZ, backlinks, call, createFile, day, newList, newSection, newTask, readFile, refusal, unique } from '../../lib/api.ts';

/** Structured tasks (API.md §20): server-owned changes to `.tasks` files in the vault. */

const view = (v: string, extra = '') => call('GET', `/api/tasks?view=${v}&date=${day(0)}${extra}`);

test('a task without a list goes to the Inbox, which is made the first time', async () => {
  const title = unique('Inbox task');
  const res = await call('POST', '/api/tasks', { body: { title } });
  expect(res.task).toMatchObject({ title, status: 'open', priority: 0, parentId: null });
  const lists = await call('GET', '/api/tasks/lists');
  const inbox = lists.lists.find((l: any) => l.id === res.task.listId);
  expect(inbox).toMatchObject({ name: 'Inbox', path: 'Tasks/Inbox.tasks', writable: true });
  // The list is an ordinary vault file, readable as JSON.
  const file = JSON.parse((await readFile('Tasks/Inbox.tasks')).content);
  expect(JSON.stringify(file)).toContain(title);
});

test('Today, Upcoming, a list and Completed show the right tasks in order', async () => {
  const list = await newList(unique('Views'));
  const t = (title: string, f: Record<string, unknown> = {}) => newTask({ title, listId: list.id, ...f });
  const overdue = await t('Overdue', { due: day(-2), priority: 1 });
  const todayHigh = await t('Today high', { due: day(0), priority: 3 });
  const started = await t('Started yesterday', { start: day(-1) });
  const later = await t('In five days', { due: day(5) });
  const someday = await t('No date');
  const ids = (r: any) => r.tasks.filter((x: any) => x.listId === list.id).map((x: any) => x.id);

  expect(ids(await view('today'))).toEqual([overdue.id, started.id, todayHigh.id]);
  expect(ids(await view('upcoming', '&days=7'))).toEqual([todayHigh.id, later.id]);
  expect(ids(await call('GET', `/api/tasks?view=list&list=${list.id}`))).toEqual([overdue.id, todayHigh.id, started.id, later.id, someday.id]);

  await call('POST', `/api/tasks/${todayHigh.id}/complete`, { body: { tz: TZ } });
  expect(ids(await view('today'))).toEqual([overdue.id, started.id]);
  const done = await call('GET', `/api/tasks?view=completed&list=${list.id}`);
  expect(done.tasks.map((x: any) => x.id)).toEqual([todayHigh.id]);
  expect(done.tasks[0].completedAt).toMatch(/Z$/);

  expect(await refusal('GET', '/api/tasks?view=today')).toMatchObject({ status: 400 }); // needs a date or tz
});

test('completing a repeating task rolls it forward; completing it again with the old base does nothing', async () => {
  const list = await newList(unique('Repeat'));
  const due = day(0);
  const task = await newTask({
    title: 'Water the plants', listId: list.id, due,
    recurrence: { rrule: 'FREQ=DAILY;INTERVAL=2', from: 'due' }, reminders: [{ at: `${due}T08:00` }],
  });
  const res = await call('POST', `/api/tasks/${task.id}/complete`, { body: { date: due, base: { due } } });
  expect(res.rolledForward).toBe(true);
  expect(res.task).toMatchObject({ status: 'open', due: day(2), reminders: [{ at: `${day(2)}T08:00` }] });
  // A retry whose response was lost: the occurrence it names is already done.
  const retry = await call('POST', `/api/tasks/${task.id}/complete`, { body: { date: due, base: { due } } });
  expect(retry.task.due).toBe(day(2));
  expect(retry.files).toEqual([]);
});

test('per-field versions: different fields from two devices both apply; the same field conflicts', async () => {
  const list = await newList(unique('Fields'));
  const task = await newTask({ title: 'Pay rent', listId: list.id, due: day(1) });
  // The phone changes the title, the PC the due date, both from what they last saw.
  await call('PATCH', `/api/tasks/${task.id}`, { body: { changes: { title: 'Pay the rent' }, base: { title: 'Pay rent' } } });
  await call('PATCH', `/api/tasks/${task.id}`, { body: { changes: { due: day(3) }, base: { due: day(1) } } });
  const now = await call('GET', `/api/tasks/${task.id}`);
  expect(now).toMatchObject({ title: 'Pay the rent', due: day(3) });
  // The PC also renamed it from the old title: that is a real conflict.
  const r = await refusal('PATCH', `/api/tasks/${task.id}`, { body: { changes: { title: 'Rent!' }, base: { title: 'Pay rent' } } });
  expect(r).toMatchObject({ status: 409, code: 'task-conflict' });
  expect(r.problem.fields).toEqual(['title']);
  expect(r.problem.task.title).toBe('Pay the rent');
});

test('subtasks, sections and reordering', async () => {
  const list = await newList(unique('Structure'));
  const errands = await newSection(list.id, 'Errands');
  const parent = await newTask({ title: 'Renovate', listId: list.id });
  const a = await newTask({ title: 'Quotes', listId: list.id, parentId: parent.id });
  const b = await newTask({ title: 'Book', listId: list.id, parentId: parent.id });
  const shop = await newTask({ title: 'Buy tiles', listId: list.id, sectionId: errands.id });
  expect(shop.sectionId).toBe(errands.id);

  await call('POST', '/api/tasks/reorder', { body: { listId: list.id, sectionId: null, parentId: parent.id, ids: [b.id], after: null } });
  const tasks = (await call('GET', `/api/tasks?view=list&list=${list.id}`)).tasks;
  const children = tasks.filter((x: any) => x.parentId === parent.id).sort((x: any, y: any) => (x.order < y.order ? -1 : 1));
  expect(children.map((x: any) => x.title)).toEqual(['Book', 'Quotes']);

  // Completing the parent completes its open subtasks.
  const done = await call('POST', `/api/tasks/${parent.id}/complete`, { body: { tz: TZ } });
  expect(done.changed.map((x: any) => x.id).sort()).toEqual([a.id, b.id].sort());
  // Deleting removes the whole subtree.
  const del = await call('DELETE', `/api/tasks/${parent.id}`);
  expect(del.deleted.sort()).toEqual([parent.id, a.id, b.id].sort());
  expect(await refusal('DELETE', `/api/tasks/${parent.id}`)).toMatchObject({ status: 404 });
});

test('fields are validated', async () => {
  const list = await newList(unique('Valid'));
  const bad = async (fields: Record<string, unknown>) => (await refusal('POST', '/api/tasks', { body: { listId: list.id, title: 'x', ...fields } }));
  expect(await bad({ title: '' })).toMatchObject({ status: 400 });
  expect(await bad({ title: 'two\nlines' })).toMatchObject({ status: 400 });
  expect(await bad({ due: '2026-13-01' })).toMatchObject({ status: 400 });
  expect(await bad({ priority: 7 })).toMatchObject({ status: 400 });
  expect(await bad({ recurrence: { rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', from: 'due' }, due: day(0) })).toMatchObject({ status: 400 });
  expect(await bad({ reminders: Array.from({ length: 21 }, (_, i) => ({ at: `${day(i)}T09:00` })) })).toMatchObject({ status: 400 });
});

test('a task that links a note is a backlink of it, and tasks are searchable', async () => {
  const note = unique('Task target');
  await createFile(`${note}.md`, '# Target\n');
  const list = await newList(unique('Links'));
  await newTask({ title: `Call about [[${note}]]`, listId: list.id, tags: ['home'] });
  const bl = await backlinks(`${note}.md`);
  expect(bl.linked.map((g: any) => g.source)).toEqual([list.path]);
  expect(bl.linked[0].mentions[0].context).toContain(`Call about [[${note}]]`);
  const found = await call('GET', `/api/tasks?view=search&q=${encodeURIComponent('call about')}&tag=home`);
  expect(found.tasks.some((x: any) => x.listId === list.id)).toBe(true);
});

test('lists: rename moves the file, delete sends it to the trash', async () => {
  const name = unique('Groceries');
  const list = await newList(name, { color: 'green', icon: 'shopping-cart' });
  expect(list).toMatchObject({ name, color: 'green', icon: 'shopping-cart', path: `Tasks/${name}.tasks` });
  const renamed = await call('PATCH', `/api/tasks/lists/${list.id}`, { body: { changes: { name: `${name} 2` } } });
  expect(renamed.moved).toMatchObject({ from: `Tasks/${name}.tasks`, to: `Tasks/${name} 2.tasks` });
  const del = await call('DELETE', `/api/tasks/lists/${list.id}`);
  expect(del.trash).toMatchObject({ originalPath: `Tasks/${name} 2.tasks`, type: 'file' });
});
