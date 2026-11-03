// Starts NotesApp on a FRESH scratch vault for the e2e suite, stopping the stack the last reset
// started first. It only ever touches e2e/.run/ (the scratch vaults, logs and PIDs); the dev
// vault, the user's vault and every other process on the machine are left alone.
//
//   npm run reset              backend jar (dev profile) on :18570 + Vite on :5153
//   npm run reset -- --prod    the jar serving the BUILT frontend on :18570, as in production
//   npm run reset -- --build   rebuild the jar (and, with --prod, the frontend) even if it looks current
//
// For the hallway test on the iPhone (README): E2E_WEB_HOST=<the PC's tailnet address> binds Vite to
// that one address (never 0.0.0.0), and E2E_EXTRA_HOSTS=<name:port,...> admits more Host names.
//
// The jar is rebuilt by itself when backend/src/main, pom.xml or target/classes is newer than its
// last packaging, the frontend build (--prod) when anything `npm run build` reads is newer than it
// (scripts/builds.mjs).
import { execFileSync, execSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { findJar, frontendIsStale, jarIsStale } from './builds.mjs';
import { hostPort, listOf, serverArgs as launchArgs, viteLaunch } from './launch.mjs';
import { API_PORT, E2E_LOGIN, ROOT, RUN, WEB_PORT, recordPids, stopRecorded, writeEnv } from './stack.mjs';

const args = new Set(process.argv.slice(2));
const prod = args.has('--prod') || process.env.E2E_MODE === 'prod';
const forceBuild = args.has('--build');
const win = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The hallway test (README): Vite on the PC's tailnet address, and the host names the phone uses.
const WEB_HOST = process.env.E2E_WEB_HOST?.trim() || undefined;
const EXTRA_HOSTS = listOf(process.env.E2E_EXTRA_HOSTS);
if (prod && WEB_HOST) throw new Error('E2E_WEB_HOST is for the dev stack (Vite); with --prod the server listens on 127.0.0.1 only.');

const API_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_URL = prod
  ? `http://localhost:${API_PORT}`
  : WEB_HOST // Vite then listens on that address only.
    ? `http://${hostPort(WEB_HOST, WEB_PORT)}`
    : `http://localhost:${WEB_PORT}`;

function run(cmd, cmdArgs, cwd, env = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(' ')}   (in ${cwd})`);
  const opts = { cwd, stdio: 'inherit', env: { ...process.env, ...env } };
  // .cmd scripts (mvnw.cmd, npm.cmd) need cmd.exe on Windows; give it one command line, with quotes only
  // where a part needs them. A quoted bare name that cmd.exe finds on the PATH ("npm") runs the batch file
  // with %~dp0 set to the current folder, so npm.cmd looks for its own files there and fails.
  const quote = (a) => (/[\s"&|<>^()]/.test(a) ? `"${a}"` : a);
  if (win) execSync([cmd, ...cmdArgs].map(quote).join(' '), opts);
  else execFileSync(cmd, cmdArgs, opts);
}

function ensureJar() {
  const backend = join(ROOT, 'backend');
  let jar = findJar(backend);
  if (forceBuild || jarIsStale(backend)) {
    console.log(jar ? 'Rebuilding the backend jar (sources or classes changed since it was packaged)...' : 'Building the backend jar...');
    // Offline locally (the user's Maven cache has everything); CI downloads what it needs.
    const mvnArgs = ['-B', '-q', '-DskipTests', 'package', ...(process.env.CI ? ['-ntp'] : ['-o'])];
    // By its full path: cmd.exe may be set not to look in the current folder.
    if (win) run(join(backend, 'mvnw.cmd'), mvnArgs, backend);
    else run('sh', ['./mvnw', ...mvnArgs], backend);
    jar = findJar(backend);
  }
  if (!jar) throw new Error('No backend/target/notesapp-*.jar after the build.');
  return jar;
}

function ensureFrontendBuild() {
  const fe = join(ROOT, 'frontend');
  if (forceBuild || frontendIsStale(fe)) {
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
const unchecked = await stopRecorded();
for (const port of prod ? [API_PORT] : [API_PORT, WEB_PORT]) {
  // A process just stopped can hold its port for a moment.
  for (let i = 0; i < 20 && (await listening(port)); i++) await sleep(500);
  if (await listening(port)) {
    if (unchecked.length > 0) {
      const list = unchecked.map((e) => `${e.name} (pid ${e.pid})`).join(', ');
      throw new Error(`Port ${port} is in use, and the last reset's ${list} could not be checked, so it was left running. Stop it yourself.`);
    }
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

const serverArgs = launchArgs({
  platform: process.platform,
  apiPort: API_PORT,
  webPort: WEB_PORT,
  run: RUN,
  login: E2E_LOGIN,
  join,
  webHost: WEB_HOST,
  extraHosts: EXTRA_HOSTS,
});

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
  const launch = viteLaunch({
    vite: join(fe, 'node_modules', 'vite', 'bin', 'vite.js'),
    webPort: WEB_PORT,
    apiUrl: API_URL,
    webHost: WEB_HOST,
    extraHosts: EXTRA_HOSTS,
  });
  const vite = start('vite', 'node', process.execPath, launch.args, { cwd: fe, env: launch.env, log: webLog });
  pids.push(vite.entry);
  recordPids(pids);
  console.log(`Starting Vite on ${WEB_URL} (pid ${vite.entry.pid}, log .run/web.log)...`);
  await waitFor(WEB_URL, 'Vite', vite.child, webLog, { timeout: 60_000 });
}

writeEnv({ mode: prod ? 'prod' : 'dev', apiUrl: API_URL, webUrl: WEB_URL, login: E2E_LOGIN, startedAt: new Date().toISOString() });
console.log(`Ready: empty vault (${join(RUN, 'vault')}), API ${API_URL}, app ${WEB_URL}.`);
console.log(`Stop it with: npm run stop   (seed a lived-in vault first with: npm run seed)`);
