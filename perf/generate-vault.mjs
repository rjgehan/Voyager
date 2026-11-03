#!/usr/bin/env node
// Generates the load-test vault (docs/PERFORMANCE.md): 10,000 notes with links, tags, properties and tables, 500
// attachments (PNGs and PDFs), a 5 MB note, a 2,000 x 30 spreadsheet with formulas, a 1,000-card canvas, a 500-task
// list, and a git history of 2,000 commits. Deterministic for a given seed. Nothing it writes belongs in the repo.
//
//   node perf/generate-vault.mjs --out <dir> [--notes 10000] [--attachments 500] [--commits 2000] [--seed 42]
//
// <dir>/vault is the vault (with its .git); <dir>/manifest.json names the files the benchmarks use.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { COMMON, column, orderKey, pdf, png, rng, syntheticWords, ulid } from './lib/content.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
  return pairs;
}, []));
if (!args.out) {
  console.error('usage: node perf/generate-vault.mjs --out <dir> [--notes N] [--attachments N] [--commits N] [--seed N]');
  process.exit(2);
}
const NOTES = Number(args.notes ?? 10000);
const ATTACHMENTS = Number(args.attachments ?? 500);
const COMMITS = Number(args.commits ?? 2000);
const SEED = Number(args.seed ?? 42);
const HUB_LINKS = Math.min(200, NOTES);
const out = path.resolve(args.out);
const vault = path.join(out, 'vault');
const random = rng(SEED);
const started = Date.now();

if (fs.existsSync(vault)) {
  fs.rmSync(vault, { recursive: true, force: true });
}
fs.mkdirSync(vault, { recursive: true });

const RARE = syntheticWords(3000, random);
const word = () => (random.chance(0.55) ? COMMON[random.skewed(COMMON.length)] : RARE[random.skewed(RARE.length)]);
const words = (n) => Array.from({ length: n }, word).join(' ');
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = () => capital(words(8 + random.int(14))) + '.';
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// ------------------------------------------------------------------ names and paths
const DAY = 86_400_000;
const historyStart = Date.UTC(2024, 10, 1);
const AREAS = 100;
const DAILY = Math.min(730, Math.floor(NOTES / 10));
const notes = []; // { path, name }
for (let i = 0; i < DAILY; i++) {
  const day = isoDay(historyStart + i * DAY);
  notes.push({ path: `Daily/${day}.md`, name: day, daily: true });
}
const usedNames = new Set();
for (let i = notes.length; i < NOTES; i++) {
  let name;
  do {
    name = `${capital(word())} ${capital(word())} ${String(i).padStart(5, '0')}`;
  } while (usedNames.has(name.toLowerCase()));
  usedNames.add(name.toLowerCase());
  // A few names with accents (NFC on disk), as typed on a phone.
  if (i % 997 === 0) name = `Café ${name}`;
  notes.push({ path: `Area ${String(i % AREAS).padStart(2, '0')}/${name}.md`, name });
}

const images = [];
const pdfs = [];
const pdfCount = Math.round(ATTACHMENTS * 0.3);
for (let i = 0; i < ATTACHMENTS - pdfCount; i++) images.push(`Attachments/Image ${String(i).padStart(4, '0')}.png`);
for (let i = 0; i < pdfCount; i++) pdfs.push(`Attachments/Papers/Paper ${String(i).padStart(4, '0')}.pdf`);

