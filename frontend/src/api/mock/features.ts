// The smaller feature endpoints for the in-memory mock (dev with VITE_MOCK_API=1 and the GitHub Pages
// demo, DESIGN §6.46): the calendar's dated notes (API.md §25), flashcard records (§34), habits
// (§35), properties with their types and renames (§38) and note queries (§40), computed from the mock
// vault as the server computes them from its index; and "off" answers for what needs a real server
// (Ask your vault, reminder delivery, Web Push).
import type {
  AiStatus,
  DatedNote,
  DatedNotesResponse,
  FailedUpdate,
  FlashcardCard,
  FlashcardConfig,
  FlashcardConfigUpdateRequest,
  FlashcardNotesResponse,
  FlashcardsResponse,
  FlashcardUndoRequest,
  FlashcardWriteResult,
  FlashcardReview,
  HabitsResponse,
  NotesQueryResponse,
  PropertiesResponse,
  PropertyRenameRequest,
  PropertyRenameResult,
  PropertyType,
  PropertyTypesResponse,
  PropertyUpdate,
  PropertyValuesResponse,
  QueriedNote,
  RemindersStatus,
} from '../types';
import { fail } from './problems';
import { blobId } from './sha1';
import type { MockVault } from './vault';

const DAY = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const WIKI_DAY = /^\[\[(\d{4}-\d{2}-\d{2})(?:\|[^\]]*)?\]\]$/;

function dayOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = DAY.exec(value.trim()) ?? WIKI_DAY.exec(value.trim());
  return m ? m[1] : null;
}

function notePaths(vault: MockVault): string[] {
  return vault.paths().filter((p) => p.endsWith('.md') && !p.endsWith('.excalidraw.md'));
}

/** `GET /api/notes/by-date` (API.md §25.1). */
export function datedNotes(vault: MockVault, params: URLSearchParams): DatedNotesResponse {
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (!DAY.test(from) || !DAY.test(to) || to < from) fail('bad-request', 'from and to must be dates, to not before from');
  const properties = (params.get('property') || 'date').split(',').map((p) => p.trim()).filter(Boolean);
  const templates = vault.getSettings().settings.templates.folder;
  const notes: DatedNote[] = [];
  for (const path of notePaths(vault)) {
    if (templates && path.startsWith(templates + '/')) continue;
    const fm = vault.noteIndex(path)?.frontmatter;
    if (!fm) continue;
    const seen = new Set<string>();
    for (const property of properties) {
      const key = Object.keys(fm).find((k) => k.toLowerCase() === property.toLowerCase());
      if (key === undefined) continue;
      const values = Array.isArray(fm[key]) ? (fm[key] as unknown[]).slice(0, 50) : [fm[key]];
      for (const value of values) {
        const day = dayOf(value);
        if (day && day >= from && day <= to && !seen.has(day)) {
          seen.add(day);
          notes.push({ path, day, property: key, value: String(value) });
        }
      }
    }
  }
  notes.sort((a, b) => a.day.localeCompare(b.day) || a.path.localeCompare(b.path));
  return { from, to, properties, notes };
}

// ---------- flashcards (§34) ----------

export const DEFAULT_FLASHCARD_CONFIG: FlashcardConfig = {
  tags: ['flashcards'],
  foldersAsDecks: false,
  newPerDay: 20,
  reviewsPerDay: 200,
  retention: 0.9,
  maximumInterval: 36500,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  fuzz: true,
  dayStartsAt: 4,
};

/** The review records the server keeps in `.notesapp/srs.json`, held in memory. */
export class MockFlashcards {
  private config: FlashcardConfig = structuredClone(DEFAULT_FLASHCARD_CONFIG);
  private cards: Record<string, FlashcardCard> = {};
  private version: string | null = null;

  private readonly vault: MockVault;

  constructor(vault: MockVault) {
    this.vault = vault;
  }

  private bump(): string {
    this.version = blobId(new TextEncoder().encode(JSON.stringify({ config: this.config, cards: this.cards })));
    return this.version;
  }

  state(): FlashcardsResponse {
    return { config: this.config, cards: this.cards, version: this.version };
  }

  notes(): FlashcardNotesResponse {
    const tags = this.config.tags.map((t) => t.toLowerCase());
    const notes = notePaths(this.vault)
      .filter((path) => {
        const index = this.vault.noteIndex(path);
        if (!index) return false;
        if (this.config.foldersAsDecks) return /::|==|^\?\??$/m.test(this.vault.textAt(path)?.content ?? '');
        return index.tags.some((t) => tags.some((w) => t.toLowerCase() === w || t.toLowerCase().startsWith(w + '/')));
      })
      .map((path) => {
        const text = this.vault.textAt(path)!;
        return { path, version: text.version, content: text.content };
      });
    return { config: this.config, notes };
  }

