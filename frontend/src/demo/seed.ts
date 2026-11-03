// The showcase vault of the GitHub Pages demo (DESIGN §6.46): a small, made-up but lived-in vault
// that puts each headline feature one click from the Welcome note. Dates are relative to the day the
// page is opened, so Today, the calendar, the habits and the daily notes always look current.
// Nothing here is personal data. The dev mock keeps its own seed (api/mock/seed.ts), which
// exercises edge cases rather than showing off.
import type { SeedFile } from '../api/mock/seed';

const MINUTE = 1;
const HOUR = 60 * MINUTE;
const DAY_MIN = 24 * HOUR;

/** `YYYY-MM-DD` of today plus `offset` days, in local time. */
export function dayOffset(offset: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- notes ----------

function welcome(): string {
  return `---
aliases: [Start here]
tags: [meta]
---
# Welcome to NotesApp

A self-hosted notes app modelled on Obsidian: your vault is a folder of plain Markdown files on your own server, and every device opens the same notes, live. This demo runs **entirely in your browser** on an in-memory copy of a small vault, so go ahead and edit, drag and delete. A reload starts over.

> [!tip] Where to look first
> - **Live Preview** — this note. There is no edit/read toggle: click anywhere and type. Markdown stays plain text on disk.
> - **Formulas in tables** — [[Trip to Lisbon]] has a table that adds itself up, like a spreadsheet.
> - **Spreadsheets** — [[Household budget.sheet]] with ~400 Google-Sheets functions and charts.
> - **Drawings** — [[System sketch.excalidraw]] (Excalidraw), embedded below.
> - **Canvas** — [[Launch plan.canvas]] (Obsidian's JSON Canvas format).
> - **Kanban** — [[Roadmap]] is an Obsidian Kanban board; task lists also show as boards.
> - **Tasks** — open *Tasks* in the left ribbon: Today, Upcoming, lists, repeating tasks.
> - **Calendar**, **Graph**, **Flashcards** and **Habits** — also in the ribbon, or \`Ctrl/Cmd+P\`.

## Try this

- [ ] Type \`[[\` to link a note, or \`/\` for the slash menu
- [ ] Press \`Ctrl/Cmd+O\` for the quick switcher and \`Ctrl/Cmd+P\` for the command palette
- [ ] Rename this note from its title: links to it everywhere follow
- [x] Open the demo

## A taste of rich Markdown

Math renders in place: $e^{i\\pi} + 1 = 0$, and diagrams are code blocks:

\`\`\`mermaid
graph LR
  P[Phone] -->|HTTPS| T(Tailscale)
  D[Desktop app] -->|HTTPS| T
  T --> S{Spring Boot}
  S -->|plain files| V[(Vault)]
  S -->|every change| G[(Git history)]
\`\`\`

![[System sketch.excalidraw|560]]

How it fits together is in [[Architecture notes]]; what is next is on the [[Roadmap]].
`;
}

function trip(): string {
  return `---
tags: [travel, planning]
date: ${dayOffset(24)}
status: booked
travellers: 3
---
Four days in Lisbon with friends. Costs are split three ways; the table works like a small spreadsheet: totals and shares update as you type, and \`=SUM(\` suggests functions.

| Item | Cost | Per person |
| --- | --- | --- |
| Flights | 420 | =B2/3 |
| Apartment (4 nights) | 560 | =B3/3 |
| Food and drinks | 300 | =B4/3 |
| Tram passes | 36 | =B5/3 |
| Museum tickets | 54 | =B6/3 |
| **Total** | =SUM(B2:B6) | =SUM(C2:C6) |

^trip
%% formats: B=currency C=currency %%

Each of us pays \`=ROUND(trip!C7, 2)\`, and the apartment is \`=ROUND(100 * trip!B3 / trip!B7)\`% of the budget.

## Packing

- [x] Passport
- [x] Charger and adapter
- [ ] Walking shoes
- [ ] Book for the flight: [[Thinking in Systems]]

## Ideas

> [!example]+ Day trips
> - Sintra: palaces and gardens, 40 minutes by train
> - Cascais: beach afternoon
> - ==Belém== for the pastries

Plans for the week are on the [[${dayOffset(0)}|daily note]]; the trip is on the calendar.
`;
}

function architecture(): string {
  return `---
tags: [engineering, notesapp]
---
NotesApp is one Docker image: a **Spring Boot** backend that serves a **React** single-page app.

## Storage

- The vault is a directory of Markdown files; there is no database.
- An in-memory index (links, tags, full-text search) is built at startup and kept current by a file watcher.
- Every change is committed to a git repository inside the vault, so any version can be restored.

## Sync

Saves carry a content hash; a stale save gets a \`409\` and the editor shows a conflict banner instead of overwriting.

\`\`\`mermaid
sequenceDiagram
  participant P as Phone
  participant S as Server
  participant D as Desktop
  P->>S: PUT /api/files (base version)
  S-->>P: 200 new version
  S-)D: SSE file.changed
  D->>S: GET /api/files
\`\`\`

## Formulas and math

Spreadsheet formulas use HyperFormula. Throughput at $n$ devices is roughly $\\sum_{k=1}^{n} \\frac{1}{k}$ of a single writer's, which is fine for one person.

See also [[Sync design]], [[System sketch.excalidraw]] and [[Distributed systems]].
`;
}

function syncDesign(): string {
  return `---
tags: [engineering]
---
The guarantees that matter, in order:

1. **Never lose a keystroke.** Drafts stay in the browser until the server confirms them.
2. **Never overwrite silently.** Versions are content hashes; conflicts are shown side by side.
3. **Feel instant.** Server-Sent Events push every change to every open tab.

\`\`\`ts
async function save(path: string, text: string, base: string) {
  const res = await api.saveFile(path, { content: text, baseVersion: base });
  return res.file.version; // the next save's base
}
\`\`\`

> [!warning] Two devices, same paragraph
> The second save gets \`409 version-conflict\`; the banner offers *Keep mine*, *Take theirs* or *Compare*.

Back to [[Architecture notes]].
`;
}

function roadmapBoard(): string {
  return `---

kanban-plugin: basic

---

## Ideas

- [ ] Share a note as a public page #publishing
- [ ] Offline maps for travel notes
- [ ] Import from Notion


## Next (3)

- [ ] Dark theme polish for charts #design
- [ ] Faster search on large vaults @{${dayOffset(9)}}
- [ ] Flashcards: cloze hints #learning


## In progress

- [ ] Desktop app auto-update #desktop
- [ ] Calendar week view drag and drop @{${dayOffset(3)}}


## Done

**Complete**
- [x] Formulas in tables
- [x] Kanban boards
- [x] Spreadsheet charts




%% kanban:settings
\`\`\`
{"kanban-plugin":"basic"}
\`\`\`
%%
`;
}

function websiteProject(): string {
  return `---
tags: [project, work]
status: in progress
due: ${dayOffset(12)}
owner: Sam
---
Goal: a faster marketing site with a new pricing page. Plan on the [[Launch plan.canvas|launch canvas]], tasks in the **Work** list.

## Milestones

| Milestone | Owner | Due | Done |
| --- | --- | --- | --- |
| Wireframes | Sam | ${dayOffset(-6)} | yes |
| Copy review | Alex | ${dayOffset(2)} | |
| Launch | Team | ${dayOffset(12)} | |

## Notes

- Kickoff notes: [[Kickoff]]
- Design review: [[Design review]]
- Risks: [[Website relaunch#Risks]]

## Risks

- Pricing copy needs legal sign-off
- Image sizes on the old CMS #performance
`;
}

function kickoff(): string {
  return `---
tags: [meeting]
date: ${dayOffset(-9)}
attendees: [Sam, Alex, Priya]
---
Project: [[Website relaunch]]

- Scope agreed: home, pricing, blog
- Alex drafts the copy; Priya owns analytics
- [ ] Share the wireframes with the team
- [x] Book the design review

Decision: launch behind a feature flag first.
`;
}

function designReview(): string {
  return `---
tags: [meeting]
date: ${dayOffset(1)}T14:00
attendees: [Sam, Priya]
---
For [[Website relaunch]]. Bring the [[System sketch.excalidraw|system sketch]].

- Hero image or illustration?
- Pricing table: monthly and yearly toggle
`;
}

function oneOnOne(): string {
  return `---
tags: [meeting]
date: ${dayOffset(8)}T10:30
---
Quarter planning: review the [[Roadmap]] and the budget in [[Household budget.sheet]]. Prep in [[Weekly review]].
`;
}

function weeklyReview(): string {
  return `---
tags: [routine]
---
A checklist I run every Friday.

- [ ] Empty the inbox (tasks and notes)
- [ ] Look at the calendar for the next two weeks
- [ ] Review the [[Roadmap]]
- [ ] Update [[Household budget.sheet]]
- [ ] Pick three priorities

Books in progress:

\`\`\`dataview
TABLE author, rating, status
FROM #book
SORT rating DESC
\`\`\`
`;
}

function book(author: string, rating: number, status: string, body: string): string {
  return `---
tags: [book]
author: ${author}
rating: ${rating}
status: ${status}
---
${body}
`;
}

function spanish(): string {
  return `---
tags: [flashcards/spanish, learning]
---
Cards for the [[Trip to Lisbon]] (close enough). One card per line: \`front::back\`, or \`:::\` for both directions.

hola::hello
gracias::thank you
la cuenta, por favor::the bill, please
¿Dónde está la estación?::Where is the station?
el desayuno:::breakfast
mañana:::tomorrow
`;
}

function distributedSystems(): string {
  return `---
tags: [flashcards/engineering, learning]
---
Notes and flashcards from reading about replication. See [[Sync design]].

What does the CAP theorem say?
?
Under a network partition, a system must choose between consistency and availability.

A ==vector clock== tracks causality between events on different nodes.

Last-writer-wins::Conflict resolution that keeps the write with the latest timestamp, losing the other.
Idempotency key::A client-chosen id that makes a retried request safe to apply twice.
`;
}

function habitNote(title: string, color: string, schedule: string, property: string, entries: string[], created: string): string {
  return `---
title: ${title}
color: "${color}"
schedule: ${schedule}
property: ${property}
created: ${created}
entries:
${entries.map((e) => `  - ${e}`).join('\n')}
---
Checked in from the habits page or from a daily note with \`${property}: true\`.
`;
}

const PROJECT_IDEAS = `---
tags: [idea]
---
- A reading tracker built from [[Weekly review]] queries
- Turn [[Distributed systems]] cards into a talk
- Photo journal for the [[Trip to Lisbon]]
`;

const DAILY_TEMPLATE = `---
tags: [daily]
---
## Plan

-

## Log

- {{time}}
`;

const MEETING_TEMPLATE = `---
tags: [meeting]
date: "{{date}}"
---

- Attendees: {{prompt:Who is attending?}}
- Notes: {{cursor}}
`;

const HABITS = ['exercise', 'read', 'meditate'] as const;

/** Which habits were done `i` days ago (0 = today): an irregular but believable record. Today has two left to tap. */
function habitsDone(i: number): Record<(typeof HABITS)[number], boolean> {
  if (i === 0) return { exercise: true, read: false, meditate: false };
  return { exercise: i % 7 !== 3 && i % 7 !== 5 && i % 11 !== 4, read: i % 3 !== 2 && i % 13 !== 7, meditate: i % 2 === 0 || i % 5 === 1 };
}

function daily(offset: number): SeedFile {
  const name = dayOffset(offset);
  const i = -offset;
  const done = habitsDone(i);
  const props = HABITS.filter((h) => done[h]).map((h) => `${h}: true`);
  const plans = [
    `- Worked on the [[Website relaunch]]; copy is nearly done\n- Reviewed [[Sync design]] notes`,
    `- Budget check in [[Household budget.sheet]]\n- 30 min of [[Spanish]] cards`,
    `- Read a chapter of [[Thinking in Systems]]\n- Sketched ideas in [[Ideas]]`,
    `- Meeting prep for [[Design review]]\n- Moved two cards on the [[Roadmap]]`,
  ];
  const body =
    offset === 0
      ? `## Plan\n\n- [ ] Finish the pricing copy for [[Website relaunch]]\n- [ ] Review flashcards\n- [x] Morning run\n\n## Log\n\n- 08:10 Coffee and the [[Weekly review]] list\n- 09:30 Booked the [[Trip to Lisbon]] apartment\n`
      : `## Log\n\n${plans[i % plans.length]}\n`;
  return {
    path: `Daily/${name}.md`,
    content: `---\n${props.join('\n')}${props.length ? '\n' : ''}tags: [daily]\n---\n${body}`,
    age: i * DAY_MIN + 60,
  };
}

// ---------- tasks ----------

interface SeedTask {
  id: string;
  title: string;
  status?: 'open' | 'done';
  priority?: 0 | 1 | 2 | 3;
  due?: string;
  start?: string;
  recurrence?: { rrule: string; from: 'due' | 'completion' };
  tags?: string[];
  links?: string[];
  sectionId?: string;
  parentId?: string;
  notes?: string;
  order: string;
  completedAt?: string;
}

function taskFile(list: { id: string; name: string; color?: string; icon?: string; order: string; sections?: Array<{ id: string; name: string; order: string }> }, tasks: SeedTask[]): string {
  const created = new Date(Date.now() - 14 * 86_400_000).toISOString();
  return (
    JSON.stringify(
      {
        type: 'notesapp-tasks',
        version: 1,
        list: { ...list, archived: false, sections: list.sections ?? [] },
        tasks: tasks
          .map((t) => ({
            id: t.id,
            title: t.title,
            ...(t.notes ? { notes: t.notes } : {}),
            status: t.status ?? 'open',
            ...(t.priority ? { priority: t.priority } : {}),
            ...(t.due ? { due: t.due } : {}),
            ...(t.start ? { start: t.start } : {}),
            ...(t.recurrence ? { recurrence: t.recurrence } : {}),
            tags: t.tags ?? [],
            links: t.links ?? [],
            ...(t.sectionId ? { sectionId: t.sectionId } : {}),
            ...(t.parentId ? { parentId: t.parentId } : {}),
            order: t.order,
            createdAt: created,
            updatedAt: created,
            ...(t.status === 'done' ? { completedAt: t.completedAt ?? new Date(Date.now() - 86_400_000).toISOString() } : {}),
          }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
      },
      null,
      2,
    ) + '\n'
  );
}

function taskFiles(): SeedFile[] {
  const work = taskFile(
    {
      id: '01DEMOLIST0000000000WORK00',
      name: 'Work',
      color: '#8a5cf5',
      icon: 'briefcase',
      order: 'a1',
      sections: [
        { id: 'sec-todo', name: 'To do', order: 'a0' },
        { id: 'sec-doing', name: 'Doing', order: 'a1' },
        { id: 'sec-review', name: 'Review', order: 'a2' },
      ],
    },
    [
      { id: '01DEMOTASK00000000000W0001', title: 'Finish the pricing copy [[Website relaunch]]', priority: 3, due: dayOffset(0), tags: ['writing'], sectionId: 'sec-doing', order: 'a0' },
      { id: '01DEMOTASK00000000000W0002', title: 'Send wireframes to the team', priority: 2, due: dayOffset(-1), sectionId: 'sec-todo', order: 'a0', links: ['Meetings/Kickoff.md'] },
      { id: '01DEMOTASK00000000000W0003', title: 'Prepare the design review deck', priority: 2, due: `${dayOffset(1)}T13:00`, sectionId: 'sec-todo', order: 'a1' },
      { id: '01DEMOTASK00000000000W0004', title: 'Image audit on the old CMS #performance', priority: 1, due: dayOffset(4), sectionId: 'sec-todo', order: 'a2' },
      { id: '01DEMOTASK00000000000W0005', title: 'Analytics events plan', due: dayOffset(6), sectionId: 'sec-review', order: 'a0' },
      { id: '01DEMOTASK00000000000W0006', title: 'Draft hero section', parentId: '01DEMOTASK00000000000W0001', order: 'a0', status: 'done' },
      { id: '01DEMOTASK00000000000W0007', title: 'Pricing table copy', parentId: '01DEMOTASK00000000000W0001', order: 'a1' },
      { id: '01DEMOTASK00000000000W0008', title: 'FAQ answers', parentId: '01DEMOTASK00000000000W0001', order: 'a2' },
      { id: '01DEMOTASK00000000000W0009', title: 'Weekly status update', due: dayOffset(((5 - new Date().getDay() + 7) % 7) || 7), recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=FR', from: 'due' }, sectionId: 'sec-todo', order: 'a3' },
      { id: '01DEMOTASK00000000000W0010', title: 'Set up the feature flag', sectionId: 'sec-review', order: 'a1', status: 'done' },
    ],
  );
  const home = taskFile(
    {
      id: '01DEMOLIST0000000000HOME00',
      name: 'Home',
      color: '#2f9e44',
      icon: 'house',
      order: 'a2',
      sections: [
        { id: 'sec-errands', name: 'Errands', order: 'a0' },
        { id: 'sec-house', name: 'House', order: 'a1' },
      ],
    },
    [
      { id: '01DEMOTASK00000000000H0001', title: 'Pay rent', priority: 3, due: dayOffset(3), recurrence: { rrule: 'FREQ=MONTHLY', from: 'due' }, tags: ['bills'], sectionId: 'sec-house', order: 'a0' },
      { id: '01DEMOTASK00000000000H0002', title: 'Water the plants', due: dayOffset(0), recurrence: { rrule: 'FREQ=DAILY;INTERVAL=3', from: 'completion' }, sectionId: 'sec-house', order: 'a1' },
      { id: '01DEMOTASK00000000000H0003', title: 'Pick up the dry cleaning', due: dayOffset(-2), priority: 1, sectionId: 'sec-errands', order: 'a0' },
      { id: '01DEMOTASK00000000000H0004', title: 'Buy a travel adapter for [[Trip to Lisbon]]', due: dayOffset(5), tags: ['travel'], sectionId: 'sec-errands', order: 'a1' },
      { id: '01DEMOTASK00000000000H0005', title: 'Book a dentist appointment', start: dayOffset(0), sectionId: 'sec-errands', order: 'a2' },
      { id: '01DEMOTASK00000000000H0006', title: 'Fix the squeaky door', sectionId: 'sec-house', order: 'a2', status: 'done' },
    ],
  );
  const inbox = taskFile({ id: '01DEMOLIST000000000INBOX00', name: 'Inbox', icon: 'inbox', order: 'a0' }, [
    { id: '01DEMOTASK00000000000I0001', title: 'Try quick add: Ctrl/Cmd+Alt+T, then "Call Alex tomorrow 9am !high"', due: dayOffset(0), order: 'a0' },
    { id: '01DEMOTASK00000000000I0002', title: 'Read about vector clocks #learning', due: dayOffset(2), links: ['Learning/Distributed systems.md'], order: 'a1' },
    { id: '01DEMOTASK00000000000I0003', title: 'Renew the library card', due: dayOffset(10), order: 'a2' },
  ]);
  return [
    { path: 'Tasks/Inbox.tasks', content: inbox, age: 2 * HOUR },
    { path: 'Tasks/Work.tasks', content: work, age: 30 * MINUTE },
    { path: 'Tasks/Home.tasks', content: home, age: 5 * HOUR },
  ];
}

// ---------- spreadsheet ----------

type Cell = { v?: string | number; f?: string; c?: string | number };

function budgetSheet(): string {
  // Months down, categories across, so the line chart shows each category over the half year.
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const categories: Array<[string, number[]]> = [
    ['Groceries', [412, 386, 431, 398, 445, 420]],
    ['Utilities', [182, 175, 160, 131, 118, 104]],
    ['Transport', [96, 96, 120, 96, 88, 96]],
    ['Eating out', [140, 95, 180, 120, 210, 165]],
    ['Rent', [1450, 1450, 1450, 1450, 1450, 1450]],
    ['Savings', [600, 650, 600, 700, 650, 700]],
  ];
  const cols = 'BCDEFG';
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const cells: Record<string, Cell> = { A1: { v: 'Month' }, H1: { v: 'Total' }, A8: { v: 'Total' }, A9: { v: 'Average' } };
  categories.forEach(([name, values], c) => {
    const col = cols[c];
    cells[`${col}1`] = { v: name };
    values.forEach((v, m) => (cells[`${col}${m + 2}`] = { v }));
    cells[`${col}8`] = { f: `=SUM(${col}2:${col}7)`, c: sum(values) };
    cells[`${col}9`] = { f: `=AVERAGE(${col}2:${col}7)`, c: sum(values) / values.length };
  });
  const monthTotals = months.map((_, m) => sum(categories.map(([, v]) => v[m])));
  months.forEach((month, m) => {
    cells[`A${m + 2}`] = { v: month };
    cells[`H${m + 2}`] = { f: `=SUM(B${m + 2}:G${m + 2})`, c: monthTotals[m] };
  });
  const grand = sum(monthTotals);
  cells.H8 = { f: '=SUM(H2:H7)', c: grand };
  cells.H9 = { f: '=AVERAGE(H2:H7)', c: grand / months.length };

  const summary: Record<string, Cell> = { A1: { v: 'Category' }, B1: { v: 'Six months' }, C1: { v: 'Share' } };
  categories.forEach(([name, values], c) => {
    const row = c + 2;
    summary[`A${row}`] = { f: `=Budget!${cols[c]}1`, c: name };
    summary[`B${row}`] = { f: `=Budget!${cols[c]}8`, c: sum(values) };
    summary[`C${row}`] = { f: `=B${row}/Budget!$H$8`, c: sum(values) / grand };
  });
  summary.A9 = { v: 'Savings rate' };
  summary.C9 = { f: '=Budget!G8/Budget!H8', c: sum(categories[5][1]) / grand };

  const ordered = (c: Record<string, Cell>) =>
    Object.fromEntries(
      Object.entries(c).sort(([a], [b]) => {
        const [, ca, ra] = /^([A-Z]+)(\d+)$/.exec(a)!;
        const [, cb, rb] = /^([A-Z]+)(\d+)$/.exec(b)!;
        return Number(ra) - Number(rb) || ca.localeCompare(cb);
      }),
    );
  const file = {
    type: 'notesapp-sheet',
    version: 1,
    engine: 'hyperformula@3.5.0',
    sheets: [
      {
        id: 's1',
        name: 'Budget',
        cells: ordered(cells),
        cols: { A: { w: 90 }, B: { fmt: '$#,##0' }, C: { fmt: '$#,##0' }, D: { fmt: '$#,##0' }, E: { fmt: '$#,##0' }, F: { fmt: '$#,##0' }, G: { fmt: '$#,##0' }, H: { fmt: '$#,##0', bold: true } },
        rows: { '1': { bold: true }, '8': { bold: true }, '9': { bold: true } },
        frozen: { rows: 1, cols: 1 },
        charts: { c1: { type: 'line', range: 'A1:E7', title: 'Everyday spending', headers: true, labels: true } },
      },
      {
        id: 's2',
        name: 'Summary',
        cells: ordered(summary),
        cols: { A: { w: 130, bold: true }, B: { fmt: '$#,##0', w: 110 }, C: { fmt: '0.0%' } },
        rows: { '1': { bold: true }, '9': { bold: true } },
        frozen: { rows: 1, cols: 0 },
        charts: { c1: { type: 'pie', range: 'A1:B7', title: 'Where the money goes', headers: true, labels: true } },
      },
    ],
    named: {},
  };
  return JSON.stringify(file, null, 2) + '\n';
}

const BUDGET_NOTE = `---
tags: [finance]
---
The numbers live in [[Household budget.sheet]]; this note embeds its summary, which updates when the sheet changes.

![[Household budget.sheet#Summary]]

Notes:

- Utilities fall every month since the heat pump went in
- Savings target: 20% of spending
`;

// ---------- drawing ----------

let seedCounter = 1;

function base(type: string, id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) {
  seedCounter++;
  return {
    id,
    type,
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === 'rectangle' ? { type: 3 } : type === 'arrow' ? { type: 2 } : null,
    seed: 1000 + seedCounter * 7919,
    version: 1,
    versionNonce: 2000 + seedCounter * 104729,
    isDeleted: false,
    boundElements: [],
    updated: 1730000000000,
    link: null,
    locked: false,
    ...extra,
  };
}

function label(id: string, text: string, cx: number, cy: number, size = 20, color = '#1e1e1e') {
  const lines = text.split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.56;
  const h = lines.length * size * 1.25;
  return base('text', id, cx - w / 2, cy - h / 2, w, h, {
    strokeColor: color,
    text,
    originalText: text,
    fontSize: size,
    fontFamily: 5,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    roundness: null,
  });
}

function box(id: string, text: string, x: number, y: number, w: number, h: number, fill: string) {
  return [base('rectangle', id, x, y, w, h, { backgroundColor: fill }), label(`${id}-t`, text, x + w / 2, y + h / 2)];
}

/** An arrow from (x1, y1) to (x2, y2), with an optional label offset from its middle by (dx, dy). */
function arrow(id: string, x1: number, y1: number, x2: number, y2: number, text?: string, dx = 0, dy = -16) {
  const out: object[] = [
    base('arrow', id, x1, y1, x2 - x1, y2 - y1, {
      points: [
        [0, 0],
        [x2 - x1, y2 - y1],
      ],
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: 'arrow',
      elbowed: false,
    }),
  ];
  if (text) out.push(label(`${id}-t`, text, (x1 + x2) / 2 + dx, (y1 + y2) / 2 + dy, 14, '#495057'));
  return out;
}

function systemSketch(): string {
  seedCounter = 1;
  const elements = [
    label('title', 'NotesApp, end to end', 445, 10, 28),
    ...box('phone', 'iPhone\n(PWA)', 0, 70, 150, 80, '#d0bfff'),
    ...box('pc', 'Windows\ndesktop app', 0, 220, 150, 80, '#d0bfff'),
    ...box('ts', 'Tailscale\nHTTPS', 215, 145, 140, 80, '#a5d8ff'),
    ...box('app', 'Spring Boot\n+ React SPA', 475, 145, 165, 80, '#b2f2bb'),
    ...box('vault', 'Vault\n(.md files)', 745, 70, 145, 80, '#ffec99'),
    ...box('git', 'Git history\n(JGit)', 745, 220, 145, 80, '#ffd8a8'),
    ...arrow('a1', 150, 110, 215, 170),
    ...arrow('a2', 150, 260, 215, 200),
    ...arrow('a3', 355, 185, 475, 185, 'tailnet only'),
    ...arrow('a4', 640, 165, 745, 110, 'atomic writes', -22, -32),
    ...arrow('a5', 640, 205, 745, 260, 'every change', -22, 32),
    base('ellipse', 'sse', 487, 300, 140, 60, { backgroundColor: '#fff5f5', strokeStyle: 'dashed' }),
    label('sse-t', 'live sync\n(SSE)', 557, 330, 16),
    ...arrow('a6', 490, 322, 150, 285),
  ];
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'https://github.com/rjgehan/notesapp',
      elements,
      appState: { gridSize: 20, gridStep: 5, gridModeEnabled: false, viewBackgroundColor: '#ffffff' },
      files: {},
    },
    null,
    2,
  );
}

// ---------- canvas ----------

function launchCanvas(): string {
  const nodes = [
    { id: 'c0ffee0000000001', type: 'group', x: -500, y: -320, width: 1300, height: 700, color: '5', label: 'Website relaunch' },
    { id: 'c0ffee0000000002', type: 'text', text: '# Goal\n\nA faster site and a clearer **pricing page**, live in two weeks.\n\n- [x] Wireframes\n- [ ] Copy\n- [ ] Launch', x: -460, y: -260, width: 340, height: 300, color: '4' },
    { id: 'c0ffee0000000003', type: 'file', file: 'Projects/Website relaunch.md', x: -60, y: -260, width: 400, height: 420 },
    { id: 'c0ffee0000000004', type: 'file', file: 'Projects/Sync design.md', x: 400, y: -260, width: 360, height: 220 },
    { id: 'c0ffee0000000005', type: 'text', text: '## Risks\n1. Legal sign-off\n2. ==Image sizes==', x: -460, y: 90, width: 340, height: 180, color: '1' },
    { id: 'c0ffee0000000006', type: 'file', file: 'Meetings/Kickoff.md', x: 400, y: 0, width: 360, height: 300 },
    { id: 'c0ffee0000000007', type: 'link', url: 'https://jsoncanvas.org', x: -60, y: 210, width: 400, height: 120, color: '6' },
  ];
  const edges = [
    { id: 'e0ffee0000000001', fromNode: 'c0ffee0000000002', fromSide: 'right', toNode: 'c0ffee0000000003', toSide: 'left', label: 'details' },
    { id: 'e0ffee0000000002', fromNode: 'c0ffee0000000003', fromSide: 'right', toNode: 'c0ffee0000000004', toSide: 'left', color: '4' },
    { id: 'e0ffee0000000003', fromNode: 'c0ffee0000000005', fromSide: 'top', toNode: 'c0ffee0000000002', toSide: 'bottom' },
    { id: 'e0ffee0000000004', fromNode: 'c0ffee0000000003', fromSide: 'right', toNode: 'c0ffee0000000006', toSide: 'left', label: 'decisions' },
  ];
  return JSON.stringify({ nodes, edges }, null, '\t');
}

// ---------- the vault ----------

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">
  <rect width="64" height="64" rx="14" fill="#1e1e1e"/>
  <path d="M20 14h18l10 10v26a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" fill="#8a5cf5"/>
  <path d="M38 14v8a2 2 0 0 0 2 2h8z" fill="#b9a2fb"/>
  <path d="M23 33h18M23 40h18M23 47h11" stroke="#1e1e1e" stroke-width="3.2" stroke-linecap="round"/>
</svg>
`;

export function demoSeedFiles(): SeedFile[] {
  const habitDays = (habit: (typeof HABITS)[number]) =>
    Array.from({ length: 120 }, (_, i) => i)
      .filter((i) => habitsDone(i)[habit])
      .map((i) => dayOffset(-i))
      .reverse();
  const created = dayOffset(-120);
  return [
    { path: 'Welcome.md', content: welcome(), age: 1 },
    { path: 'Trip to Lisbon.md', content: trip(), age: 20 * MINUTE },
    { path: 'Projects/Website relaunch.md', content: websiteProject(), age: 3 * HOUR },
    { path: 'Projects/Roadmap.md', content: roadmapBoard(), age: 6 * HOUR },
    { path: 'Projects/Launch plan.canvas', content: launchCanvas(), age: 7 * HOUR },
    { path: 'Projects/Architecture notes.md', content: architecture(), age: 2 * DAY_MIN },
    { path: 'Projects/Sync design.md', content: syncDesign(), age: 3 * DAY_MIN },
    { path: 'Meetings/Kickoff.md', content: kickoff(), age: 9 * DAY_MIN },
    { path: 'Meetings/Design review.md', content: designReview(), age: 1 * DAY_MIN },
    { path: 'Meetings/Planning session.md', content: oneOnOne(), age: 2 * DAY_MIN },
    { path: 'Finances/Household budget.sheet', content: budgetSheet(), age: 4 * HOUR },
    { path: 'Finances/Budget overview.md', content: BUDGET_NOTE, age: 4 * HOUR },
    { path: 'Drawings/System sketch.excalidraw', content: systemSketch(), age: 26 * HOUR },
    { path: 'Learning/Spanish.md', content: spanish(), age: 5 * DAY_MIN },
    { path: 'Learning/Distributed systems.md', content: distributedSystems(), age: 6 * DAY_MIN },
    { path: 'Reading/Thinking in Systems.md', content: book('Donella Meadows', 5, 'reading', 'Stocks, flows and feedback loops. Pairs well with [[Distributed systems]].'), age: 8 * DAY_MIN },
    { path: 'Reading/The Pragmatic Programmer.md', content: book('Hunt and Thomas', 4, 'done', 'Tracer bullets, DRY, and *care about your craft*.'), age: 20 * DAY_MIN },
    { path: 'Reading/Designing Data-Intensive Applications.md', content: book('Martin Kleppmann', 5, 'next', 'Replication and consensus chapters for [[Sync design]].'), age: 12 * DAY_MIN },
    { path: 'Routines/Weekly review.md', content: weeklyReview(), age: 2 * DAY_MIN },
    { path: 'Ideas/Ideas.md', content: PROJECT_IDEAS, age: 4 * DAY_MIN },
    { path: 'Habits/Exercise.md', content: habitNote('Exercise', '#2f9e44', 'daily', 'exercise', habitDays('exercise'), created), age: 1 * DAY_MIN },
    { path: 'Habits/Read.md', content: habitNote('Read', '#1c7ed6', 'daily', 'read', habitDays('read'), created), age: 1 * DAY_MIN },
    { path: 'Habits/Meditate.md', content: habitNote('Meditate', '#ae3ec9', 'weekdays', 'meditate', habitDays('meditate'), created), age: 1 * DAY_MIN },
    { path: 'Templates/Daily note.md', content: DAILY_TEMPLATE, age: 30 * DAY_MIN },
    { path: 'Templates/Meeting.md', content: MEETING_TEMPLATE, age: 30 * DAY_MIN },
    { path: 'Attachments/notesapp-logo.svg', content: LOGO_SVG, age: 30 * DAY_MIN },
    ...taskFiles(),
    ...Array.from({ length: 21 }, (_, i) => daily(-i)),
  ];
}
