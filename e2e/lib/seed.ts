/**
 * A vault that looks lived in, made through the API as a person's devices would make it: notes
 * with links, tags, properties and tables with formulas; a spreadsheet, a drawing and a canvas; task
 * lists with sections, subtasks, reminders and repeats; a Kanban board; a PDF and an image; daily
 * notes, templates, flashcards and habits; bookmarks, history and something in the trash; and a
 * second vault. Dates are relative to today, so Today, Upcoming and the calendar always have
 * something on them.
 *
 * Used by `npm run seed` and by the screen inventory. Not by the tests: every test makes its own.
 */
import { pdf, png } from './fixtures.ts';
import { ApiError, TZ, call, commitNow, createFile, day, editFile, newList, newSection, newTask, readFile, trashFile, uploadRaw } from './api.ts';

export const SEED_MARKER = 'Projects/Home renovation.md';
export const SECOND_VAULT = 'work';

export async function isSeeded(): Promise<boolean> {
  try {
    await readFile(SEED_MARKER);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return false;
    throw e;
  }
}

const note = (path: string, content: string, vault?: string) => createFile(path, content, { vault });

function sheetFile() {
  // Cached results (`c`) are what an engine run would write, so embeds and search show them
  // before the grid ever opens.
  const cell = (v: unknown) => JSON.stringify(v);
  const rows: [string, unknown][] = [
    ['A1', { v: 'Item' }], ['B1', { v: 'Cost' }], ['C1', { v: 'Paid' }],
    ['A2', { v: 'Cabinets' }], ['B2', { v: 2700 }], ['C2', { v: true }],
    ['A3', { v: 'Worktop' }], ['B3', { v: 1200 }], ['C3', { v: false }],
    ['A4', { v: 'Tiles' }], ['B4', { v: 1400 }], ['C4', { v: false }],
    ['A5', { v: 'Electrician' }], ['B5', { v: 950 }], ['C5', { v: true }],
    ['A6', { v: 'Total' }], ['B6', { f: '=SUM(B2:B5)', c: 6250 }],
    ['A8', { v: 'Still to pay' }], ['B8', { f: '=SUMIF(C2:C5,FALSE,B2:B5)', c: 2600 }],
    ['A9', { v: 'Share paid' }], ['B9', { f: '=1-B8/B6', c: 0.584, fmt: '0.0%' }],
  ];
  return [
    '{',
    '  "type": "notesapp-sheet",',
    '  "version": 1,',
    '  "engine": "hyperformula@3.5.0",',
    '  "sheets": [',
    '    {',
    '      "id": "s1",',
    '      "name": "Budget",',
    '      "cells": {',
    rows.map(([k, v]) => `        "${k}": ${cell(v)}`).join(',\n'),
    '      },',
    '      "cols": {',
    '        "A": { "w": 160 },',
    '        "B": { "w": 110, "fmt": "$#,##0.00" }',
    '      },',
    '      "rows": {',
    '        "1": { "bold": true }',
    '      },',
    '      "frozen": { "rows": 1, "cols": 0 },',
    '      "charts": {',
    '        "c0mgv1a2b3x7f2": { "type": "bar", "range": "A1:B5", "title": "Costs", "headers": true, "labels": true }',
    '      }',
    '    }',
    '  ],',
    '  "named": {',
    '    "Total": "Budget!$B$6"',
    '  }',
    '}',
    '',
  ].join('\n');
}

function drawingFile() {
  let seed = 1;
  const base = (id: string, type: string, x: number, y: number, width: number, height: number) => ({
    id, type, x, y, width, height, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null,
    roundness: type === 'rectangle' ? { type: 3 } : null, seed: seed++, version: 1, versionNonce: seed * 7, isDeleted: false,
    boundElements: null, updated: 1761900000000, link: null, locked: false,
  });
  const text = (id: string, x: number, y: number, t: string, extra = {}) => ({
    ...base(id, 'text', x, y, t.length * 11, 25), text: t, originalText: t, fontSize: 20, fontFamily: 5,
    textAlign: 'left', verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: 1.25, ...extra,
  });
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'notesapp-e2e',
    elements: [
      { ...base('kitchen', 'rectangle', 40, 40, 320, 200), backgroundColor: '#ffec99' },
      text('kitchen-label', 60, 60, 'Kitchen: new cabinets'),
      { ...base('hall', 'rectangle', 400, 40, 180, 300), backgroundColor: '#a5d8ff' },
      text('hall-label', 420, 60, 'Hall'),
      text('link', 60, 280, 'Plan: [[Home renovation]]'),
    ],
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  }, null, 2) + '\n';
}

