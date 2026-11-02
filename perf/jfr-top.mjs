#!/usr/bin/env node
// Summarizes a JFR recording's CPU samples (docs/PERFORMANCE.md, "Profiling"): the methods with the most samples
// anywhere on the stack (inclusive) and on top of it (self), optionally only for some threads or a time window.
//
//   node perf/jfr-top.mjs <file.jfr> [--thread <substring>] [--from HH:MM:SS] [--to HH:MM:SS] [--top 40]
//        [--package com.rjgehan]   (inclusive list restricted to frames of that package prefix)
//        [--cpu true]              (only CPU samples; by default threads blocked in native code count too)
//
// Times are the recording's local wall-clock times, as the server log prints them.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const [file, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
  return pairs;
}, []));
if (!file) {
  console.error('usage: node perf/jfr-top.mjs <file.jfr> [--thread name] [--from HH:MM:SS] [--to HH:MM:SS] [--top N] [--package prefix]');
  process.exit(2);
}
const top = Number(args.top ?? 40);
const from = args.from ?? '00:00:00';
const to = args.to ?? '99:99:99';

// Native samples (threads blocked in native code: file I/O, fsync, sockets) are included unless --cpu is given.
const events = args.cpu ? 'jdk.ExecutionSample' : 'jdk.ExecutionSample,jdk.NativeMethodSample';
const child = spawn('jfr', ['print', '--stack-depth', '96', '--events', events, file]);
child.stderr.pipe(process.stderr);
const inclusive = new Map();
const self = new Map();
let samples = 0;
let time = '';
let thread = '';
let frames = null;

function finish() {
  if (!frames || frames.length === 0) return;
  if (time < from || time > to) return;
  if (args.thread && !thread.includes(args.thread)) return;
  samples++;
  self.set(frames[0], (self.get(frames[0]) ?? 0) + 1);
  const seen = new Set();
  for (const n of frames) {
    if (args.package && !n.startsWith(args.package)) continue;
    if (!seen.has(n)) {
      seen.add(n);
      inclusive.set(n, (inclusive.get(n) ?? 0) + 1);
    }
  }
}

readline.createInterface({ input: child.stdout }).on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.startsWith('jdk.ExecutionSample {') || trimmed.startsWith('jdk.NativeMethodSample {')) {
    frames = null;
    time = '';
    thread = '';
  } else if (trimmed.startsWith('startTime = ')) {
    time = trimmed.slice(12, 24);
  } else if (trimmed.startsWith('sampledThread = ')) {
    thread = trimmed.slice(16);
  } else if (trimmed === 'stackTrace = [') {
    frames = [];
  } else if (frames && trimmed === ']') {
    finish();
    frames = null;
  } else if (frames && trimmed && trimmed !== '...') {
    frames.push(trimmed.replace(/\s+line:.*$/, '').replace(/\(.*\)$/, ''));
  }
});
child.on('close', () => {
  const print = (title, map) => {
    console.log(`\n${title} (${samples} samples)`);
    for (const [n, c] of [...map].sort((a, b) => b[1] - a[1]).slice(0, top)) {
      console.log(`${String(c).padStart(7)} ${((100 * c) / Math.max(1, samples)).toFixed(1).padStart(5)}%  ${n}`);
    }
  };
  print('inclusive', inclusive);
  print('self', self);
});
