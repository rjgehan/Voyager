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

/** A copy of the suite under tmp/<folders>/e2e, sharing node_modules. */
function copySuite(tmp, ...folders) {
  const copy = join(tmp, ...folders, 'e2e');
  for (const part of ['lib', 'tests', 'playwright.config.ts', 'package.json', 'tsconfig.json']) {
    cpSync(join(E2E, part), join(copy, part), { recursive: true });
  }
  symlinkSync(join(E2E, 'node_modules'), join(copy, 'node_modules'), 'junction');
  return copy;
}

/** Project name → the spec files it would run, as paths relative to e2e/ with "/". */
function listed(e2eDir, args = ['--project=api', '--project=desktop', '--project=iphone'], cliDir = E2E) {
  const cli = join(cliDir, 'node_modules', '@playwright', 'test', 'cli.js');
  const out = execFileSync(process.execPath, [cli, 'test', '--list', '--reporter=json', ...args], {
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
    const copy = copySuite(tmp, 'openapi', 'mobile-ui');
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

/** The projects the config defines for a command line (whatever tests they would run). */
function projectNames(e2eDir, args, cliDir = E2E) {
  const cli = join(cliDir, 'node_modules', '@playwright', 'test', 'cli.js');
  const out = execFileSync(process.execPath, [cli, 'test', '--list', '--reporter=json', '--pass-with-no-tests', ...args], {
    cwd: e2eDir,
    encoding: 'utf8',
    env: { ...process.env, E2E_SCREENS: '', CI: '' },
  });
  return JSON.parse(out).config.projects.map((p) => p.name).sort();
}

test('the screen inventory runs only when its project is named, not when "screens" is in a path or a grep', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'notesapp-e2e-'));
  try {
    // A bare run from a checkout under .../screenshots/: the CLI's own path contains "screens".
    const copy = copySuite(tmp, 'screenshots');
    assert.deepEqual(projectNames(copy, [], copy), ['api', 'desktop', 'iphone']);
    assert.deepEqual(projectNames(E2E, ['--grep', 'screenshare']), ['api', 'desktop', 'iphone']);
    for (const args of [['--project=screens'], ['--project', 'screens'], ['--project=api', '--project=screens']]) {
      assert.ok(projectNames(E2E, args).includes('screens'), args.join(' '));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
