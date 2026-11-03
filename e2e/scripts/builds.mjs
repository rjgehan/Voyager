// When `npm run reset` rebuilds what it runs (reset.mjs), as functions of the files on disk.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Newest modification time under a path (a file, or a folder walked recursively); 0 if missing. */
export function newest(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const d of readdirSync(path, { withFileTypes: true })) {
    if (d.name === 'node_modules' || d.name === 'dist') continue;
    max = Math.max(max, newest(join(path, d.name)));
  }
  return max;
}

/** The runnable jar in backend/target, or null. */
export function findJar(backend) {
  const target = join(backend, 'target');
  if (!existsSync(target)) return null;
  const jar = readdirSync(target).find((f) => /^notesapp-.*\.jar$/.test(f) && !f.endsWith('-plain.jar'));
  return jar ? join(target, jar) : null;
}

/**
 * When the jar was packaged, or 0. The jar's own time is fixed (reproducible builds: 1980), but
 * Spring Boot's repackage keeps the plain jar next to it as `.jar.original`, written at every package.
 */
export function packagedAt(jar) {
  const original = `${jar}.original`;
  return existsSync(original) ? statSync(original).mtimeMs : 0;
}

/**
 * Whether the backend jar is missing or older than what it is built from: the sources, the pom, and
 * the compiled classes, which `mvnw test`, a verify whose tests failed or an IDE update without
 * repackaging the jar.
 */
export function jarIsStale(backend) {
  const jar = findJar(backend);
  if (!jar) return true;
  const packaged = packagedAt(jar);
  const inputs = [join(backend, 'src', 'main'), join(backend, 'pom.xml'), join(backend, 'target', 'classes')];
  return packaged === 0 || Math.max(...inputs.map(newest)) > packaged;
}

/**
 * What `npm run build` in frontend/ reads: the sources, public/, every file at the top of frontend/
 * (index.html, share.html, the package files, vite.config.ts and its plugins, the tsconfigs) and the
 * user guide, which the Help page bundles from docs/guide.
 */
export function frontendInputs(frontend) {
  const top = readdirSync(frontend, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => join(frontend, d.name));
  return [join(frontend, 'src'), join(frontend, 'public'), join(frontend, '..', 'docs', 'guide'), ...top];
}

/** Whether the built frontend (dist/) is missing or older than what it is built from. */
export function frontendIsStale(frontend) {
  const dist = join(frontend, 'dist', 'index.html');
  if (!existsSync(dist)) return true;
  return Math.max(...frontendInputs(frontend).map(newest)) > statSync(dist).mtimeMs;
}
