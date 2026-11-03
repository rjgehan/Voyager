// The Home Screen app on iOS (DESIGN §6.26): the tags iOS reads from index.html and its icon.
import { beforeAll, describe, expect, it } from 'vitest';

interface NodeFs {
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: 'utf8'): string;
}

let html = '';
let icon: Uint8Array = new Uint8Array();

beforeAll(async () => {
  // Node's fs by a computed name: the app's TypeScript config has no Node types (src/test/sources.ts).
  const name = 'node:fs';
  const fs = (await import(/* @vite-ignore */ name)) as NodeFs;
  const root = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
  html = fs.readFileSync(`${root}/index.html`, 'utf8');
  icon = fs.readFileSync(`${root}/public/apple-touch-icon.png`);
});

const meta = (name: string) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1];
const uint32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

describe('the Home Screen app', () => {
  it('runs standalone and edge to edge, with the safe areas available to the styles', () => {
    expect(meta('viewport')).toContain('viewport-fit=cover');
    expect(meta('apple-mobile-web-app-capable')).toBe('yes');
    // The page draws under the status bar; iOS picks the status bar's text colour for the page.
    expect(meta('apple-mobile-web-app-status-bar-style')).toBe('black-translucent');
    expect(meta('apple-mobile-web-app-title')).toBe('Voyager');
  });

  it('has a 180 px opaque icon that fills its square (iOS rounds the corners itself and paints transparency black)', () => {
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />');
    expect([...icon.slice(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
    expect(uint32(icon, 16)).toBe(180);
    expect(uint32(icon, 20)).toBe(180);
    // Colour type 2: RGB, no alpha channel.
    expect(icon[25]).toBe(2);
  });
});
