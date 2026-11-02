// Shared by reset.mjs and stop.mjs: where the scratch stack lives and how its processes are
// stopped. Everything the suite starts is recorded in .run/pids.json and stopped by that exact
// PID — never by name, command line or port, so nothing else on the machine is ever touched.
// Before a recorded PID is stopped it is checked to still be the program that was started
// (java or node) and to date from this boot, so a PID the system has since reused is left alone.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = join(E2E, '..');
export const RUN = join(E2E, '.run');
export const PIDS = join(RUN, 'pids.json');
export const ENV = join(RUN, 'env.json');

export const API_PORT = Number(process.env.E2E_API_PORT ?? 18570);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5153);
// A Tailscale login the identity allowlist admits; any other login is refused (tests/api/security).
export const E2E_LOGIN = 'e2e-owner@example.test';

/** The processes the last reset started: [{ name, pid, image, startedAt }]. */
export function recordedPids() {
  if (!existsSync(PIDS)) return [];
  try {
    return JSON.parse(readFileSync(PIDS, 'utf8'));
  } catch {
    return [];
  }
}

export function recordPids(list) {
  writeFileSync(PIDS, JSON.stringify(list, null, 2));
}

function exists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The program a PID runs now, lower case without ".exe" ("java", "node"), or null. */
function imageOf(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      const m = /^"([^"]+)"/m.exec(out);
      return m ? m[1].toLowerCase().replace(/\.exe$/, '') : null;
    }
    return readFileSync(`/proc/${pid}/comm`, 'utf8').trim().toLowerCase();
  } catch {
    return null;
  }
}

/** Still the process we started: alive, started after the last boot, running the same program. */
export function stillOurs({ pid, image, startedAt }) {
  if (!exists(pid)) return false;
  const bootedAt = Date.now() - uptime() * 1000;
  if (startedAt && startedAt < bootedAt) return false;
  const now = imageOf(pid);
  return now != null && (!image || now === image);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stops every process the last reset recorded, by its PID, and waits for each to exit. */
export async function stopRecorded({ quiet = false } = {}) {
  for (const entry of recordedPids()) {
    const { name, pid } = entry;
    if (!stillOurs(entry)) continue;
    if (!quiet) console.log(`Stopping ${name} (pid ${pid})...`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 60 && exists(pid); i++) await sleep(250);
    if (exists(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  if (existsSync(PIDS)) rmSync(PIDS);
}

export function writeEnv(env) {
  writeFileSync(ENV, JSON.stringify(env, null, 2));
}
