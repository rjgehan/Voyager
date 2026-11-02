// Starts NotesApp on a FRESH scratch vault for the e2e suite, stopping the stack the last reset
// started first. It only ever touches e2e/.run/ (the scratch vaults, logs and PIDs); the dev
// vault, the user's vault and every other process on the machine are left alone.
//
//   npm run reset              backend jar (dev profile) on :18570 + Vite on :5153
//   npm run reset -- --prod    the jar serving the BUILT frontend on :18570, as in production
//   npm run reset -- --build   rebuild the jar (and, with --prod, the frontend) even if it looks current
//
// The jar is rebuilt by itself when backend/src or backend/pom.xml is newer than it, the frontend
// build (--prod) when frontend/src, index.html or the lockfile is.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { API_PORT, E2E_LOGIN, ROOT, RUN, WEB_PORT, recordPids, stopRecorded, writeEnv } from './stack.mjs';

const args = new Set(process.argv.slice(2));
const prod = args.has('--prod') || process.env.E2E_MODE === 'prod';
const forceBuild = args.has('--build');
const win = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = prod ? `http://localhost:${API_PORT}` : `http://localhost:${WEB_PORT}`;
// The hosts the browser and the suite use. Vite's proxy keeps the browser's Host, so the Vite
// origin must be allowed too.
const ALLOWED_HOSTS = [`localhost:${WEB_PORT}`, `127.0.0.1:${WEB_PORT}`, `localhost:${API_PORT}`, `127.0.0.1:${API_PORT}`];