  review(reviews: FlashcardReview[]): FlashcardWriteResult {
    if (!Array.isArray(reviews) || reviews.length === 0) fail('bad-request', 'reviews must hold 1 to 1,000 answers');
    const changed: Record<string, FlashcardCard | null> = {};
    for (const r of reviews) {
      let record = this.cards[r.card] ?? { note: null, front: null, state: null, reviews: [] };
      if (r.from && r.from !== r.card && this.cards[r.from]) {
        record = { ...record, reviews: [...new Set([...this.cards[r.from].reviews, ...record.reviews])].sort() };
        delete this.cards[r.from];
        changed[r.from] = null;
      }
      const entry = `${r.at} ${r.rating}${r.ms !== undefined ? ` ${r.ms}` : ''}`;
      if (!record.reviews.some((x) => x.split(' ')[0] === r.at)) record = { ...record, reviews: [...record.reviews, entry].sort() };
      if (r.note) record.note = r.note;
      if (r.front) record.front = r.front.replace(/\s+/g, ' ').slice(0, 200);
      const covers = (s: FlashcardCard['state']) => !!s && s.n === record.reviews.length && s.lastReview === record.reviews.at(-1)?.split(' ')[0];
      record.state = covers(r.state ?? null) ? r.state! : covers(record.state) ? record.state : null;
      this.cards[r.card] = record;
      changed[r.card] = record;
    }
    return { cards: changed, version: this.bump() };
  }

  undo(req: FlashcardUndoRequest): FlashcardWriteResult {
    const record = this.cards[req.card];
    if (!record) return { cards: {}, version: this.bump() };
    const reviews = record.reviews.filter((x) => x.split(' ')[0] !== req.at);
    if (reviews.length === 0) {
      delete this.cards[req.card];
      return { cards: { [req.card]: null }, version: this.bump() };
    }
    const state = req.state && req.state.n === reviews.length ? req.state : null;
    this.cards[req.card] = { ...record, reviews, state };
    return { cards: { [req.card]: this.cards[req.card] }, version: this.bump() };
  }

  prune(cards: string[]): FlashcardWriteResult {
    const changed: Record<string, null> = {};
    for (const id of cards ?? []) {
      if (this.cards[id]) {
        delete this.cards[id];
        changed[id] = null;
      }
    }
    return { cards: changed, version: this.bump() };
  }

  setConfig(req: FlashcardConfigUpdateRequest): FlashcardConfig {
    const next = { ...this.config } as Record<string, unknown>;
    for (const [key, value] of Object.entries(req.config ?? {})) {
      if (!(key in DEFAULT_FLASHCARD_CONFIG)) continue;
      next[key] = value === null ? DEFAULT_FLASHCARD_CONFIG[key as keyof FlashcardConfig] : value;
    }
    this.config = next as unknown as FlashcardConfig;
    this.bump();
    return this.config;
  }
}

// ---------- habits (§35) ----------

/** `GET /api/habits` (API.md §35.1). */
export function habits(vault: MockVault): HabitsResponse {
  const settings = vault.getSettings().settings;
  const templates = settings.templates.folder;
  const dailyFolder = settings.dailyNotes.folder;
  const paths = notePaths(vault).filter((p) => !(templates && p.startsWith(templates + '/')));
  const habitFolder = paths.map((p) => p.split('/')).find((segs) => segs.length > 1 && segs.slice(0, -1).some((s) => s.toLowerCase() === 'habits'));
  const isHabit = (path: string) => {
    if (path.split('/').slice(0, -1).some((s) => s.toLowerCase() === 'habits')) return true;
    return vault.noteIndex(path)?.tags.some((t) => t.toLowerCase() === 'habit' || t.toLowerCase().startsWith('habit/')) ?? false;
  };
  const habitNotes = paths.filter(isHabit).map((path) => ({ path, version: vault.textAt(path)!.version, properties: vault.noteIndex(path)?.frontmatter ?? {} }));
  const daily = paths
    .filter((p) => !isHabit(p) && (dailyFolder === '' || p.startsWith(dailyFolder + '/')))
    .flatMap((path) => {
      const values: Record<string, boolean | number | string> = {};
      for (const [k, v] of Object.entries(vault.noteIndex(path)?.frontmatter ?? {})) {
        if (k.length <= 64 && (typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && v.length <= 100))) values[k] = v;
      }
      return Object.keys(values).length > 0 ? [{ path, values }] : [];
    });
  const folder = habitFolder ? habitFolder.slice(0, habitFolder.findIndex((s) => s.toLowerCase() === 'habits') + 1).join('/') : 'Habits';
  return { folder, tag: 'habit', habits: habitNotes, dailyFolder, daily };
}