// ------------------------------------------------------------------ notes
const STATUSES = ['active', 'done', 'someday', 'waiting', 'archived'];
const linkTo = (target) => {
  const n = random.int(100);
  if (n < 70) return `[[${target.name}]]`;
  if (n < 82) return `[[${target.name}|${words(2)}]]`;
  if (n < 92) return `[[${target.name}#Section ${1 + random.int(3)}]]`;
  return `[${words(2)}](${encodeURI(target.path).replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
};
const table = (rows, cols) => {
  const header = Array.from({ length: cols }, (_, c) => capital(COMMON[(c * 7) % COMMON.length]));
  const lines = [`| ${header.join(' | ')} |`, `|${' --- |'.repeat(cols)}`];
  for (let r = 0; r < rows; r++) {
    lines.push(`| ${Array.from({ length: cols }, (_, c) => (c === 0 ? capital(word()) : String(random.int(10000)))).join(' | ')} |`);
  }
  return lines.join('\n');
};

function noteText(i, note) {
  const parts = [];
  const created = isoDay(historyStart + random.int(700) * DAY);
  const tags = [`area/${i % AREAS}`, COMMON[random.skewed(COMMON.length)]];
  if (i % 3 === 0) tags.push('project');
  const front = ['---', `created: ${created}`, `tags: [${tags.join(', ')}]`];
  if (!note.daily) {
    front.push(`status: ${random.pick(STATUSES)}`, `rating: ${1 + random.int(5)}`, `done: ${random.chance(0.3)}`);
    if (random.chance(0.3)) front.push(`due: ${isoDay(Date.UTC(2026, 9, 1) + random.int(120) * DAY)}`);
    if (random.chance(0.2)) front.push(`aliases: [${capital(word())} ${capital(word())}]`);
    if (random.chance(0.25)) front.push(`related: ["[[${notes[random.int(NOTES)].name}]]"]`);
  }
  front.push('---');
  parts.push(front.join('\n'));
  parts.push(`# ${note.name}`);
  // Sizes vary: most notes are a few KB, a tail are 10-30 KB.
  const sections = 2 + random.skewed(10);
  const linkCount = 3 + random.int(6);
  let links = 0;
  for (let s = 1; s <= sections; s++) {
    parts.push(`## Section ${s}`);
    const paragraphs = 1 + random.int(3);
    for (let p = 0; p < paragraphs; p++) {
      const sentences = Array.from({ length: 2 + random.int(4) }, sentence);
      if (links < linkCount) {
        sentences.splice(random.int(sentences.length), 0, `See ${linkTo(notes[random.skewed(NOTES)])}.`);
        links++;
      }
      if (random.chance(0.3)) sentences.push(`#${COMMON[random.skewed(COMMON.length)]}`);
      parts.push(sentences.join(' '));
    }
    if (s === 1 && i % 4 === 0) parts.push(table(4 + random.int(6), 3 + random.int(3)));
    if (s === 2 && i % 7 === 0) {
      parts.push(Array.from({ length: 3 + random.int(4) }, () => `- [${random.chance(0.4) ? 'x' : ' '}] ${words(5)}`).join('\n'));
    }
    if (s === 2 && i % 11 === 0) parts.push('```js\n' + `const ${word()} = ${random.int(1000)};\nconsole.log(${random.int(9)});\n` + '```');
    if (s === 1 && i % 10 === 0 && images.length) parts.push(`![[${path.posix.basename(images[random.int(images.length)])}]]`);
    if (s === 1 && i % 20 === 0 && pdfs.length) parts.push(`Reading: [[${path.posix.basename(pdfs[random.int(pdfs.length)], '.pdf')}.pdf]]`);
  }
  while (links < linkCount) {
    parts.push(`Related: ${linkTo(notes[random.int(NOTES)])}`);
    links++;
  }
  if (i < HUB_LINKS) parts.push('Back to [[Hub]].');
  return parts.join('\n\n') + '\n';
}

const files = new Map(); // vault path -> Buffer|string (the initial commit's content)
console.log(`generating ${NOTES} notes...`);
notes.forEach((note, i) => files.set(note.path, noteText(i, note)));
files.set('Hub.md', '---\ntags: [hub]\n---\n# Hub\n\nEverything starts here. Two hundred notes link back to this one.\n');

