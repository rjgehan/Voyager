// The mock's Welcome note is the note the server writes on first start, so the tour developers see
// against the mock is the one people get (DESIGN §6.45, §7.8).
import { describe, expect, it } from 'vitest';
import { seedFiles } from './seed';

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}

async function serverWelcome(): Promise<string> {
  const name = 'node:fs';
  const fs = (await import(/* @vite-ignore */ name)) as NodeFs;
  const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
  return fs.readFileSync(`${cwd}/../backend/src/main/resources/welcome/Welcome.md`, 'utf8');
}

describe('the mock seed', () => {
  it('has the server’s Welcome note', async () => {
    const welcome = seedFiles().find((f) => f.path === 'Welcome.md');
    expect(welcome?.content).toBe(await serverWelcome());
  });

  it('keeps the Live Preview demo as a note of its own', () => {
    const demo = seedFiles().find((f) => f.path === 'Live Preview demo.md');
    expect(demo?.content).toContain('# Live Preview demo');
    expect(demo?.content).toContain('![[Plan B#Risks]]');
  });
});
