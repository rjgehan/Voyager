// The guest page runs none of the owner's app (DESIGN §6.48): walking the imports of its entry
// (static ones, and every lazy chunk any of its modules may load, the formula engine's included)
// never reaches a module that holds the owner's state or talks to the owner's API.
import { describe, expect, it } from 'vitest';
import { sourceFiles } from '../test/sources';

const FORBIDDEN = [
  'sync/instance.ts',
  'sync/liveSync.ts',
  'api/hooks.ts',
  'api/endpoints.ts',
  'App.tsx',
  'AppRoutes.tsx',
  'main.tsx',
  'boot.tsx',
  'extensions/builtins.ts',
  'extensions/index.ts',
  'workspace/store.ts',
  'features/navigation.ts',
  'render/liveRich.ts',
  'render/liveEmbeds.tsx',
  'pwa/serviceWorker.ts',
  'editor/NoteEditor.tsx',
  'sheets/links/host.ts',
];

/**
 * Lazy chunks of shared modules that only the owner's app loads, and the calls that load them. The
 * walk does not follow them, and a test below checks that no module of the guest page makes those calls.
 */
const OWNER_ONLY_CHUNKS: Record<string, { loaders: RegExp; why: string }> = {
  // The editor's commands: the owner's palette and menus (extensions/builtins, views/encrypted).
  'editor/kitHandle.ts': { loaders: /\bloadEditorKit\(/, why: 'editor commands' },
  // Vim keys: NoteEditor attaches them; the guest editor has vim off.
  'editor/vimMode.ts': { loaders: /\b(?:loadVim|attachVim)\(/, why: 'vim keys' },
};

const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'";]*?\s*from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function join(folder: string, spec: string): string {
  const parts = folder === '' ? [] : folder.split('/');
  for (const segment of spec.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/** Every source module reachable from `entry`: static imports and dynamic ones (except the owner-only chunks). */
function reachable(files: Record<string, string>, entry: string): Map<string, string | null> {
  const resolve = (from: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null;
    const base = join(folderOf(from), spec);
    for (const candidate of [base + '.ts', base + '.tsx', base + '/index.ts', base + '/index.tsx', base]) {
      if (candidate in files) return candidate;
    }
    return null;
  };
  const seen = new Map<string, string | null>();
  const queue: Array<[string, string | null]> = [[entry, null]];
  while (queue.length > 0) {
    const [file, via] = queue.shift()!;
    if (seen.has(file)) continue;
    seen.set(file, via);
    for (const m of files[file].matchAll(IMPORT)) {
      const dynamic = m[3] !== undefined;
      if (dynamic && file in OWNER_ONLY_CHUNKS) continue;
      const target = resolve(file, m[1] ?? m[2] ?? m[3]);
      if (target) queue.push([target, file]);
    }
  }
  return seen;
}

function chains(graph: Map<string, string | null>, targets: string[]): string[] {
  return targets
    .filter((f) => graph.has(f))
    .map((f) => {
      const chain = [f];
      for (let via = graph.get(f); via; via = graph.get(via) ?? null) chain.push(via);
      return chain.join(' <- ');
    });
}

async function allSources(): Promise<Record<string, string>> {
  return { ...(await sourceFiles('.ts')), ...(await sourceFiles('.tsx')) };
}

describe('the guest page import graph', () => {
  it('reaches the editor, the sync machinery and the formula engine but none of the owner app’s singletons', async () => {
    const files = await allSources();
    const graph = reachable(files, 'share/main.tsx');
    // It is the owner's editor and save machinery, not a copy.
    expect(graph.has('editor/editorSetup.ts')).toBe(true);
    expect(graph.has('sync/DocumentSession.ts')).toBe(true);
    expect(graph.has('share/ShareView.tsx')).toBe(true);
    // Lazy chunks are followed: formulas in a shared note load the engine and the link store.
    expect(graph.has('formulas/engine.ts')).toBe(true);
    expect(graph.has('sheets/links/store.ts')).toBe(true);
    expect(chains(graph, FORBIDDEN)).toEqual([]);
  });

  it('never makes the calls that load the owner-only chunks it does not follow', async () => {
    const files = await allSources();
    const graph = reachable(files, 'share/main.tsx');
    const calls = Object.entries(OWNER_ONLY_CHUNKS).flatMap(([home, { loaders, why }]) =>
      [...graph.keys()].filter((f) => f !== home && loaders.test(files[f])).map((f) => `${f} loads ${why} (${home})`),
    );
    expect(calls).toEqual([]);
  });

  it('would notice: the owner’s entry reaches them, and the formula engine once reached them', async () => {
    const files = await allSources();
    const graph = reachable(files, 'main.tsx');
    expect(graph.has('sync/instance.ts')).toBe(true);
    expect(graph.has('extensions/builtins.ts')).toBe(true);
    // The link store found the owner's vault by importing host.ts; a page now provides it (pageHost.ts).
    const engine = reachable({ ...files, 'sheets/links/store.ts': files['sheets/links/store.ts'] + "\nimport { appLinkHost } from './host';\n" }, 'share/main.tsx');
    expect(chains(engine, ['sync/instance.ts'])[0]).toContain('formulas/engine.ts');
  });
});