function canvasFile() {
  return JSON.stringify({
    nodes: [
      { id: 'n1', type: 'text', text: '# Garden plan\nVegetables along the south fence, herbs by the door. #project/garden', x: 0, y: 0, width: 320, height: 160 },
      { id: 'n2', type: 'file', file: 'Projects/Garden.md', x: 420, y: -40, width: 360, height: 260 },
      { id: 'n3', type: 'text', text: 'Ask about the shed in [[Weekly sync]]', x: 0, y: 220, width: 320, height: 90, color: '4' },
      { id: 'n4', type: 'link', url: 'https://example.com/raised-beds', x: 420, y: 260, width: 360, height: 120 },
      { id: 'g1', type: 'group', label: 'Spring', x: -40, y: -60, width: 400, height: 400 },
    ],
    edges: [
      { id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left', label: 'details' },
      { id: 'e2', fromNode: 'n3', fromSide: 'right', toNode: 'n4', toSide: 'left' },
    ],
  }, null, 2) + '\n';
}

async function waitForVault(name: string) {
  for (let i = 0; i < 120; i++) {
    const { vaults } = await call('GET', '/api/vaults');
    const v = vaults.find((x: any) => x.name === name);
    if (v?.state === 'ready') return;
    if (v?.state === 'failed') throw new Error(`Vault ${name} failed to start; see .run/backend.log`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Vault ${name} did not become ready`);
}

/** Fills an empty vault. Returns what it made, for the screen inventory to open. */
export async function seedVault(log: (s: string) => void = () => {}) {
  const today = day(0);
  const d = (n: number) => day(n);

  log('Attachments');
  await uploadRaw('Attachments/Paint swatch.png', png(), 'image/png');
  await uploadRaw('Attachments/Cabinet spec.pdf', pdf('Cabinet specification', [
    'Kitchen cabinets: six base units, 60 cm wide, oak veneer.',
    'Worktop: 38 mm laminate, 3 m, cut for the sink.',
    'Delivery in the first week of the month; installer to confirm.',
  ]), 'application/pdf');

  log('Notes');
  await note('Projects/Home renovation.md', `---
status: active
due: ${d(20)}
budget: 18500
priority: 2
approved: false
owner: Alex
tags:
  - project/home
aliases:
  - Renovation
---
# Home renovation

The kitchen and the hall, before the winter. Costs live in [[Budget.sheet]]; the layout is in [[Floor plan.excalidraw]], and the cabinets are specified in [[Cabinet spec.pdf]].

## Costs

| Item | Cost | Qty | Total |
| --- | --- | --- | --- |
| Cabinets | 450 | 6 | =B2*C2 |
| Worktop | 1200 | 1 | =B3*C3 |
| Tiles | 35 | 40 | =B4*C4 |
| Total | | | =SUM(D2:D4) |

^costs
%% formats: B=currency D=currency %%

Spread over a year that is \`=costs!D5/12\` a month.

## Next steps

- [ ] Call the plumber about the sink
- [x] Measure the hall
- [ ] Order tiles #shopping

> [!tip] Before ordering
> Check the tile count against the floor plan.

See also [[Garden]] and the board [[Renovation board]].

![[Budget.sheet#Budget!A1:C6]]
`);

  await note('Projects/Garden.md', `---
date: ${d(3)}
status: planning
tags: [project/garden]
---
# Garden

Raised beds along the south fence. Part of the same budget as [[Home renovation#Costs|the renovation]].

![[Paint swatch.png|240]]

| Bed | Width (m) | Length (m) | Area |
| --- | --- | --- | --- |
| Herbs | 0.8 | 2 | =B2*C2 |
| Vegetables | 1.2 | 4 | =B3*C3 |
| All | | | =SUM(D2:D3) |

- [ ] Order soil #shopping
- [ ] Sketch the beds in [[Garden plan.canvas]]

The slope is about $\\frac{1}{20}$, fine for drainage.[^1]

[^1]: Measured with a spirit level in October.
`);

  await note('Reading/Dune.md', `---
author: Frank Herbert
rating: 5
status: read
finished: ${d(-12)}
tags: [book, sci-fi]
---
# Dune

> I must not fear. Fear is the mind-killer.

The ecology of Arrakis is the real protagonist: ==water as currency==.

Compare with [[Project Hail Mary]].
`);
  await note('Reading/Project Hail Mary.md', `---
author: Andy Weir
rating: 4
status: reading
tags: [book, sci-fi]
---
# Project Hail Mary

Rocky is the best character. Picked it up after [[Dune]].
`);
  await note('Reading/Reading list.md', `# Reading list

\`\`\`dataview
TABLE author, rating, status
FROM #book
SORT rating DESC
\`\`\`

Ideas: #to-read *The Left Hand of Darkness*, *Piranesi*.
`);

  await note(`Meetings/${d(-5)} Weekly sync.md`, `---
date: ${d(-5)}
attendees: [Alex, Sam]
tags: [meeting]
aliases: [Weekly sync]
---
# Weekly sync

- Renovation: cabinets ordered, see [[Home renovation]].
- Garden: soil delivery next week ([[Garden]]).
- [ ] Sam to send the electrician's quote
`);

  log('Daily notes, templates, flashcards, habits');
  for (const [offset, props, text] of [
    [0, 'exercise: true\nmood: 4', `Started on the hall. Called about [[Home renovation]] tiles. #journal`],
    [-1, 'exercise: false\nreading: true\nmood: 3', 'Read two chapters of [[Project Hail Mary]].'],
    [-2, 'exercise: true\nreading: true', 'Long walk. Garden centre for prices ([[Garden]]).'],
    [-3, 'exercise: true', 'Weekly sync prep.'],
  ] as const) {
    await note(`Daily/${d(offset)}.md`, `---\n${props}\n---\n# ${d(offset)}\n\n${text}\n`);
  }
  await note('Templates/Meeting.md', `---
date: "{{date}}"
tags: [meeting]
---
# {{title}}

## Attendees

## Notes
{{cursor}}

## Actions
- [ ]
`);
  await note('Templates/Book.md', `---
author:
rating:
status: to-read
tags: [book]
---
# {{title}}
`);
  await note('Cards/Spanish.md', `---
tags: [flashcards/spanish]
---
# Spanish

Hola::Hello
Gato:::Cat
Gracias::Thank you

¿Dónde está la biblioteca?
?
Where is the library?

The capital of Spain is ==Madrid==.
`);
  await note('Cards/Biology.md', `#flashcards/science

The [...] is the powerhouse of the cell::mitochondrion
Photosynthesis happens in the ==chloroplast==.
`);
  const entries = [-6, -5, -4, -2, -1].map((n) => `  - ${d(n)}`).join('\n');
  await note('Habits/Exercise.md', `---
title: Exercise
color: "#4CAF50"
schedule: daily
property: exercise
maxGap: 1
created: ${d(-30)}
entries:
${entries}
---
At least 20 minutes, a walk counts.
`);
  await note('Habits/Reading.md', `---
title: Reading
schedule: 3/week
property: reading
created: ${d(-30)}
entries:
  - ${d(-8)}
  - ${d(-4)}
---
`);

  log('Kanban board, spreadsheet, drawing, canvas');
  await note('Boards/Renovation board.md', `---

kanban-plugin: board

---

## To do

- [ ] Choose tiles @{${d(2)}}
- [ ] Book the electrician
- [ ] Paint the hall #paint


## Doing

- [ ] Measure the kitchen [[Home renovation]]


## Done

**Complete**
- [x] Clear the hall




%% kanban:settings
\`\`\`
{"kanban-plugin":"board","list-collapse":[false,false,false]}
\`\`\`
%%
`);
  await note('Budget.sheet', sheetFile());
  await note('Floor plan.excalidraw', drawingFile());
  await note('Garden plan.canvas', canvasFile());

  log('Tasks');
  const home = await newList('Home', { color: 'green', icon: 'house' });
  const errands = await newSection(home.id, 'Errands');
  await newSection(home.id, 'Chores');
  const work = await newList('Work', { color: 'blue', icon: 'briefcase' });
  await newTask({ title: 'Pay rent #bills', listId: home.id, due: today, priority: 3,
    recurrence: { rrule: 'FREQ=MONTHLY', from: 'due' }, reminders: [{ at: `${today}T09:00` }] });
  await newTask({ title: 'Buy tiles #shopping', listId: home.id, sectionId: errands.id, due: d(1), links: ['Projects/Home renovation.md'] });
  await newTask({ title: 'Water the plants', listId: home.id, due: today, recurrence: { rrule: 'FREQ=DAILY;INTERVAL=2', from: 'completion' } });
  await newTask({ title: 'Renew passport', listId: home.id, due: d(-2), priority: 2 });
  const elec = await newTask({ title: 'Book the electrician [[Home renovation]]', listId: home.id, due: d(4), priority: 1,
    notes: 'Ask about the hall sockets too.' });
  await newTask({ title: 'Get two quotes', listId: home.id, parentId: elec.id });
  await newTask({ title: 'Quarterly report', listId: work.id, start: d(3), due: d(7), priority: 2, tags: ['work'],
    reminders: [{ at: `${d(7)}T08:30` }] });
  await newTask({ title: 'Prepare [[Weekly sync]] notes', listId: work.id, due: d(2),
    recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=MO', from: 'due' } });
  const gutters = await newTask({ title: 'Clean the gutters', listId: home.id, due: d(-1) });
  await call('POST', `/api/tasks/${gutters.id}/complete`, { body: { tz: TZ } });
  await call('POST', '/api/capture', { body: { text: 'Call the plumber about the sink', target: 'inbox', tz: TZ } });
  await newTask({ title: 'Look up raised bed kits', due: d(5) }); // the Inbox

  log('Property types, bookmarks, history, trash');
  for (const [name, type] of [['due', 'date'], ['budget', 'number'], ['rating', 'number'], ['approved', 'checkbox']]) {
    await call('PUT', '/api/properties/types', { body: { name, type } });
  }
  const bm = await call('GET', '/api/bookmarks');
  const now = Date.now();
  await call('PUT', '/api/bookmarks', {
    body: {
      baseVersion: bm.version,
      items: [
        { type: 'file', ctime: now, path: 'Projects/Home renovation.md' },
        { type: 'file', ctime: now, path: 'Projects/Home renovation.md', subpath: '#Costs' },
        { type: 'search', ctime: now, query: 'tag:#project', title: 'All projects' },
        { type: 'folder', ctime: now, path: 'Reading' },
        { type: 'group', ctime: now, title: 'Reading', items: [
          { type: 'file', ctime: now, path: 'Reading/Dune.md' },
          { type: 'file', ctime: now, path: 'Reading/Reading list.md' },
        ] },
      ],
    },
  });
  // A few versions of one note, so History has something to show.
  await commitNow();
  await editFile('Projects/Garden.md', (t) => t.replace('Raised beds', 'Two raised beds'));
  await commitNow();
  await editFile('Projects/Garden.md', (t) => t.replace('- [ ] Order soil', '- [x] Order soil'));
  await commitNow();
  await note('Old ideas.md', '# Old ideas\n\nA pond? Probably not.\n');
  await trashFile('Old ideas.md');

  log(`Second vault "${SECOND_VAULT}"`);
  const { vaults } = await call('GET', '/api/vaults');
  if (!vaults.some((v: any) => v.name === SECOND_VAULT)) await call('POST', '/api/vaults', { body: { name: SECOND_VAULT } });
  await waitForVault(SECOND_VAULT);
  await note('Roadmap.md', '# Roadmap\n\n- Q4: ship the report\n- Q1: hire\n\nSee [[Standup]].\n', SECOND_VAULT);
  await note('Standup.md', '---\ntags: [work]\n---\n# Standup\n\nNothing blocked. #work\n', SECOND_VAULT);
  const wl = await newList('Sprint', {}, SECOND_VAULT);
  await newTask({ title: 'Write the report', listId: wl.id, due: d(1) }, SECOND_VAULT);
  await commitNow();
  await commitNow(SECOND_VAULT);
}
