// When reset rebuilds the jar and the frontend (builds.mjs), on fake trees with set file times.
// `npm run test:scripts`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { frontendIsStale, jarIsStale } from './builds.mjs';

const T0 = new Date('2026-11-02T20:00:00Z');
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);
/** The fixed time of a reproducible build's jar. */
const REPRODUCIBLE = new Date('1980-02-01T00:00:00Z');

let root;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'notesapp-builds-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function file(path, time) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, 'x');
  utimesSync(full, time, time);
}

/** Folders get the time of their last added entry: give every folder an old time once a tree is made. */
function oldFolders(dir = root) {
  for (const d of readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) oldFolders(join(dir, d.name));
  utimesSync(dir, at(-600), at(-600));
}

/** A backend packaged at T0: the jar (fixed time), the plain jar Spring Boot keeps, classes before it. */
function packagedBackend() {
  file('backend/pom.xml', at(-120));
  file('backend/src/main/java/A.java', at(-90));
  file('backend/target/classes/A.class', at(-30));
  file('backend/target/classes/META-INF/build-info.properties', at(-30));
  file('backend/target/notesapp-0.0.1-SNAPSHOT.jar.original', T0);
  file('backend/target/notesapp-0.0.1-SNAPSHOT.jar', REPRODUCIBLE);
  oldFolders();
  return join(root, 'backend');
}

test('a freshly packaged jar is current', () => {
  assert.equal(jarIsStale(packagedBackend()), false);
});

test('the jar is stale when a source or the pom changed after packaging', () => {
  const backend = packagedBackend();
  file('backend/src/main/java/A.java', at(60));
  assert.equal(jarIsStale(backend), true);
  file('backend/src/main/java/A.java', at(-90));
  assert.equal(jarIsStale(backend), false);
  file('backend/pom.xml', at(60));
  assert.equal(jarIsStale(backend), true);
});

test('the jar is stale when classes were compiled after packaging without repackaging it', () => {
  // An edit, then `mvnw test`, a verify whose tests failed, or an IDE: target/classes is newer than
  // the edit, but the jar was packaged before it.
  const backend = packagedBackend();
  file('backend/src/main/java/A.java', at(60));
  file('backend/target/classes/A.class', at(120));
  file('backend/target/classes/META-INF/build-info.properties', at(120));
  assert.equal(jarIsStale(backend), true);
});

test('a jar without its packaging time, or no jar, is rebuilt', () => {
  const backend = packagedBackend();
  rmSync(join(backend, 'target', 'notesapp-0.0.1-SNAPSHOT.jar.original'));
  assert.equal(jarIsStale(backend), true);
  rmSync(join(backend, 'target', 'notesapp-0.0.1-SNAPSHOT.jar'));
  assert.equal(jarIsStale(backend), true);
});

/** A frontend built at T0 from inputs that are all older. */
function builtFrontend() {
  for (const path of [
    'frontend/src/main.tsx',
    'frontend/index.html',
    'frontend/share.html',
    'frontend/package.json',
    'frontend/package-lock.json',
    'frontend/vite.config.ts',
    'frontend/vite-plugin-sw.ts',
    'frontend/vite-plugin-guide.ts',
    'frontend/public/theme-boot.js',
    'frontend/public/manifest.webmanifest',
    'docs/guide/index.md',
  ]) {
    file(path, at(-60));
  }
  file('frontend/node_modules/vite/package.json', at(600));
  file('frontend/dist/index.html', T0);
  oldFolders();
  return join(root, 'frontend');
}

test('a fresh frontend build is current', () => {
  assert.equal(frontendIsStale(builtFrontend()), false);
});

for (const input of [
  'frontend/src/main.tsx',
  'frontend/index.html',
  'frontend/share.html',
  'frontend/package.json',
  'frontend/package-lock.json',
  'frontend/vite.config.ts',
  'frontend/vite-plugin-sw.ts',
  'frontend/vite-plugin-guide.ts',
  'frontend/public/theme-boot.js',
  'frontend/public/manifest.webmanifest',
  'docs/guide/index.md',
]) {
  test(`the frontend build is stale when ${input} changed after it`, () => {
    const frontend = builtFrontend();
    file(input, at(60));
    assert.equal(frontendIsStale(frontend), true);
  });
}

test('no frontend build is stale', () => {
  const frontend = builtFrontend();
  rmSync(join(frontend, 'dist'), { recursive: true });
  assert.equal(frontendIsStale(frontend), true);
});