// ---------- properties (§38) ----------

function inferType(values: unknown[]): PropertyType {
  const kinds = new Set(values.map((v) => (Array.isArray(v) ? 'list' : typeof v === 'boolean' ? 'checkbox' : typeof v === 'number' ? 'number' : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? 'datetime' : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'date' : 'text')));
  if (kinds.size !== 1) return kinds.has('list') ? 'multitext' : 'text';
  const [only] = kinds;
  return only === 'list' ? 'multitext' : (only as PropertyType);
}

export class MockProperties {
  private types: Record<string, string> = {};
  private typesVersion: string | null = null;

  private readonly vault: MockVault;

  constructor(vault: MockVault) {
    this.vault = vault;
  }

  private all(): Map<string, { name: string; values: unknown[] }> {
    const byKey = new Map<string, { name: string; values: unknown[] }>();
    for (const path of notePaths(this.vault)) {
      for (const [name, value] of Object.entries(this.vault.noteIndex(path)?.frontmatter ?? {})) {
        const entry = byKey.get(name.toLowerCase()) ?? { name, values: [] };
        entry.values.push(value);
        byKey.set(name.toLowerCase(), entry);
      }
    }
    return byKey;
  }

  list(): PropertiesResponse {
    const properties = [...this.all().entries()]
      .map(([key, { name, values }]) => {
        const builtin: PropertyType | null = key === 'tags' ? 'tags' : key === 'aliases' ? 'aliases' : null;
        const typed = Object.entries(this.types).find(([k]) => k.toLowerCase() === key)?.[1] as PropertyType | undefined;
        return { name, count: values.length, type: typed ?? builtin, inferred: builtin ?? inferType(values) };
      })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { properties };
  }

  values(name: string): PropertyValuesResponse {
    const counts = new Map<string, number>();
    for (const v of this.all().get(name.toLowerCase())?.values ?? []) {
      for (const one of Array.isArray(v) ? v : [v]) {
        if (one === null || one === undefined || typeof one === 'object') continue;
        counts.set(String(one), (counts.get(String(one)) ?? 0) + 1);
      }
    }
    const values = [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 500);
    return { name, values };
  }

  getTypes(): PropertyTypesResponse {
    return { types: this.types, version: this.typesVersion, source: this.typesVersion ? 'notesapp' : null };
  }

  setType(name: string, type: PropertyType | null): PropertyTypesResponse {
    const next = Object.fromEntries(Object.entries(this.types).filter(([k]) => k.toLowerCase() !== name.toLowerCase()));
    if (type) next[name] = type;
    this.types = next;
    this.typesVersion = blobId(new TextEncoder().encode(JSON.stringify(next)));
    return this.getTypes();
  }

