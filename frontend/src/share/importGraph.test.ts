// The guest page runs none of the owner's app (DESIGN §6.45): walking the imports of its entry
// (static ones, and the guest page's own lazy chunks) never reaches a module that holds the
// owner's state or talks to the owner's API.
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
  'extensions/builtins.ts',
  'extensions/index.ts',
  'workspace/store.ts',
  'features/navigation.ts',
  'render/liveRich.ts',
  'render/liveEmbeds.tsx',
  'pwa/serviceWorker.ts',
  'editor/NoteEditor.tsx',
];

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

/** Every source module reachable from `entry`: static imports, and dynamic ones made by modules under `share/`. */
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
      if (dynamic && !file.startsWith('share/')) continue;
      const target = resolve(file, m[1] ?? m[2] ?? m[3]);
      if (target) queue.push([target, file]);
    }
  }
  return seen;
}

describe('the guest page import graph', () => {
  it('reaches the editor and the sync machinery but none of the owner app’s singletons', async () => {
    const files = { ...(await sourceFiles('.ts')), ...(await sourceFiles('.tsx')) };
    const graph = reachable(files, 'share/main.tsx');
    // It is the owner's editor and save machinery, not a copy.
    expect(graph.has('editor/editorSetup.ts')).toBe(true);
    expect(graph.has('sync/DocumentSession.ts')).toBe(true);
    expect(graph.has('share/ShareView.tsx')).toBe(true);
    const found = FORBIDDEN.filter((f) => graph.has(f)).map((f) => {
      const chain = [f];
      for (let via = graph.get(f); via; via = graph.get(via) ?? null) chain.push(via);
      return chain.join(' <- ');
    });
    expect(found).toEqual([]);
  });

  it('would notice: the owner’s entry reaches them', async () => {
    const files = { ...(await sourceFiles('.ts')), ...(await sourceFiles('.tsx')) };
    const graph = reachable(files, 'main.tsx');
    expect(graph.has('sync/instance.ts')).toBe(true);
    expect(graph.has('extensions/builtins.ts')).toBe(true);
  });
});
