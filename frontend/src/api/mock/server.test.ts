// The feature endpoints of the in-memory mock (mock/server.ts): what the GitHub Pages demo and the
// dev mock answer for tasks, the calendar, flashcards, habits, properties and note queries.
import { afterEach, describe, expect, it } from 'vitest';
import { localToday } from '../../tasks/dates';
import type { DatedNotesResponse, FlashcardsResponse, HabitsResponse, NotesQueryResponse, Problem, PropertiesResponse, Task, TaskListsResponse, TaskListWriteResult, TasksResponse, TaskWriteResult } from '../types';
import type { SeedFile } from './seed';
import { createMockServer, installMockServer, type MockRequest } from './server';
import { MockVault } from './vault';

const today = localToday();
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localToday(d);
};

function taskFile(id: string, name: string, tasks: object[], sections: object[] = []): string {
  return JSON.stringify({ type: 'notesapp-tasks', version: 1, list: { id, name, order: 'a0', archived: false, sections }, tasks }, null, 2) + '\n';
}

function setup(files: SeedFile[]) {
  const vault = new MockVault(files);
  const handle = createMockServer(vault);
  const call = <T>(method: string, path: string, body: unknown = null, params = '') =>
    handle({ method, path, params: new URLSearchParams(params), body, origin: 'c-test' } satisfies MockRequest) as { status: number; body: T };
  return { vault, call };
}

const HOME = taskFile(
  'L-home',
  'Home',
  [
    { id: 'T1', title: 'Pay rent #bills', status: 'open', priority: 3, due: day(-1), recurrence: { rrule: 'FREQ=MONTHLY', from: 'due' }, tags: [], links: [], order: 'a0', sectionId: 'S1' },
    { id: 'T2', title: 'Water the plants', status: 'open', due: today, tags: [], links: [], order: 'a1', sectionId: 'S1' },
    { id: 'T3', title: 'Buy an adapter', status: 'open', due: day(5), tags: ['travel'], links: [], order: 'a0', sectionId: 'S2' },
    { id: 'T4', title: 'Subtask', status: 'open', parentId: 'T2', tags: [], links: [], order: 'a0' },
    { id: 'T5', title: 'Fixed the door', status: 'done', completedAt: '2026-10-01T10:00:00.000Z', tags: [], links: [], order: 'a2' },
  ],
  [
    { id: 'S1', name: 'House', order: 'a0' },
    { id: 'S2', name: 'Errands', order: 'a1' },
  ],
);

