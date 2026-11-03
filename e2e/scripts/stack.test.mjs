// How reset and stop stop what they started (stack.mjs): by the recorded PID, after checking it is
// still the program that was started, on Windows, Linux and macOS. `npm run test:scripts`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { imageOf, stopRecorded } from './stack.mjs';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

/** A node process that runs until stopped, recorded in a pids file of its own. */
function startRecorded() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const dir = mkdtempSync(join(tmpdir(), 'notesapp-pids-'));
  const file = join(dir, 'pids.json');
  writeFileSync(file, JSON.stringify([{ name: 'probe', pid: child.pid, image: 'node', startedAt: Date.now() }]));
  cleanup.push(() => {
    if (alive(child.pid)) child.kill();
    rmSync(dir, { recursive: true, force: true });
  });
  return { child, file };
}

test('on macOS the program comes from ps, which prints its full path', () => {
  const calls = [];
  const ps = (cmd, args) => {
    calls.push([cmd, ...args]);
    return '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java\n';
  };
  assert.equal(imageOf(4242, 'darwin', ps), 'java');
  assert.deepEqual(calls, [['ps', '-p', '4242', '-o', 'comm=']]);
  assert.equal(imageOf(4242, 'darwin', () => 'node\n'), 'node');
  // ps exits non-zero for a PID that is gone.
  const gone = () => {
    throw new Error('exit 1');
  };
  assert.equal(imageOf(4242, 'darwin', gone), null);
});

test('stop stops the recorded process by its PID and forgets it', async () => {
  const { child, file } = startRecorded();
  await sleep(200);
  assert.equal(imageOf(child.pid), 'node');
  await stopRecorded({ quiet: true, file });
  for (let i = 0; i < 40 && alive(child.pid); i++) await sleep(50);
  assert.equal(alive(child.pid), false);
  assert.equal(existsSync(file), false);
});

test('a recorded process whose program cannot be told is left running and stays recorded', async () => {
  const { child, file } = startRecorded();
  await sleep(200);
  await stopRecorded({ quiet: true, file, lookup: () => null });
  assert.equal(alive(child.pid), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).map((e) => e.pid), [child.pid]);
});

test('a recorded PID that now runs another program, or is gone, is forgotten without a signal', async () => {
  const { child, file } = startRecorded();
  await sleep(200);
  await stopRecorded({ quiet: true, file, lookup: () => 'explorer' });
  assert.equal(alive(child.pid), true);
  assert.equal(existsSync(file), false);
});
