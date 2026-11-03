// The Playwright projects (playwright.config.ts) pick their specs by folder, wherever the checkout
// lives: a copy of the suite under folders named like a project ("openapi", "mobile-ui") must list
// exactly what the real one does. `npm run test:scripts`; needs no server or browser.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { E2E } from './stack.mjs';

/** Project name → the spec files it would run, as paths relative to e2e/ with "/". */
function listed(e2eDir) {
  const cli = join(E2E, 'node_modules', '@playwright', 'test', 'cli.js');
  const out = execFileSync(process.execPath, [cli, 'test', '--list', '--reporter=json', '--project=api', '--project=desktop', '--project=iphone'], {
    cwd: e2eDir,
    encoding: 'utf8',
    env: { ...process.env, E2E_SCREENS: '', CI: '' },
  });
  const report = JSON.parse(out);
  const rootDir = report.config.rootDir.replaceAll('\\', '/');
  const base = e2eDir.replaceAll('\\', '/');
  const byProject = {};
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        const file = `${rootDir}/${spec.file}`.slice(base.length + 1);
        (byProject[t.projectName] ??= new Set()).add(file);
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  return Object.fromEntries(Object.entries(byProject).map(([name, files]) => [name, [...files].sort()]));
}

test('each project runs only the specs of its own folder, wherever the checkout is', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'notesapp-e2e-'));
  try {
    const copy = join(tmp, 'openapi', 'mobile-ui', 'e2e');
    for (const part of ['lib', 'tests', 'playwright.config.ts', 'package.json', 'tsconfig.json']) {
      cpSync(join(E2E, part), join(copy, part), { recursive: true });
    }
    symlinkSync(join(E2E, 'node_modules'), join(copy, 'node_modules'), 'junction');
    const projects = listed(copy);
    assert.ok(projects.api?.length > 0 && projects.desktop?.length > 0 && projects.iphone?.length > 0, JSON.stringify(projects));
    for (const file of projects.api) assert.match(file, /^tests\/api\/[^/]+\.spec\.ts$/, `api runs ${file}`);
    for (const name of ['desktop', 'iphone']) {
      for (const file of projects[name]) assert.match(file, /^tests\/ui\/[^/]+\.spec\.ts$/, `${name} runs ${file}`);
    }
    assert.deepEqual(projects, listed(E2E));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