describe('mock task API (API.md §20)', () => {
  it('lists the lists and computes the views from the .tasks files', () => {
    const { call } = setup([{ path: 'Tasks/Home.tasks', content: HOME, age: 1 }]);
    expect(call<TaskListsResponse>('GET', '/tasks/lists').body.lists.map((l) => [l.name, l.path, l.sections.length])).toEqual([['Home', 'Tasks/Home.tasks', 2]]);
    const todayView = call<TasksResponse>('GET', '/tasks', null, `view=today&date=${today}`).body;
    expect(todayView.tasks.map((t) => t.id)).toEqual(['T1', 'T2']);
    expect(todayView.tasks[0].listId).toBe('L-home');
    expect(call<TasksResponse>('GET', '/tasks', null, `view=upcoming&date=${today}`).body.tasks.map((t) => t.id)).toEqual(['T2', 'T3']);
    expect(call<TasksResponse>('GET', '/tasks', null, 'view=list&list=L-home&status=all').body.tasks).toHaveLength(5);
    expect(call<TasksResponse>('GET', '/tasks', null, 'view=completed').body.tasks.map((t) => t.id)).toEqual(['T5']);
    expect(call<TasksResponse>('GET', '/tasks', null, 'view=list&tag=bills').body.tasks.map((t) => t.id)).toEqual(['T1']);
    expect(call<TasksResponse>('GET', '/tasks', null, 'view=search&q=adapt').body.tasks.map((t) => t.id)).toEqual(['T3']);
    expect(call<Problem>('GET', '/tasks', null, 'view=list&list=nope').status).toBe(404);
  });

  it('creates a task in the Inbox, made on first use, and writes the file', () => {
    const { call, vault } = setup([{ path: 'Tasks/Home.tasks', content: HOME, age: 1 }]);
    const res = call<TaskWriteResult>('POST', '/tasks', { title: 'Call Alex', due: today });
    expect(res.status).toBe(201);
    expect(res.body.lists.map((l) => l.path)).toEqual(['Tasks/Inbox.tasks']);
    expect(res.body.files.map((f) => f.path)).toEqual(['Tasks/Inbox.tasks']);
    const file = JSON.parse(vault.textAt('Tasks/Inbox.tasks')!.content);
    expect(file.tasks.map((t: { title: string }) => t.title)).toEqual(['Call Alex']);
    expect(file.tasks[0].listId).toBeUndefined();
    expect(call<TaskListsResponse>('GET', '/tasks/lists').body.lists.map((l) => l.name)).toEqual(['Inbox', 'Home']);
  });

  it('rolls a recurring task forward and closes a plain one with its subtasks', () => {
    const { call } = setup([{ path: 'Tasks/Home.tasks', content: HOME, age: 1 }]);
    const rolled = call<TaskWriteResult>('POST', '/tasks/T1/complete', { date: today }).body;
    expect(rolled.rolledForward).toBe(true);
    expect(rolled.task!.status).toBe('open');
    expect(rolled.task!.due! > today).toBe(true);
    const done = call<TaskWriteResult>('POST', '/tasks/T2/complete', { date: today }).body;
    expect(done.task!.status).toBe('done');
    expect(done.changed.map((t) => [t.id, t.status])).toEqual([['T4', 'done']]);
    expect(call<TaskWriteResult>('POST', '/tasks/T2/uncomplete').body.task!.status).toBe('open');
  });

  it('moves a task to another section (a Kanban drop) and edits fields', () => {
    const { call } = setup([{ path: 'Tasks/Home.tasks', content: HOME, age: 1 }]);
    const moved = call<TaskWriteResult>('POST', '/tasks/reorder', { listId: 'L-home', sectionId: 'S2', parentId: null, ids: ['T2'], after: 'T3' }).body;
    expect(moved.changed.map((t) => [t.id, t.sectionId])).toEqual([['T2', 'S2']]);
    expect(moved.changed[0].order > 'a0').toBe(true);
    const errands = call<TasksResponse>('GET', '/tasks', null, 'view=list&list=L-home').body.tasks.filter((t) => t.sectionId === 'S2' && t.parentId === null);
    expect(errands.map((t) => t.id)).toEqual(['T3', 'T2']);
    const patched = call<TaskWriteResult>('PATCH', '/tasks/T3', { changes: { title: 'Buy two adapters', priority: 2, due: null } }).body.task as Task;
    expect([patched.title, patched.priority, patched.due]).toEqual(['Buy two adapters', 2, null]);
    expect(call<TaskWriteResult>('DELETE', '/tasks/T2').body.deleted.sort()).toEqual(['T2', 'T4']);
    expect(call<Problem>('GET', '/tasks/T2').status).toBe(404);
  });

  it('creates, renames and reorders lists and sections', () => {
    const { call, vault } = setup([{ path: 'Tasks/Home.tasks', content: HOME, age: 1 }]);
    const created = call<TaskListWriteResult>('POST', '/tasks/lists', { name: 'Q4: Plans' });
    expect(created.status).toBe(201);
    expect(created.body.lists[0].path).toBe('Tasks/Q4- Plans.tasks');
    const id = created.body.lists[0].id;
    call('POST', `/tasks/lists/${id}/sections`, { name: 'Later' });
    call('PATCH', `/tasks/lists/${id}`, { changes: { name: 'Plans', color: '#2f9e44' } });
    const list = call<TaskListsResponse>('GET', '/tasks/lists').body.lists.find((l) => l.id === id)!;
    expect([list.name, list.color, list.sections.map((s) => s.name)]).toEqual(['Plans', '#2f9e44', ['Later']]);
    call('POST', '/tasks/lists/reorder', { ids: [id], after: null });
    expect(call<TaskListsResponse>('GET', '/tasks/lists').body.lists[0].id).toBe(id);
    const removed = call<TaskListWriteResult>('DELETE', `/tasks/lists/${id}`).body;
    expect(removed.trash?.originalPath).toBe('Tasks/Q4- Plans.tasks');
    expect(vault.textAt('Tasks/Q4- Plans.tasks')).toBeNull();
  });
});

