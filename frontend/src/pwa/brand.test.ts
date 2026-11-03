// The app's name where browsers and phones read it (BRAND.md, ROADMAP item 45): the tab title, the
// installed app's name and the Home Screen label say Voyager. The manifest's id and scope do not
// change with the name, so an installed copy stays the same app.
import { beforeAll, describe, expect, it } from 'vitest';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}

let index = '';
let share = '';
let manifest: Record<string, unknown> = {};

beforeAll(async () => {
  // Node's fs by a computed name: the app's TypeScript config has no Node types (src/test/sources.ts).
  const name = 'node:fs';
  const fs = (await import(/* @vite-ignore */ name)) as NodeFs;
  const root = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
  index = fs.readFileSync(`${root}/index.html`, 'utf8');
  share = fs.readFileSync(`${root}/share.html`, 'utf8');
  manifest = JSON.parse(fs.readFileSync(`${root}/public/manifest.webmanifest`, 'utf8')) as Record<string, unknown>;
});

const meta = (html: string, name: string) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1];
const title = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

describe('the name Voyager', () => {
  it('is the page title, the app name and the Home Screen label', () => {
    expect(title(index)).toBe('Voyager');
    expect(meta(index, 'application-name')).toBe('Voyager');
    expect(meta(index, 'apple-mobile-web-app-title')).toBe('Voyager');
    expect(title(share)).toBe('Shared · Voyager');
  });

  it('names the installed app, which keeps its identity', () => {
    expect(manifest.name).toBe('Voyager');
    expect(manifest.short_name).toBe('Voyager');
    expect(manifest.description).toEqual(expect.stringContaining('notes, sheets, drawings and tasks'));
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  it('has no trace of the old name', () => {
    for (const text of [index, share, JSON.stringify(manifest)]) {
      expect(text).not.toMatch(/NotesApp|"Notes"|>Notes</);
    }
  });
});
