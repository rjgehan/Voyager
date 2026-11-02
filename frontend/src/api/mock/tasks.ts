// The task API (API.md §20) for the in-memory mock (dev with VITE_MOCK_API=1 and the GitHub Pages
// demo, DESIGN §6.45). Lists and tasks are read from the vault's `.tasks` files on every request,
// views are computed with the client's own rules (tasks/model.ts, which mirror the server's), and
// changes are written back to the files in their canonical layout (DESIGN §5.20), so the files, the
// tree, search and history all see them. Simpler than the server where a single tab needs nothing
// more: `base` is not checked (no per-field conflicts) and there is no archive rollover.
import { localToday } from '../../tasks/dates';
import { compareKeys, keyBetween } from '../../tasks/fractionalIndex';
import { childrenByParent, compareCompleted, compareOrder, descendants, inListView, inToday, inUpcoming, matchesFilter, scheduleComparator, sortLists, statusesOf, taskTags } from '../../tasks/model';
import { rollForward } from '../../tasks/recurrence';
import type {
  CompleteTaskRequest,
  CreateTaskListRequest,
  CreateTaskRequest,
  FileEntry,
  ReorderRequest,
  ReorderTasksRequest,
  SectionRequest,
  Task,
  TaskFields,
  TaskFileProblem,
  TaskList,
  TaskListsResponse,
  TaskListWriteResult,
  TasksResponse,
  TaskView,
  TaskWriteResult,
  UpdateTaskListRequest,
  UpdateTaskRequest,
} from '../types';
import { fail } from './problems';
import type { MockVault } from './vault';

type Json = Record<string, unknown>;

interface ListFile {
  path: string;
  /** The parsed file, changed in place by operations and written back whole. */
  json: Json & { list: Json; tasks: Json[] };
  archive: boolean;
  list: TaskList;
  tasks: Task[];
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
let counter = 0;

/** A ULID-like id: time first, so ids sort by creation as the server's do. */
export function newTaskId(now = Date.now()): string {
  counter = now === lastTime ? counter + 1 : 0;
  lastTime = now;
  let time = '';
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let rest = counter.toString(32).toUpperCase().padStart(4, '0');
  while (rest.length < 16) rest += CROCKFORD[Math.floor(Math.random() * 32)];
  return time + rest.slice(0, 16);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function readList(path: string, json: Json): TaskList {
  const l = json.list as Json;
  return {
    id: String(l.id),
    name: String(l.name),
    color: str(l.color),
    icon: str(l.icon),
    order: str(l.order) ?? 'a0',
    archived: l.archived === true,
    sections: arr<Json>(l.sections)
      .map((s) => ({ id: String(s.id), name: String(s.name), order: str(s.order) ?? 'a0' }))
      .sort((a, b) => compareKeys(a.order, b.order) || compareKeys(a.id, b.id)),
    path,
    writable: true,
  };
}

function readTask(raw: Json, listId: string, archived: boolean): Task {
  const priority = raw.priority;
  return {
    id: String(raw.id),
    listId,
    sectionId: str(raw.sectionId),
    parentId: str(raw.parentId),
    title: String(raw.title ?? ''),
    notes: str(raw.notes),
    status: raw.status === 'done' || raw.status === 'cancelled' ? raw.status : 'open',
    priority: priority === 1 || priority === 2 || priority === 3 ? priority : 0,
    due: str(raw.due),
    start: str(raw.start),
    recurrence: raw.recurrence && typeof raw.recurrence === 'object' ? (raw.recurrence as Task['recurrence']) : null,
    reminders: arr(raw.reminders),
    tags: arr(raw.tags),
    links: arr(raw.links),
    order: str(raw.order) ?? 'a0',
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
    completedAt: str(raw.completedAt),
    archived,
  };
}

const TASK_KEYS = ['id', 'title', 'notes', 'status', 'priority', 'due', 'start', 'recurrence', 'reminders', 'tags', 'links', 'sectionId', 'parentId', 'order', 'createdAt', 'updatedAt', 'completedAt'] as const;

/** A task in the file's canonical layout: known keys in order, empty optional ones left out, unknown ones kept. */
function writeTask(task: Task, raw: Json): Json {
  const out: Json = {};
  for (const key of TASK_KEYS) {
    const value = task[key];
    if (key === 'tags' || key === 'links') out[key] = value;
    else if (key === 'reminders') {
      if (task.reminders.length > 0) out[key] = value;
    } else if (key === 'priority') {
      if (task.priority !== 0) out[key] = value;
    } else if (value !== null && value !== undefined) out[key] = value;
  }
  for (const [k, v] of Object.entries(raw)) if (!(k in out) && !(TASK_KEYS as readonly string[]).includes(k) && k !== 'listId' && k !== 'archived') out[k] = v;
  return out;
}

function writeList(list: TaskList, raw: Json): Json {
  const out: Json = { id: list.id, name: list.name };
  if (list.color) out.color = list.color;
  if (list.icon) out.icon = list.icon;
  out.order = list.order;
  out.archived = list.archived;
  out.sections = list.sections.map((s) => ({ id: s.id, name: s.name, order: s.order }));
  for (const [k, v] of Object.entries(raw)) if (!(k in out) && !['color', 'icon'].includes(k)) out[k] = v;
  return out;
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]%]/g, '-').replace(/\s+/g, ' ').trim() || 'List';
}