// The 5 MB note: everything Live Preview renders, repeated (about 100,000 lines).
{
  const chunks = ['---\ntags: [big]\nstatus: active\n---\n# Big Note\n'];
  let size = chunks[0].length;
  let block = 0;
  while (size < 5_000_000) {
    let text;
    switch (block % 8) {
      case 0: text = `## Chapter ${block}\n\n${sentence()} ${sentence()} See ${linkTo(notes[random.int(NOTES)])}.\n`; break;
      case 1: text = Array.from({ length: 6 }, () => `- ${words(6)} **${word()}** *${word()}* \`${word()}\``).join('\n') + '\n'; break;
      case 2: text = table(6, 4) + '\n'; break;
      case 3: text = `> [!note] ${capital(word())}\n> ${sentence()}\n`; break;
      case 4: text = '```python\n' + `def ${word()}(x):\n    return x * ${random.int(100)}\n` + '```\n'; break;
      case 5: text = Array.from({ length: 4 }, () => `- [${random.chance(0.5) ? 'x' : ' '}] ${words(5)} #${word()}`).join('\n') + '\n'; break;
      case 6: text = `${sentence()} $x^${random.int(9)}$ and ==${words(2)}==, footnote[^${block}].\n\n[^${block}]: ${sentence()}\n`; break;
      default: text = Array.from({ length: 3 }, sentence).join(' ') + '\n';
    }
    chunks.push(text);
    size += Buffer.byteLength(text) + 1;
    block++;
  }
  files.set('Big/Big Note.md', chunks.join('\n'));
}

// The spreadsheet: 2,000 data rows x 30 columns, a formula column block and a totals row; cached results included.
function bigSheet(seedOffset) {
  const sheetRandom = rng(SEED + seedOffset);
  const ROWS = 2000;
  const NUMBERS = 24; // C..Z
  const lines = [];
  const cell = (ref, json) => lines.push(`        ${JSON.stringify(ref)}: ${json}`);
  const headers = ['Id', 'Date', ...Array.from({ length: NUMBERS }, (_, c) => `M${c + 1}`), 'Total', 'Mean', 'Band', 'Gross'];
  headers.forEach((h, c) => cell(`${column(c)}1`, `{ "v": ${JSON.stringify(h)} }`));
  let grand = 0;
  for (let r = 2; r <= ROWS + 1; r++) {
    cell(`A${r}`, `{ "v": ${JSON.stringify(`R-${r - 1}`)} }`);
    cell(`B${r}`, `{ "v": ${JSON.stringify(isoDay(historyStart + r * DAY))} }`);
    let total = 0;
    for (let c = 0; c < NUMBERS; c++) {
      const value = Math.round(sheetRandom.next() * 10000) / 100;
      total += value;
      cell(`${column(2 + c)}${r}`, `{ "v": ${value} }`);
    }
    total = Math.round(total * 100) / 100;
    grand += total;
    const first = column(2);
    const last = column(1 + NUMBERS);
    cell(`${column(26)}${r}`, `{ "f": "=SUM(${first}${r}:${last}${r})", "c": ${total} }`);
    cell(`${column(27)}${r}`, `{ "f": "=AVERAGE(${first}${r}:${last}${r})", "c": ${total / NUMBERS} }`);
    cell(`${column(28)}${r}`, `{ "f": "=IF(${column(26)}${r}>1200,\\"high\\",\\"low\\")", "c": ${JSON.stringify(total > 1200 ? 'high' : 'low')} }`);
    cell(`${column(29)}${r}`, `{ "f": "=${column(26)}${r}*1.2", "c": ${total * 1.2} }`);
  }
  cell(`${column(26)}${ROWS + 2}`, `{ "f": "=SUM(${column(26)}2:${column(26)}${ROWS + 1})", "c": ${grand} }`);
  return '{\n  "type": "notesapp-sheet",\n  "version": 1,\n  "engine": "hyperformula@3.5.0",\n  "sheets": [\n' +
    '    {\n      "id": "s1",\n      "name": "Data",\n      "cells": {\n' + lines.join(',\n') + '\n      },\n' +
    '      "cols": {},\n      "rows": {\n        "1": { "bold": true }\n      },\n' +
    '      "frozen": { "rows": 1, "cols": 1 }\n    }\n  ],\n  "named": {}\n}\n';
}
files.set('Sheets/Big Sheet.sheet', bigSheet(1));

