import { expect, test } from '@playwright/test';
import { CLIENT_ID, call, createFile, move, newList, newTask, saveFile, trashFile, tree, unique } from '../../lib/api.ts';
import { EventStream } from '../../lib/events.ts';

/**
 * Live sync (API.md §16): what another device hears when this one changes something, in order,
 * and what the changing device does not hear about its own writes.
 */

test('another device hears a create, a save, a move and a delete, in that order', async () => {
  const other = await EventStream.open();
  try {
    const dir = unique('Live');
    const made = await createFile(`${dir}/Note.md`, 'one\n');
    const saved = await saveFile(`${dir}/Note.md`, 'two\n', made.file.version);
    await move(`${dir}/Note.md`, `${dir}/Moved.md`);
    const trashed = await trashFile(`${dir}/Moved.md`);

    const mine = (e: { data: any }) => JSON.stringify(e.data).includes(dir);
    await other.next((e) => e.event === 'file.deleted' && mine(e));
    const seq = other.events.filter(mine).map((e) => e.event).filter((e) => e !== 'history.committed');
    expect(seq).toEqual(['folder.created', 'file.created', 'file.changed', 'entry.moved', 'file.deleted']);

    const changed = other.events.find((e) => e.event === 'file.changed' && mine(e))!;
    expect(changed.data).toMatchObject({ origin: CLIENT_ID, file: { path: `${dir}/Note.md`, version: saved.file.version } });
    const deleted = other.events.find((e) => e.event === 'file.deleted' && mine(e))!;
    expect(deleted.data).toMatchObject({ path: `${dir}/Moved.md`, trashed: true, trashId: trashed.id });
    // Ids increase within one boot.
    const seqs = other.events.filter((e) => e.id).map((e) => Number(e.id!.split('.')[1]));
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  } finally {
    other.close();
  }
});

test('the server watches the vault as production does, except on Windows', async () => {
  // scripts/reset.mjs: the dev profile turns the watcher off for Windows (JDK-6972833, DESIGN §5.9);
  // elsewhere the suite runs with it, so the watcher meets every save, move and trash below.
  const status = await call('GET', '/api/status');
  expect(status.watcher.mode).toBe(process.platform === 'win32' ? 'disabled' : 'inotify');
});

test('the device that made a change is not told about it again', async () => {
  const self = await EventStream.open({ clientId: CLIENT_ID });
  const other = await EventStream.open();
  try {
    const path = `${unique('Echo')}.md`;
    await createFile(path, 'x\n');
    await other.next((e) => e.event === 'file.created' && e.data.file?.path === path);
    // trash.changed and history.committed go to everyone; content events do not echo. Wait past the
    // vault watcher's debounce (400 ms) and tick, so a watcher that re-announced the app's own write
    // (as an external change, origin null) would show here.
    await new Promise((r) => setTimeout(r, 1500));
    expect(self.events.some((e) => e.event === 'file.created' && e.data.file?.path === path)).toBe(false);
    expect(other.events.filter((e) => JSON.stringify(e.data).includes(path) && e.data.origin === null)).toEqual([]);
  } finally {
    self.close();
    other.close();
  }
});

test('task changes reach other devices as task events', async () => {
  const other = await EventStream.open();
  try {
    const list = await newList(unique('Live tasks'));
    const task = await newTask({ title: 'Heard elsewhere', listId: list.id });
    await call('POST', `/api/tasks/${task.id}/complete`, { body: { date: '2026-01-01' } });
    const created = await other.next((e) => e.event === 'task.created' && e.data.task.id === task.id);
    expect(created.data.origin).toBe(CLIENT_ID);
    const done = await other.next((e) => e.event === 'task.changed' && e.data.task.id === task.id);
    expect(done.data.task.status).toBe('done');
    await other.next((e) => e.event === 'list.changed' && e.data.listId === list.id);
  } finally {
    other.close();
  }
});

test('a device that reconnects gets what it missed, from the id it last saw', async () => {
  const { eventId } = await tree();
  const path = `${unique('Missed')}.md`;
  await createFile(path, 'while away\n');
  const back = await EventStream.open({ lastEventId: eventId });
  try {
    const hello = back.events[0];
    expect(hello.event).toBe('hello');
    expect(hello.data).toMatchObject({ resync: false });
    expect(hello.data.replayed).toBeGreaterThanOrEqual(1);
    await back.next((e) => e.event === 'file.created' && e.data.file.path === path);
  } finally {
    back.close();
  }
  // An id from another boot (or none) asks for a full resync instead.
  const fresh = await EventStream.open({ lastEventId: 'zzzzzz.1' });
  try {
    expect(fresh.events[0].data).toMatchObject({ resync: true, replayed: 0 });
  } finally {
    fresh.close();
  }
});
