// Shared by reset.mjs and stop.mjs: where the scratch stack lives and how its processes are
// stopped. Everything the suite starts is recorded in .run/pids.json and stopped by that exact
// PID — never by name, command line or port, so nothing else on the machine is ever touched.
// Before a recorded PID is stopped it is checked to still be the program that was started
// (java or node; tasklist on Windows, /proc on Linux, ps on macOS) and to date from this boot, so a
// PID the system has since reused is left alone.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { basename, dirname, join } from 'node:path';
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
export function recordedPids(file = PIDS) {
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

export function recordPids(list, file = PIDS) {
  writeFileSync(file, JSON.stringify(list, null, 2));
}

function exists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The program a PID runs now, lower case without ".exe" ("java", "node"), or null when it cannot
 * be told (the PID is gone, or the lookup failed).
 */
export function imageOf(pid, platform = process.platform, run = execFileSync) {
  try {
    if (platform === 'win32') {
      const out = run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      const m = /^"([^"]+)"/m.exec(out);
      return m ? m[1].toLowerCase().replace(/\.exe$/, '') : null;
    }
    if (platform === 'linux') return readFileSync(`/proc/${pid}/comm`, 'utf8').trim().toLowerCase();
    // macOS has no /proc; its ps prints the program's full path (".../Contents/Home/bin/java").
    const out = String(run('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' })).trim();
    return out ? basename(out).toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * What a recorded PID is now: `ours` (alive, started after the last boot, running the program
 * that was started), `gone`, `other` (the system reused the PID), or `unknown` (alive, but its
 * program could not be told).
 */
export function recordedState({ pid, image, startedAt }, lookup = imageOf) {
  if (!exists(pid)) return 'gone';
  const bootedAt = Date.now() - uptime() * 1000;
  if (startedAt && startedAt < bootedAt) return 'other';
  const now = lookup(pid);
  if (now == null) return exists(pid) ? 'unknown' : 'gone';
  return !image || now === image ? 'ours' : 'other';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stops every process the last reset recorded, by its PID, and waits for each to exit. A PID whose
 * program cannot be told is left alone and stays recorded, so a later stop can try again rather
 * than forget a server that still holds its port.
 */
export async function stopRecorded({ quiet = false, file = PIDS, lookup = imageOf } = {}) {
  const kept = [];
  for (const entry of recordedPids(file)) {
    const { name, pid } = entry;
    const state = recordedState(entry, lookup);
    if (state === 'unknown') {
      console.warn(`Could not tell which program pid ${pid} (${name}) runs: left running, still recorded in ${file}.`);
      kept.push(entry);
      continue;
    }
    if (state !== 'ours') continue;
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
  if (kept.length > 0) recordPids(kept, file);
  else if (existsSync(file)) rmSync(file);
  return kept;
}

export function writeEnv(env) {
  writeFileSync(ENV, JSON.stringify(env, null, 2));
}