const nowIso = () => new Date().toISOString();

export class MockTasks {
  private readonly vault: MockVault;

  constructor(vault: MockVault) {
    this.vault = vault;
  }

  // ---------- reading ----------

  private files(): { files: ListFile[]; problems: TaskFileProblem[] } {
    const files: ListFile[] = [];
    const problems: TaskFileProblem[] = [];
    const seenLists = new Set<string>();
    const seenTasks = new Set<string>();
    for (const path of this.vault.paths()) {
      if (!path.endsWith('.tasks')) continue;
      const text = this.vault.textAt(path);
      if (!text) continue;
      let json: ListFile['json'];
      try {
        json = JSON.parse(text.content) as ListFile['json'];
        if (json.type !== 'notesapp-tasks' || !json.list || typeof json.list.id !== 'string' || typeof json.list.name !== 'string') throw new Error('not a task file');
        json.tasks = arr<Json>(json.tasks);
      } catch {
        problems.push({ path, taskId: null, reason: 'Not a task list file' });
        continue;
      }
      const archive = json.archive === true;
      const list = readList(path, json);
      if (!archive) {
        if (seenLists.has(list.id)) {
          problems.push({ path, taskId: null, reason: 'Repeats the list id of another file' });
          continue;
        }
        seenLists.add(list.id);
      }
      const tasks: Task[] = [];
      for (const raw of json.tasks) {
        if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || seenTasks.has(raw.id)) {
          problems.push({ path, taskId: typeof raw.id === 'string' ? raw.id : null, reason: 'Invalid or repeated task' });
          continue;
        }
        seenTasks.add(raw.id);
        tasks.push(readTask(raw, list.id, archive));
      }
      files.push({ path, json, archive, list, tasks });
    }
    return { files, problems };
  }

  private catalog() {
    const { files, problems } = this.files();
    const lists = sortLists(files.filter((f) => !f.archive).map((f) => f.list));
    const listMap = new Map(lists.map((l) => [l.id, l]));
    const tasks = files.flatMap((f) => f.tasks);
    return { files, problems, lists, listMap, tasks };
  }

  lists(): TaskListsResponse {
    const { lists, problems } = this.catalog();
    return { lists, problems };
  }

  query(params: URLSearchParams): TasksResponse {
    const view = (params.get('view') ?? 'list') as TaskView;
    if (!['today', 'upcoming', 'list', 'completed', 'search'].includes(view)) fail('bad-request', 'Unknown view');
    const { lists, listMap, tasks, problems } = this.catalog();
    const listId = params.get('list') ?? undefined;
    if (listId !== undefined && !listMap.has(listId)) fail('not-found', 'No such list');
    const today = params.get('date') ?? localToday();
    const statuses = statusesOf(params.get('status') ?? undefined, view);
    const filter = { list: listId, tag: params.get('tag') ?? undefined, priority: params.get('priority') ?? undefined };
    const words = (params.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    let out = tasks.filter((t) => statuses.has(t.status) && matchesFilter(t, filter));
    if (view === 'today') out = out.filter((t) => inToday(t, today, listMap)).sort(scheduleComparator(lists));
    else if (view === 'upcoming') out = out.filter((t) => inUpcoming(t, today, Number(params.get('days') ?? 14), listMap)).sort(scheduleComparator(lists));
    else if (view === 'list') {
      const rank = new Map(lists.map((l, i) => [l.id, i]));
      out = out.filter((t) => inListView(t, listMap, listId)).sort((a, b) => (rank.get(a.listId) ?? 0) - (rank.get(b.listId) ?? 0) || compareOrder(a, b));
    } else if (view === 'completed') {
      const before = params.get('before');
      out = out.filter((t) => !before || (t.completedAt !== null && t.completedAt < before)).sort(compareCompleted);
    } else {
      const text = (t: Task) => [t.title, t.notes ?? '', ...taskTags(t)].join(' ').toLowerCase();
      out = out
        .filter((t) => words.every((w) => text(t).split(/[^\p{L}\p{N}_/-]+/u).some((x) => x.startsWith(w))))
        .sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open') || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    }
    const total = out.length;
    if (view === 'completed' || view === 'search') out = out.slice(0, Number(params.get('limit') ?? 200));
    return { view, lists, tasks: out, total, problems };
  }

  get(id: string): Task {
    return this.find(id).task;
  }

  // ---------- writing ----------

  private find(id: string): { file: ListFile; task: Task; all: ReturnType<MockTasks['catalog']> } {
    const all = this.catalog();
    for (const file of all.files) {
      const task = file.tasks.find((t) => t.id === id);
      if (task) return { file, task, all };
    }
    return fail('not-found', 'No such task');
  }

  private listFile(all: ReturnType<MockTasks['catalog']>, listId: string): ListFile {
    return all.files.find((f) => !f.archive && f.list.id === listId) ?? fail('not-found', 'No such list');
  }

  /** Writes a list file from its (changed) tasks and list, in the canonical layout. */
  private save(file: ListFile, origin: string | null): { file: FileEntry; createdFolders: string[] } {
    const raws = new Map(file.json.tasks.map((r) => [String(r.id), r]));
    const tasks = [...file.tasks].sort((a, b) => compareKeys(a.id, b.id)).map((t) => writeTask(t, raws.get(t.id) ?? {}));
    const json: Json = { type: 'notesapp-tasks', version: 1 };
    if (file.archive) json.archive = true;
    json.list = writeList(file.list, file.json.list);
    json.tasks = tasks;
    for (const [k, v] of Object.entries(file.json)) if (!(k in json)) json[k] = v;
    const result = this.vault.serverWrite(file.path, JSON.stringify(json, null, 2) + '\n', origin);
    return { file: result.file, createdFolders: result.createdFolders };
  }

  private result(task: Task | null, written: Array<{ file: FileEntry; createdFolders: string[] }>, extra: Partial<TaskWriteResult> = {}): TaskWriteResult {
    return {
      task,
      changed: [],
      deleted: [],
      rolledForward: false,
      files: written.map((w) => w.file),
      createdFolders: written.flatMap((w) => w.createdFolders),
      lists: [],
      ...extra,
    };
  }

  private lastKey(tasks: readonly Task[]): string | null {
    return tasks.reduce<string | null>((max, t) => (max === null || compareKeys(t.order, max) > 0 ? t.order : max), null);
  }

  private siblings(file: ListFile, parentId: string | null, sectionId: string | null, except?: string): Task[] {
    return file.tasks.filter((t) => t.id !== except && t.parentId === parentId && (parentId !== null || t.sectionId === sectionId)).sort(compareOrder);
  }

  private inbox(all: ReturnType<MockTasks['catalog']>, origin: string | null): { file: ListFile; created: TaskList | null } {
    const existing = all.files.find((f) => !f.archive && f.path === 'Tasks/Inbox.tasks');
    if (existing) return { file: existing, created: null };
    const first = all.lists[0]?.order ?? null;
    const list: TaskList = { id: newTaskId(), name: 'Inbox', color: null, icon: 'inbox', order: keyBetween(null, first), archived: false, sections: [], path: 'Tasks/Inbox.tasks', writable: true };
    const file: ListFile = { path: list.path, json: { list: {}, tasks: [] }, archive: false, list, tasks: [] };
    this.save(file, origin);
    return { file, created: list };
  }

  create(req: CreateTaskRequest, origin: string | null): TaskWriteResult {
    if (!req.title?.trim()) fail('bad-request', 'A title is required', { errors: [{ field: 'task.title', message: 'required' }] });
    const all = this.catalog();
    let file: ListFile;
    let createdList: TaskList | null = null;
    const parent = req.parentId ? all.tasks.find((t) => t.id === req.parentId) : null;
    if (req.parentId && !parent) fail('not-found', 'No such parent task');
    if (req.listId) file = this.listFile(all, req.listId);
    else if (parent) file = this.listFile(all, parent.listId);
    else ({ file, created: createdList } = this.inbox(all, origin));
    const parentId = parent?.id ?? null;
    const sectionId = parentId ? null : (req.sectionId ?? null);
    const siblings = this.siblings(file, parentId, sectionId);
    let order: string;
    if (req.after === undefined) order = keyBetween(this.lastKey(siblings), null);
    else if (req.after === null) order = keyBetween(null, siblings[0]?.order ?? null);
    else {
      const i = siblings.findIndex((t) => t.id === req.after);
      order = i < 0 ? keyBetween(this.lastKey(siblings), null) : keyBetween(siblings[i].order, siblings[i + 1]?.order ?? null);
    }
    const now = nowIso();
    const task: Task = {
      id: newTaskId(),
      listId: file.list.id,
      sectionId,
      parentId,
      title: req.title.trim(),
      notes: req.notes ?? null,
      status: req.status ?? 'open',
      priority: req.priority ?? 0,
      due: req.due ?? null,
      start: req.start ?? null,
      recurrence: req.recurrence ?? null,
      reminders: req.reminders ?? [],
      tags: (req.tags ?? []).map((t) => t.replace(/^#/, '')),
      links: req.links ?? [],
      order,
      createdAt: now,
      updatedAt: now,
      completedAt: req.status && req.status !== 'open' ? now : null,
      archived: false,
    };
    file.tasks.push(task);
    return this.result(task, [this.save(file, origin)], { lists: createdList ? [createdList] : [] });
  }

  update(id: string, req: UpdateTaskRequest, origin: string | null): TaskWriteResult {
    const { file, task, all } = this.find(id);
    const c: TaskFields = req.changes ?? {};
    const written: Array<{ file: FileEntry; createdFolders: string[] }> = [];
    const changed: Task[] = [];
    const now = nowIso();
    const apply = (t: Task, fields: Partial<Task>) => Object.assign(t, fields, { updatedAt: now });
    const simple: Partial<Task> = {};
    for (const key of ['title', 'notes', 'priority', 'due', 'start', 'recurrence', 'reminders', 'tags', 'links'] as const) {
      if (key in c) (simple as Record<string, unknown>)[key] = c[key] ?? (key === 'reminders' || key === 'tags' || key === 'links' ? [] : key === 'priority' ? 0 : null);
    }
    if (c.status !== undefined) {
      simple.status = c.status;
      simple.completedAt = c.status === 'open' ? null : (task.completedAt ?? now);
    }
    apply(task, simple);
    if (c.listId !== undefined && c.listId !== task.listId) {
      // A move to another list takes the subtasks along, to the end of the new list's top level.
      const target = this.listFile(all, c.listId);
      const moved = [task, ...descendants(task.id, childrenByParent(file.tasks))];
      file.tasks = file.tasks.filter((t) => !moved.includes(t));
      const sectionId = c.sectionId && target.list.sections.some((s) => s.id === c.sectionId) ? c.sectionId : null;
      task.parentId = c.parentId ?? null;
      task.sectionId = task.parentId ? null : sectionId;
      task.order = keyBetween(this.lastKey(this.siblings(target, task.parentId, task.sectionId)), null);
      for (const t of moved) {
        t.listId = target.list.id;
        if (t !== task) {
          t.sectionId = null;
          changed.push(t);
        }
      }
      target.tasks.push(...moved);
      written.push(this.save(target, origin));
    } else {
      if (c.parentId !== undefined && c.parentId !== task.parentId) {
        task.parentId = c.parentId;
        task.sectionId = null;
        task.order = keyBetween(this.lastKey(this.siblings(file, task.parentId, null, task.id)), null);
      }
      if (c.sectionId !== undefined && task.parentId === null && c.sectionId !== task.sectionId) {
        task.sectionId = c.sectionId;
        task.order = keyBetween(this.lastKey(this.siblings(file, null, task.sectionId, task.id)), null);
      }
    }
    written.unshift(this.save(file, origin));
    return this.result(task, written, { changed });
  }

  complete(id: string, req: CompleteTaskRequest | undefined, origin: string | null): TaskWriteResult {
    const { file, task } = this.find(id);
    if (task.status !== 'open') return this.result(task, []);
    const day = req?.date ?? localToday();
    const now = nowIso();
    const next = task.recurrence ? rollForward(task, day) : null;
    const changed: Task[] = [];
    if (next) {
      Object.assign(task, next, { updatedAt: now });
      for (const sub of descendants(task.id, childrenByParent(file.tasks))) {
        if (sub.status !== 'open') {
          Object.assign(sub, { status: 'open', completedAt: null, updatedAt: now });
          changed.push(sub);
        }
      }
      return this.result(task, [this.save(file, origin)], { changed, rolledForward: true });
    }
    Object.assign(task, { status: 'done', completedAt: now, updatedAt: now });
    for (const sub of descendants(task.id, childrenByParent(file.tasks))) {
      if (sub.status === 'open') {
        Object.assign(sub, { status: 'done', completedAt: now, updatedAt: now });
        changed.push(sub);
      }
    }
    return this.result(task, [this.save(file, origin)], { changed });
  }

  uncomplete(id: string, origin: string | null): TaskWriteResult {
    const { file, task } = this.find(id);
    if (task.status === 'open') return this.result(task, []);
    Object.assign(task, { status: 'open', completedAt: null, updatedAt: nowIso() });
    return this.result(task, [this.save(file, origin)]);
  }

  remove(id: string, origin: string | null): TaskWriteResult {
    const { file, task } = this.find(id);
    const gone = [task, ...descendants(task.id, childrenByParent(file.tasks))];
    file.tasks = file.tasks.filter((t) => !gone.includes(t));
    return this.result(null, [this.save(file, origin)], { deleted: gone.map((t) => t.id) });
  }

  reorder(req: ReorderTasksRequest, origin: string | null): TaskWriteResult {
    const all = this.catalog();
    const file = this.listFile(all, req.listId);
    const moving = req.ids.map((id) => file.tasks.find((t) => t.id === id) ?? fail('not-found', 'No such task'));
    const sectionId = req.parentId === null ? req.sectionId : null;
    const siblings = file.tasks.filter((t) => !req.ids.includes(t.id) && t.parentId === req.parentId && (req.parentId !== null || t.sectionId === sectionId)).sort(compareOrder);
    const at = req.after === null ? -1 : siblings.findIndex((t) => t.id === req.after);
    if (req.after !== null && at < 0) fail('bad-request', '`after` is not a sibling there');
    let lo = at >= 0 ? siblings[at].order : null;
    const hi = siblings[at + 1]?.order ?? null;
    const now = nowIso();
    for (const t of moving) {
      const order = keyBetween(lo, hi);
      Object.assign(t, { order, parentId: req.parentId, sectionId, updatedAt: now });
      lo = order;
    }
    return this.result(null, [this.save(file, origin)], { changed: moving });
  }

  // ---------- lists and sections ----------

  private listResult(lists: TaskList[], written: Array<{ file: FileEntry; createdFolders: string[] }>): TaskListWriteResult {
    return { lists, files: written.map((w) => w.file), createdFolders: written.flatMap((w) => w.createdFolders), moved: null, trash: null };
  }

  createList(req: CreateTaskListRequest, origin: string | null): TaskListWriteResult {
    const name = req.name?.trim();
    if (!name) fail('bad-request', 'A name is required', { errors: [{ field: 'name', message: 'required' }] });
    const all = this.catalog();
    const taken = new Set(this.vault.paths().map((p) => p.toLowerCase()));
    let path = `Tasks/${sanitizeName(name)}.tasks`;
    for (let i = 1; taken.has(path.toLowerCase()); i++) path = `Tasks/${sanitizeName(name)} ${i}.tasks`;
    const list: TaskList = { id: newTaskId(), name, color: req.color ?? null, icon: req.icon ?? null, order: keyBetween(all.lists.at(-1)?.order ?? null, null), archived: false, sections: [], path, writable: true };
    const file: ListFile = { path, json: { list: {}, tasks: [] }, archive: false, list, tasks: [] };
    return this.listResult([list], [this.save(file, origin)]);
  }

  updateList(id: string, req: UpdateTaskListRequest, origin: string | null): TaskListWriteResult {
    const file = this.listFile(this.catalog(), id);
    const c = req.changes ?? {};
    if (c.name !== undefined) file.list.name = c.name.trim() || file.list.name;
    if (c.color !== undefined) file.list.color = c.color;
    if (c.icon !== undefined) file.list.icon = c.icon;
    if (c.archived !== undefined) file.list.archived = c.archived;
    return this.listResult([file.list], [this.save(file, origin)]);
  }

  reorderLists(req: ReorderRequest, origin: string | null): TaskListWriteResult {
    const all = this.catalog();
    const others = all.lists.filter((l) => !req.ids.includes(l.id));
    const at = req.after === null ? -1 : others.findIndex((l) => l.id === req.after);
    let lo = at >= 0 ? others[at].order : null;
    const hi = others[at + 1]?.order ?? null;
    const written = [];
    const changed: TaskList[] = [];
    for (const id of req.ids) {
      const file = this.listFile(all, id);
      file.list.order = keyBetween(lo, hi);
      lo = file.list.order;
      written.push(this.save(file, origin));
      changed.push(file.list);
    }
    return this.listResult(changed, written);
  }

  addSection(listId: string, req: SectionRequest, origin: string | null): TaskListWriteResult {
    const file = this.listFile(this.catalog(), listId);
    const name = req.name?.trim();
    if (!name) fail('bad-request', 'A name is required', { errors: [{ field: 'name', message: 'required' }] });
    file.list.sections.push({ id: newTaskId(), name, order: keyBetween(file.list.sections.at(-1)?.order ?? null, null) });
    return this.listResult([file.list], [this.save(file, origin)]);
  }

  renameSection(listId: string, sectionId: string, req: SectionRequest, origin: string | null): TaskListWriteResult {
    const file = this.listFile(this.catalog(), listId);
    const section = file.list.sections.find((s) => s.id === sectionId) ?? fail('not-found', 'No such section');
    section.name = req.name?.trim() || section.name;
    return this.listResult([file.list], [this.save(file, origin)]);
  }

  deleteSection(listId: string, sectionId: string, origin: string | null): TaskListWriteResult {
    const file = this.listFile(this.catalog(), listId);
    if (!file.list.sections.some((s) => s.id === sectionId)) fail('not-found', 'No such section');
    file.list.sections = file.list.sections.filter((s) => s.id !== sectionId);
    for (const t of file.tasks) if (t.sectionId === sectionId) t.sectionId = null;
    return this.listResult([file.list], [this.save(file, origin)]);
  }

  reorderSections(listId: string, req: ReorderRequest, origin: string | null): TaskListWriteResult {
    const file = this.listFile(this.catalog(), listId);
    const others = file.list.sections.filter((s) => !req.ids.includes(s.id));
    const at = req.after === null ? -1 : others.findIndex((s) => s.id === req.after);
    let lo = at >= 0 ? others[at].order : null;
    const hi = others[at + 1]?.order ?? null;
    for (const id of req.ids) {
      const s = file.list.sections.find((x) => x.id === id) ?? fail('not-found', 'No such section');
      s.order = keyBetween(lo, hi);
      lo = s.order;
    }
    file.list.sections.sort((a, b) => compareKeys(a.order, b.order) || compareKeys(a.id, b.id));
    return this.listResult([file.list], [this.save(file, origin)]);
  }
}
