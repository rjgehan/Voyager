#!/usr/bin/env node
// Prints a Markdown table comparing two results files of bench-backend.mjs (or of bench-browser.mjs): the p50 (and
// p95) of every measurement in both, and the change.
//
//   node perf/compare.mjs <before.json> <after.json>
import fs from 'node:fs';

const [beforeFile, afterFile] = process.argv.slice(2);
if (!beforeFile || !afterFile) {
  console.error('usage: node perf/compare.mjs <before.json> <after.json>');
  process.exit(2);
}
const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));

/** Every leaf measurement as [path, {p50, p95} or a number]. */
function flatten(value, prefix = '', out = new Map()) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') out.set(prefix, { p50: value });
    return out;
  }
  if ('p50' in value && typeof value.p50 === 'number') {
    out.set(prefix, { p50: value.p50, p95: value.p95 });
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (['machine', 'manifest', 'n', 'max', 'startedAt', 'jar', 'url', 'browser', 'browserVersion'].includes(key)) continue;
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

const a = flatten(before);
const b = flatten(after);
const fmt = (v) => (v === undefined ? '' : Number.isInteger(v) ? String(v) : v.toFixed(1));
console.log('| Measurement | Before p50 | After p50 | Before p95 | After p95 | Change (p50) |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const [key, x] of a) {
  const y = b.get(key);
  if (!y) continue;
  const change = x.p50 ? `${(((y.p50 - x.p50) / x.p50) * 100).toFixed(0)} %` : '';
  console.log(`| ${key} | ${fmt(x.p50)} | ${fmt(y.p50)} | ${fmt(x.p95)} | ${fmt(y.p95)} | ${change} |`);
}