  /**
   * `POST /api/properties/rename` (API.md §38.4): only the key's characters change in each note's
   * frontmatter; a note that already has the new name, or whose key is not a plain block key, keeps it.
   */
  rename(req: PropertyRenameRequest, origin: string | null): PropertyRenameResult {
    const from = req?.from?.trim() ?? '';
    const to = req?.to?.trim() ?? '';
    if (!from || !to || from === to) fail('bad-request', 'from and to must be different property names', { errors: [{ field: 'to', message: 'invalid' }] });
    const dryRun = req.dryRun === true;
    const plain = /^[\p{L}_][\p{L}\p{N} _./-]*$/u.test(to) && !/^(true|false|null)$/i.test(to);
    const written = plain ? to : JSON.stringify(to);
    const updates: PropertyUpdate[] = [];
    const failed: FailedUpdate[] = [];
    for (const path of notePaths(this.vault)) {
      const keys = Object.keys(this.vault.noteIndex(path)?.frontmatter ?? {});
      if (!keys.some((k) => k.toLowerCase() === from.toLowerCase())) continue;
      if (keys.some((k) => k.toLowerCase() === to.toLowerCase())) {
        failed.push({ path, reason: 'property-exists' });
        continue;
      }
      const text = this.vault.textAt(path)!.content;
      const fm = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(text);
      const lines = fm ? fm[2].split('\n') : [];
      const at = lines.findIndex((l) => {
        const m = /^(["']?)([^"':]+)\1[ \t]*:/.exec(l);
        return m !== null && m[2].trim().toLowerCase() === from.toLowerCase();
      });
      if (!fm || at < 0) {
        failed.push({ path, reason: 'not-rewritable' });
        continue;
      }
      lines[at] = lines[at].replace(/^(["']?)([^"':]+)\1/, written);
      const next = fm[1] + lines.join('\n') + fm[3] + text.slice(fm[0].length);
      updates.push({ path, version: dryRun ? null : this.vault.serverWrite(path, next, origin).file.version });
    }
    const typeKey = Object.keys(this.types).find((k) => k.toLowerCase() === from.toLowerCase());
    const typeMoved = typeKey !== undefined && !Object.keys(this.types).some((k) => k.toLowerCase() === to.toLowerCase());
    if (typeMoved && !dryRun) {
      const type = this.types[typeKey] as PropertyType;
      this.setType(typeKey, null);
      this.setType(to, type);
    }
    return { dryRun, from, to, updates, failed, typeMoved, commitId: null };
  }
}

// ---------- note queries (§40.1) ----------

const TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/;

/** `GET /api/notes/query`: tags, folders and links filter; frontmatter, links and tasks come back. */
export function queryNotes(vault: MockVault, params: URLSearchParams): NotesQueryResponse {
  const only = params.get('path');
  const tags = params.getAll('tag').map((t) => t.replace(/^#/, '').toLowerCase());
  const folder = (params.get('folder') ?? '').replace(/^\/+|\/+$/g, '');
  const props = params.getAll('prop').map((p) => /^([^=!]+)(?:(!?=)(.*))?$/.exec(p)).filter((m): m is RegExpExecArray => m !== null);
  const linksTo = params.get('linksTo');
  const withTasks = params.get('tasks') === 'true';
  const limit = Number(params.get('limit') ?? 500);
  const text = (v: unknown) => String(v).replace(/^\[\[(.*?)(?:\|.*)?\]\]$/, '$1').toLowerCase();
  const matches: QueriedNote[] = [];
  for (const path of notePaths(vault)) {
    const index = vault.noteIndex(path);
    const file = vault.textAt(path);
    if (!index || !file) continue;
    if (only && path !== only) continue;
    if (folder && !path.startsWith(folder + '/')) continue;
    if (tags.length > 0 && !tags.every((w) => index.tags.some((t) => t.toLowerCase() === w || t.toLowerCase().startsWith(w + '/')))) continue;
    if (linksTo && !index.links.includes(linksTo) && !index.links.includes(linksTo + '.md')) continue;
    const fm = index.frontmatter;
    const propOk = props.every(([, name, op, value]) => {
      const key = Object.keys(fm ?? {}).find((k) => k.toLowerCase() === name.trim().toLowerCase());
      const v = key === undefined ? undefined : fm![key];
      const values = (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(text);
      if (!op) return values.length > 0;
      const hit = values.includes(value.toLowerCase());
      return op === '=' ? hit : !hit;
    });
    if (!propOk) continue;
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
    const tasks = withTasks
      ? file.content.split('\n').flatMap((line, i) => {
          const m = TASK_LINE.exec(line);
          return m ? [{ line: i, status: m[1], done: m[1] === 'x' || m[1] === 'X', text: m[2].trim() }] : [];
        })
      : null;
    matches.push({
      path,
      title: name,
      aliases: Array.isArray(fm?.aliases) ? (fm.aliases as string[]) : [],
      tags: index.tags,
      frontmatter: fm,
      mtime: file.mtime,
      size: new TextEncoder().encode(file.content).length,
      links: index.links,
      tasks,
    });
  }
  return { notes: matches.slice(0, limit), total: matches.length, truncated: matches.length > limit };
}

// ---------- what needs a real server ----------

export function aiStatus(): AiStatus {
  return {
    state: 'off',
    reason: 'Ask your vault needs the server (it is off in the in-memory mock)',
    provider: 'claude-code',
    model: 'claude-sonnet-5-5',
    models: [],
    keyFile: 'claude-token',
    keyPresent: false,
    cliInstalled: false,
    month: new Date().toISOString().slice(0, 7),
    monthCostUsd: 0,
    monthRequests: 0,
    monthlyBudgetUsd: 5,
    maxContextChars: 60000,
    fake: true,
  };
}

export function remindersStatus(): RemindersStatus {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    zone,
    zoneReported: true,
    serverZone: zone,
    webPush: { available: false, reason: 'Needs the server', publicKey: null, devices: [] },
    ntfy: { configured: false, reason: 'Needs the server', server: null, ownTopic: false },
    inApp: { connections: 0 },
    lastDeliveredAt: null,
    lastError: null,
    lastErrorAt: null,
    upcoming: [],
  };
}