// The canvas: 1,000 cards (text and note cards) in a grid, 1,200 edges; Obsidian's layout (tabs, one per line).
{
  const nodes = [];
  const edges = [];
  const hex = (n) => n.toString(16).padStart(16, '0');
  for (let i = 0; i < 1000; i++) {
    const x = (i % 40) * 320;
    const y = Math.floor(i / 40) * 240;
    const id = hex(0x1000 + i);
    if (i % 4 === 0) {
      nodes.push({ id, type: 'file', file: notes[random.int(NOTES)].path, x, y, width: 280, height: 200 });
    } else {
      nodes.push({ id, type: 'text', text: `## ${capital(word())}\n\n${sentence()} ${linkTo(notes[random.int(NOTES)])} #${word()}`, x, y, width: 280, height: 200, ...(i % 9 === 0 ? { color: String(1 + (i % 6)) } : {}) });
    }
  }
  for (let i = 0; i < 1200; i++) {
    const a = random.int(1000);
    const b = Math.min(999, a + 1 + random.int(80));
    edges.push({ id: hex(0x100000 + i), fromNode: hex(0x1000 + a), fromSide: 'right', toNode: hex(0x1000 + b), toSide: 'left' });
  }
  files.set('Canvas/Big Canvas.canvas', '{\n\t"nodes":[\n' + nodes.map((n) => '\t\t' + JSON.stringify(n)).join(',\n') +
    '\n\t],\n\t"edges":[\n' + edges.map((e) => '\t\t' + JSON.stringify(e)).join(',\n') + '\n\t]\n}');
}

// The task list: 500 tasks, a third with due dates around now, a fifth with reminders, subtasks and sections.
{
  const now = Date.now();
  const taskRandom = rng(SEED + 7);
  const sections = [
    { id: 'sec-errands', name: 'Errands', order: 'a0' },
    { id: 'sec-work', name: 'Work', order: 'a1' },
    { id: 'sec-later', name: 'Later', order: 'a2' },
  ];
  const tasks = [];
  const localStamp = (ms) => new Date(ms).toISOString().slice(0, 16);
  for (let i = 0; i < 500; i++) {
    const created = new Date(now - (500 - i) * 3_600_000).toISOString();
    const id = ulid(now - (500 - i) * 3_600_000, taskRandom);
    const closed = taskRandom.chance(0.25);
    const task = {
      id,
      title: `${capital(words(4))}${i % 10 === 0 ? ` [[${notes[taskRandom.int(NOTES)].name}]]` : ''}`,
      status: closed ? 'done' : 'open',
      priority: taskRandom.int(4),
    };
    if (i % 3 === 0) task.due = isoDay(now + (taskRandom.int(30) - 10) * DAY);
    if (i % 5 === 0) task.reminders = [{ at: localStamp(now + (taskRandom.int(96) - 24) * 3_600_000) }];
    if (i % 25 === 0) task.recurrence = { rrule: 'FREQ=WEEKLY', from: 'due' };
    task.tags = i % 4 === 0 ? [COMMON[taskRandom.int(COMMON.length)]] : [];
    task.links = [];
    if (i % 17 === 5 && tasks.length) task.parentId = tasks[tasks.length - 1].id;
    else if (i % 6 === 0) task.sectionId = sections[i % 3].id;
    task.order = orderKey(i);
    task.createdAt = created;
    task.updatedAt = created;
    if (closed) task.completedAt = created;
    tasks.push(task);
  }
  tasks.sort((a, b) => (a.id < b.id ? -1 : 1));
  const list = { type: 'notesapp-tasks', version: 1,
    list: { id: 'perf-list-0001', name: 'Big List', order: 'a0', archived: false, sections }, tasks };
  files.set('Tasks/Big List.tasks', JSON.stringify(list, null, 2) + '\n');
}