/** Newest modification time under a path (a file, or a folder walked recursively). */
function newest(path) {
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

function findJar() {
  const target = join(ROOT, 'backend', 'target');
  if (!existsSync(target)) return null;
  const jar = readdirSync(target).find((f) => /^notesapp-.*\.jar$/.test(f) && !f.endsWith('-plain.jar'));
  return jar ? join(target, jar) : null;
}

function run(cmd, cmdArgs, cwd, env = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(' ')}   (in ${cwd})`);
  const opts = { cwd, stdio: 'inherit', env: { ...process.env, ...env } };
  // .cmd scripts (mvnw.cmd, npm.cmd) need cmd.exe on Windows; give it one quoted command line.
  if (win) execSync([cmd, ...cmdArgs].map((a) => `"${a}"`).join(' '), opts);
  else execFileSync(cmd, cmdArgs, opts);
}

function ensureJar() {
  let jar = findJar();
  const backend = join(ROOT, 'backend');
  // The jar's own timestamp is fixed (reproducible builds), so compare with the compiled classes.
  const built = newest(join(backend, 'target', 'classes'));
  const stale = !jar || Math.max(newest(join(backend, 'src', 'main')), newest(join(backend, 'pom.xml'))) > built;
  if (forceBuild || stale) {
    console.log(jar ? 'Rebuilding the backend jar (sources changed)...' : 'Building the backend jar...');
    // Offline locally (the user's Maven cache has everything); CI downloads what it needs.
    const mvnArgs = ['-B', '-q', '-DskipTests', 'package', ...(process.env.CI ? ['-ntp'] : ['-o'])];
    // By its full path: cmd.exe may be set not to look in the current folder.
    if (win) run(join(backend, 'mvnw.cmd'), mvnArgs, backend);
    else run('sh', ['./mvnw', ...mvnArgs], backend);
    jar = findJar();
  }
  if (!jar) throw new Error('No backend/target/notesapp-*.jar after the build.');
  return jar;
}

function ensureFrontendBuild() {
  const fe = join(ROOT, 'frontend');
  const dist = join(fe, 'dist', 'index.html');
  const src = Math.max(newest(join(fe, 'src')), newest(join(fe, 'index.html')), newest(join(fe, 'package-lock.json')));
  if (forceBuild || !existsSync(dist) || src > statSync(dist).mtimeMs) {
    console.log('Building the frontend...');
    run('npm', ['run', 'build'], fe);
  }
  return join(fe, 'dist');
}

/** Whether something already listens on the port (IPv4 or IPv6 loopback). */
function listening(port) {
  const one = (host) =>
    new Promise((resolve) => {
      const s = connect({ port, host });
      s.once('connect', () => (s.destroy(), resolve(true)));
      s.once('error', () => resolve(false));
      s.setTimeout(500, () => (s.destroy(), resolve(false)));
    });
  return Promise.all([one('127.0.0.1'), one('::1')]).then(([a, b]) => a || b);
}

async function waitFor(url, what, child, log, { timeout = 180_000, ok = (r) => r.ok } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (child.exitCode != null) break;
    try {
      const r = await fetch(url);
      if (ok(r)) return;
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  const tail = existsSync(log) ? readFileSync(log, 'utf8').split('\n').slice(-40).join('\n') : '';
  throw new Error(`${what} did not come up at ${url}. Last lines of ${log}:\n${tail}`);
}

function start(name, image, cmd, cmdArgs, { cwd, env = {}, log }) {
  const fd = openSync(log, 'w');
  const child = spawn(cmd, cmdArgs, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    windowsHide: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  return { child, entry: { name, pid: child.pid, image, startedAt: Date.now() } };
}

// ---------------------------------------------------------------------------------------------
await stopRecorded();
for (const port of prod ? [API_PORT] : [API_PORT, WEB_PORT]) {
  // A process just stopped can hold its port for a moment.
  for (let i = 0; i < 20 && (await listening(port)); i++) await sleep(500);
  if (await listening(port)) {
    throw new Error(
      `Port ${port} is in use by a process this script did not start. Stop it yourself, or pick ` +
        'other ports with E2E_API_PORT / E2E_WEB_PORT.',
    );
  }
}

const builtJar = ensureJar();
const webDir = prod ? ensureFrontendBuild() : null;
// Run a copy: on Windows a running jar is locked, and `mvnw verify` must still be able to rebuild it.
const jar = join(RUN, 'notesapp.jar');
mkdirSync(RUN, { recursive: true });
cpSync(builtJar, jar);

console.log('Wiping the scratch vaults...');
for (const d of ['vault', 'vaults', 'publish', 'web']) rmSync(join(RUN, d), { recursive: true, force: true });
for (const d of ['vault', 'vaults', 'publish']) mkdirSync(join(RUN, d), { recursive: true });

const serverArgs = [
  '--spring.profiles.active=dev',
  `--server.port=${API_PORT}`,
  '--server.address=127.0.0.1',
  `--notes.vault-dir=${join(RUN, 'vault')}`,
  `--notes.vaults.dir=${join(RUN, 'vaults')}`,
  `--notes.publish.dir=${join(RUN, 'publish')}`,
  `--notes.allowed-hosts=${ALLOWED_HOSTS.join(',')}`,
  '--notes.identity.allow-default=true',
  `--notes.identity.allowed-logins=${E2E_LOGIN}`,
  '--notes.security.require-tailscale-interface=false',
  '--notes.git.commit-quiet-period=2s',
  '--logging.level.com.rjgehan.notes=INFO',
];

const pids = [];
const backendLog = join(RUN, 'backend.log');
let backend;
if (prod) {
  // The built frontend goes on the classpath as static/, exactly where the Docker image puts it.
  cpSync(webDir, join(RUN, 'web', 'static'), { recursive: true });
  backend = start('backend', 'java', 'java', [
    '-Dfile.encoding=UTF-8',
    `-Dloader.path=${join(RUN, 'web')}`,
    '-cp', jar,
    'org.springframework.boot.loader.launch.PropertiesLauncher',
    ...serverArgs,
  ], { cwd: RUN, log: backendLog });
} else {
  backend = start('backend', 'java', 'java', ['-Dfile.encoding=UTF-8', '-jar', jar, ...serverArgs], {
    cwd: RUN,
    log: backendLog,
  });
}
pids.push(backend.entry);
recordPids(pids);
console.log(`Starting the backend on ${API_URL} (pid ${backend.entry.pid}, log .run/backend.log)...`);
await waitFor(`${API_URL}/actuator/health`, 'The backend', backend.child, backendLog);

if (!prod) {
  const webLog = join(RUN, 'web.log');
  const fe = join(ROOT, 'frontend');
  if (!existsSync(join(fe, 'node_modules', 'vite'))) throw new Error('Run `npm ci` in frontend/ first.');
  const vite = start('vite', 'node', process.execPath, [join(fe, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(WEB_PORT), '--strictPort'], {
    cwd: fe,
    env: { NOTES_DEV_BACKEND: API_URL },
    log: webLog,
  });
  pids.push(vite.entry);
  recordPids(pids);
  console.log(`Starting Vite on ${WEB_URL} (pid ${vite.entry.pid}, log .run/web.log)...`);
  await waitFor(WEB_URL, 'Vite', vite.child, webLog, { timeout: 60_000 });
}

writeEnv({ mode: prod ? 'prod' : 'dev', apiUrl: API_URL, webUrl: WEB_URL, login: E2E_LOGIN, startedAt: new Date().toISOString() });
console.log(`Ready: empty vault (${join(RUN, 'vault')}), API ${API_URL}, app ${WEB_URL}.`);
console.log(`Stop it with: npm run stop   (seed a lived-in vault first with: npm run seed)`);
