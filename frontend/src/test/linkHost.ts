// A link store host over files in memory (ROADMAP item 42 tests): a vault tree, `notes/query` over
// the notes' frontmatter (written as YAML-ish `key: value` lines), file reads, open documents, and
// item 39's engine for notes' tables. `edit` changes a file as a save would (a new tree version).
import type { NotesQueryFilter } from '../api/endpoints';
import type { FileEntry, NotesQueryResponse, QueriedNote, TreeResponse } from '../api/types';
import { buildVaultTree, type VaultTree } from '../api/vaultTree';
import { formulaEngineForTests } from '../formulas/load';
import { resetLinkStore, type LinkHost, type OpenDocument } from '../sheets/links/store';

function entryOf(path: string, text: string, version: number): FileEntry {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1);
  return {
    path,
    name,
    basename: ext === 'md' ? name.slice(0, -3) : name,
    extension: ext,
    kind: ext === 'md' ? 'note' : 'text',
    size: text.length,
    mtime: new Date(Date.UTC(2026, 9, 22, 9, 30) + version * 1000).toISOString(),
    version: `v${version}`,
    aliases: [],
  };
}

/** `key: value` lines between `---` fences, enough for tests (numbers, booleans, lists in brackets). */
function frontmatterOf(text: string): Record<string, unknown> | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const out: Record<string, unknown> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([^:]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const raw = kv[2].trim();
    let value: unknown = raw;
    if (raw === 'true' || raw === 'false') value = raw === 'true';
    else if (raw !== '' && Number.isFinite(Number(raw))) value = Number(raw);
    else if (raw.startsWith('[') && raw.endsWith(']')) value = raw.slice(1, -1).split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1'));
    else if (raw === '') value = null;
    out[kv[1].trim()] = value;
  }
  return out;
}

export interface TestLinkHost extends LinkHost {
  files: Map<string, string>;
  /** Changes (or creates) a file as a save would; `null` deletes it. */
  edit(path: string, text: string | null): void;
  /** Opens a document on "this device": its text as typed until closed. */
  open(path: string): { type(text: string): void; close(): void };
  queries: NotesQueryFilter[];
  reads: string[];
}

export function testLinkHost(files: Record<string, string>): TestLinkHost {
  const contents = new Map(Object.entries(files));
  const versions = new Map<string, number>([...contents.keys()].map((p) => [p, 1]));
  const listeners = new Set<() => void>();
  const docs = new Map<string, { text: string; listeners: Set<() => void> }>();
  let tree: VaultTree = build();
  function build(): VaultTree {
    const response: TreeResponse = { eventId: 'e', folders: [], files: [...contents].map(([p, t]) => entryOf(p, t, versions.get(p) ?? 1)) };
    return buildVaultTree(response);
  }
  const queried = (path: string, text: string): QueriedNote => ({
    path,
    title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    aliases: [],
    tags: [...text.matchAll(/(?:^|\s)#([\w/-]+)/g)].map((m) => m[1]),
    frontmatter: frontmatterOf(text),
    mtime: tree.byPath.get(path)?.mtime ?? '',
    size: text.length,
    links: [],
    tasks: null,
  });
  const host: TestLinkHost = {
    files: contents,
    queries: [],
    reads: [],
    tree: () => tree,
    onTreeChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async queryNotes(f) {
      host.queries.push(f);
      await Promise.resolve();
      let notes = [...contents].filter(([p]) => p.endsWith('.md')).map(([p, t]) => queried(p, t));
      if (f.path) notes = notes.filter((n) => n.path === f.path);
      for (const t of f.tag ?? []) notes = notes.filter((n) => n.tags.some((x) => x === t || x.startsWith(t + '/')));
      if (f.folder) notes = notes.filter((n) => n.path.startsWith(f.folder + '/'));
      for (const p of f.prop ?? []) {
        const m = /^([^=!]+)(!?=)(.*)$/.exec(p);
        notes = notes.filter((n) => {
          const v = n.frontmatter?.[m ? m[1] : p];
          if (!m) return v !== undefined && v !== null && v !== '';
          return m[2] === '=' ? String(v) === m[3] : String(v) !== m[3];
        });
      }
      if (f.q) notes = notes.filter((n) => (contents.get(n.path) ?? '').toLowerCase().includes(f.q!.toLowerCase()));
      notes.sort((a, b) => (a.path < b.path ? -1 : 1));
      const limit = f.limit ?? 500;
      return { notes: notes.slice(0, limit), total: notes.length, truncated: notes.length > limit } satisfies NotesQueryResponse;
    },
    async readFile(path) {
      host.reads.push(path);
      await Promise.resolve();
      const text = contents.get(path);
      if (text === undefined) throw new Error(`No file at ${path}`);
      return text;
    },
    openDocument(path): OpenDocument | null {
      const d = docs.get(path);
      if (!d) return null;
      return {
        text: () => d.text,
        subscribe(fn) {
          d.listeners.add(fn);
          return () => d.listeners.delete(fn);
        },
      };
    },
    tableComputer: async () => (await formulaEngineForTests()).computeTables,
    edit(path, text) {
      if (text === null) contents.delete(path);
      else contents.set(path, text);
      versions.set(path, (versions.get(path) ?? 0) + 1);
      tree = build();
      for (const fn of [...listeners]) fn();
    },
    open(path) {
      const d = { text: contents.get(path) ?? '', listeners: new Set<() => void>() };
      docs.set(path, d);
      return {
        type(text) {
          d.text = text;
          for (const fn of [...d.listeners]) fn();
        },
        close() {
          docs.delete(path);
        },
      };
    },
  };
  return host;
}

/** A fresh page store over a test host. */
export function useTestLinkHost(files: Record<string, string>): TestLinkHost {
  const host = testLinkHost(files);
  resetLinkStore(host);
  return host;
}