describe('mock calendar, flashcards, habits, properties and queries', () => {
  const NOTES: SeedFile[] = [
    { path: 'Meetings/Kickoff.md', content: `---\ndate: ${today}T09:30\ntags: [meeting]\n---\nKickoff [[Plan]]\n`, age: 1 },
    { path: 'Plan.md', content: '---\nstatus: draft\nrating: 4\n---\n# Plan\n- [ ] one\n- [x] two\n', age: 1 },
    { path: 'Spanish.md', content: '---\ntags: [flashcards/spanish]\n---\nhola::hello\n', age: 1 },
    { path: 'Templates/Meeting.md', content: `---\ndate: ${today}\n---\n`, age: 1 },
    { path: 'Habits/Read.md', content: `---\ntitle: Read\nentries:\n  - ${today}\n---\n`, age: 1 },
    { path: 'Daily/2026-10-01.md', content: '---\nread: true\nnote: a long ok text\n---\n', age: 1 },
  ];

  it('dates notes by their frontmatter, leaving templates out', () => {
    const { call } = setup(NOTES);
    const res = call<DatedNotesResponse>('GET', '/notes/by-date', null, `from=${day(-3)}&to=${day(3)}`).body;
    expect(res.notes).toEqual([{ path: 'Meetings/Kickoff.md', day: today, property: 'date', value: `${today}T09:30` }]);
    expect(call<Problem>('GET', '/notes/by-date', null, 'from=x&to=y').status).toBe(400);
  });

  it('serves flashcard notes and keeps review records', () => {
    const { call } = setup(NOTES);
    expect(call<{ notes: Array<{ path: string }> }>('GET', '/flashcards/notes').body.notes.map((n) => n.path)).toEqual(['Spanish.md']);
    const at = new Date().toISOString();
    const written = call<{ cards: Record<string, unknown>; version: string }>('POST', '/flashcards/reviews', { reviews: [{ card: 'c1', at, rating: 'good', note: 'Spanish.md', front: 'hola' }] }).body;
    expect(Object.keys(written.cards)).toEqual(['c1']);
    call('POST', '/flashcards/reviews', { reviews: [{ card: 'c1', at, rating: 'good' }] });
    const state = call<FlashcardsResponse>('GET', '/flashcards').body;
    expect(state.cards.c1.reviews).toEqual([`${at} good`]);
    call('POST', '/flashcards/undo', { card: 'c1', at });
    expect(call<FlashcardsResponse>('GET', '/flashcards').body.cards.c1).toBeUndefined();
    expect(call<{ newPerDay: number }>('PUT', '/flashcards/config', { config: { newPerDay: 5 } }).body.newPerDay).toBe(5);
    expect(call<{ newPerDay: number }>('PUT', '/flashcards/config', { config: { newPerDay: null } }).body.newPerDay).toBe(20);
  });

  it('lists habits and the simple values of daily notes', () => {
    const { call } = setup(NOTES);
    const res = call<HabitsResponse>('GET', '/habits').body;
    expect(res.folder).toBe('Habits');
    expect(res.habits.map((h) => [h.path, h.properties.title])).toEqual([['Habits/Read.md', 'Read']]);
    expect(res.daily).toEqual([{ path: 'Daily/2026-10-01.md', values: { read: true, note: 'a long ok text' } }]);
  });

  it('lists properties with inferred types, their values and set types', () => {
    const { call } = setup(NOTES);
    const props = call<PropertiesResponse>('GET', '/properties').body.properties;
    expect(props.find((p) => p.name === 'rating')).toEqual({ name: 'rating', count: 1, type: null, inferred: 'number' });
    expect(props.find((p) => p.name === 'tags')?.type).toBe('tags');
    expect(call<{ values: unknown[] }>('GET', '/properties/values', null, 'name=status').body.values).toEqual([{ value: 'draft', count: 1 }]);
    expect(call<{ types: Record<string, string> }>('PUT', '/properties/types', { name: 'status', type: 'text' }).body.types).toEqual({ status: 'text' });
  });

  it('answers note queries with frontmatter, links and tasks', () => {
    const { call } = setup(NOTES);
    const res = call<NotesQueryResponse>('GET', '/notes/query', null, 'tag=meeting').body;
    expect(res.notes.map((n) => [n.path, n.links])).toEqual([['Meetings/Kickoff.md', ['Plan.md']]]);
    const plan = call<NotesQueryResponse>('GET', '/notes/query', null, 'prop=status%3Ddraft&tasks=true').body.notes;
    expect(plan.map((n) => n.path)).toEqual(['Plan.md']);
    expect(plan[0].tasks?.map((t) => [t.text, t.done])).toEqual([
      ['one', false],
      ['two', true],
    ]);
    expect(call<NotesQueryResponse>('GET', '/notes/query', null, 'linksTo=Plan.md').body.notes.map((n) => n.path)).toEqual(['Meetings/Kickoff.md']);
  });

  it('answers 404 for endpoints that need the real server', () => {
    const { call } = setup([]);
    const res = call<Problem>('POST', '/ai/ask', {});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not-found');
    expect(call<{ state: string }>('GET', '/ai/status').body.state).toBe('off');
  });
});

describe('installMockServer', () => {
  const original = window.fetch;
  afterEach(() => {
    window.fetch = original;
  });

  it('answers same-origin /api/ requests in the page and passes everything else on', async () => {
    const seen: string[] = [];
    window.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response('network');
    }) as typeof fetch;
    installMockServer(new MockVault([{ path: 'Tasks/Home.tasks', content: HOME, age: 1 }]));
    const res = await fetch('/api/tasks/lists', { headers: { 'X-Client-Id': 'c-1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(((await res.json()) as TaskListsResponse).lists[0].name).toBe('Home');
    const missing = await fetch('/api/nothing-here');
    expect([missing.status, missing.headers.get('Content-Type')]).toEqual([404, 'application/problem+json']);
    expect(await (await fetch('/clipper/clipper.js')).text()).toBe('network');
    expect(seen).toEqual(['/clipper/clipper.js']);
  });
});