// Attachments: PNGs (mostly small gradients, some large photo-like noise) and PDFs (1-40 pages of text).
console.log(`generating ${ATTACHMENTS} attachments...`);
images.forEach((file, i) => {
  const big = i % 25 === 0;
  files.set(file, big ? png(900, 600, random, true) : png(80 + random.int(400), 60 + random.int(300), random, false));
});
pdfs.forEach((file, i) => {
  const pageCount = i === 0 ? 300 : 1 + random.skewed(40);
  const pages = Array.from({ length: pageCount }, () => Array.from({ length: 40 }, () => words(10)));
  files.set(file, pdf(pages));
});

// ------------------------------------------------------------------ history (git fast-import)
console.log(`writing ${COMMITS} commits...`);
const final = new Map(files);
const git = (argv, options = {}) => {
  const result = spawnSync('git', argv, { cwd: vault, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`git ${argv.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
};
git(['init', '-q', '-b', 'main']);
git(['config', 'core.autocrlf', 'false']);
git(['config', 'core.quotepath', 'false']);

const importer = spawn('git', ['fast-import', '--quiet', '--done'], { cwd: vault, stdio: ['pipe', 'inherit', 'inherit'] });
const importDone = new Promise((resolve, reject) => importer.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`fast-import exited ${code}`)))));
const write = (chunk) => new Promise((resolve) => (importer.stdin.write(chunk) ? resolve() : importer.stdin.once('drain', resolve)));
let mark = 0;
const blob = async (content) => {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  mark++;
  await write(`blob\nmark :${mark}\ndata ${data.length}\n`);
  await write(data);
  await write('\n');
  return mark;
};
const AUTHORS = ['Owner <owner@notes>', 'NotesApp <notesapp@notes>', 'External <external@notes>'];
const span = Math.max(DAY, Date.now() - DAY - historyStart);
let previous = null;
async function commit(index, message, changes, author) {
  const marks = [];
  for (const change of changes) {
    marks.push(change.delete ? null : await blob(change.content));
  }
  const seconds = Math.floor((historyStart + (span * index) / COMMITS) / 1000);
  mark++;
  const commitMark = mark;
  const msg = Buffer.from(message, 'utf8');
  let header = `commit refs/heads/main\nmark :${commitMark}\nauthor ${author} ${seconds} +0000\ncommitter ${author} ${seconds} +0000\ndata ${msg.length}\n`;
  await write(header);
  await write(msg);
  await write('\n');
  if (previous) await write(`from :${previous}\n`);
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    await write(change.delete ? `D ${change.path}\n` : `M 100644 :${marks[i]} ${change.path}\n`);
  }
  await write('\n');
  previous = commitMark;
}

// Plan the edits first: every edited note's final text is its initial text plus the lines added along the way.
const historyRandom = rng(SEED + 99);
const edits = []; // per commit: [{ path, line }] or { rename: [from, to] }
const renamed = new Set();
for (let c = 1; c < COMMITS; c++) {
  if (c % 97 === 0) {
    // A rename: an area note moves to Archive under the same name, so links still resolve (git --follow input).
    let candidate;
    do {
      candidate = notes[DAILY + historyRandom.int(NOTES - DAILY)];
    } while (renamed.has(candidate.path) || candidate.path.startsWith('Archive/'));
    renamed.add(candidate.path);
    edits.push({ rename: [candidate.path, `Archive/${path.posix.basename(candidate.path)}`], note: candidate });
    continue;
  }
  const touched = new Set();
  if (c % 25 === 0) touched.add('Hub.md');
  const count = 1 + historyRandom.int(4);
  for (let k = 0; k < count; k++) touched.add(notes[historyRandom.skewed(NOTES)].path);
  edits.push({ paths: [...touched], line: `- ${isoDay(historyStart + (span * c) / COMMITS)}: ${capital(historyRandom.pick(COMMON))} ${historyRandom.pick(RARE)} update ${c}.` });
}

// The initial import, then the edits, keeping `final` current (renames applied to `notes` too).
const initial = [...files.entries()].map(([p, content]) => ({ path: p, content }));
await commit(0, `Import existing vault (${initial.length} files)`, initial, AUTHORS[1]);
let current = new Map(files);
for (let c = 0; c < edits.length; c++) {
  const edit = edits[c];
  if (edit.rename) {
    const [from, to] = edit.rename;
    const content = current.get(from);
    current.delete(from);
    current.set(to, content);
    edit.note.path = to;
    await commit(c + 1, `Rename ${path.posix.basename(from)}`, [{ path: from, delete: true }, { path: to, content }], AUTHORS[0]);
    continue;
  }
  const changes = [];
  for (const p0 of edit.paths) {
    const p = current.has(p0) ? p0 : [...renamed].includes(p0) ? `Archive/${path.posix.basename(p0)}` : p0;
    if (!current.has(p)) continue;
    const content = current.get(p).replace(/\n*$/, '\n') + edit.line + '\n';
    current.set(p, content);
    changes.push({ path: p, content });
  }
  if (changes.length === 0) changes.push({ path: 'Hub.md', content: (current.get('Hub.md') + edit.line + '\n') });
  if (changes[0].path === 'Hub.md' && !edit.paths.includes('Hub.md')) current.set('Hub.md', changes[0].content);
  await commit(c + 1, changes.length === 1 ? `Edit ${path.posix.basename(changes[0].path)}` : `Edit ${changes.length} notes`, changes, AUTHORS[historyRandom.int(3) === 0 ? 2 : 0]);
}
await write('done\n');
importer.stdin.end();
await importDone;

// The working tree is the last commit.
console.log('writing the working tree...');
for (const [p, content] of current) {
  const file = path.join(vault, ...p.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
git(['reset', '-q']);
const status = git(['status', '--porcelain']).trim();
if (status) throw new Error(`working tree differs from HEAD:\n${status.slice(0, 500)}`);

const hubSources = notes.slice(0, HUB_LINKS).map((n) => n.path);
const manifest = {
  seed: SEED,
  notes: NOTES,
  attachments: ATTACHMENTS,
  commits: Number(git(['rev-list', '--count', 'HEAD']).trim()),
  hub: 'Hub.md',
  hubSources,
  bigNote: 'Big/Big Note.md',
  sheet: 'Sheets/Big Sheet.sheet',
  canvas: 'Canvas/Big Canvas.canvas',
  tasks: 'Tasks/Big List.tasks',
  sampleNote: notes[4242 % NOTES].path,
  coldNote: notes[NOTES - 1].path,
  renamed: [...renamed].map((p) => `Archive/${path.posix.basename(p)}`),
  queries: {
    common: ['project', 'meeting notes', 'budget review', 'tag:project', '"quarterly review"'],
    // Words picked rarely (skewed() favours the start of RARE): a few dozen notes each.
    rare: [RARE[1500], `${RARE[900]} ${RARE[1200]}`, RARE[2999]],
    prefix: ['proj', RARE[3].slice(0, 4)],
    typo: ['projetc', 'meetnig'],
    property: ['[status:active]', '[rating:5] project'],
    path: ['path:"Area 07" budget', 'file:Hub'],
    regex: ['/quarter(ly)? rev/'],
    or: ['garden OR recipe', '(travel OR hotel) -flight'],
  },
  bytes: [...current.values()].reduce((sum, c) => sum + (Buffer.isBuffer(c) ? c.length : Buffer.byteLength(c)), 0),
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s: ${current.size} files, ` +
  `${(manifest.bytes / 1048576).toFixed(1)} MiB, ${manifest.commits} commits -> ${vault}`);
