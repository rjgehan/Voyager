# Performance at scale

How NotesApp behaves with a large vault, how to measure it again, what was fixed, and what is known to stay slow. The targets that the build checks are in [DESIGN §5.19](DESIGN.md#519-performance-targets); this document is the wider survey behind them.

## The load-test kit (`perf/`)

Scripts only: the vault is generated, never committed.

| Script | What it does |
|---|---|
| `perf/generate-vault.mjs --out <dir>` | Generates `<dir>/vault` and `<dir>/manifest.json`, deterministic for a seed (`--seed`, 42). 10,000 notes (730 daily notes, the rest in 100 folders; 3 to 30 KB with frontmatter properties, 3 to 8 links each, tags, tables, task lists, code, embeds), `Hub.md` linked from 200 notes, 500 attachments (350 PNGs, some photo-sized, and 150 PDFs of 1 to 300 pages of text), a 5 MB note (`Big/Big Note.md`, about 92,000 lines of everything Live Preview renders), a 2,000 × 30 spreadsheet with formulas and cached results (`Sheets/Big Sheet.sheet`), a 1,000-card canvas with 1,200 edges (`Canvas/Big Canvas.canvas`), a 500-task list with reminders, subtasks and sections (`Tasks/Big List.tasks`), and a git history of 2,000 commits (edits, renames that `--follow` must cross, several authors) written with `git fast-import`. 126 MB of files, 109 MB of history; about 20 s. |
| `perf/build-jar.sh [--skip-frontend]` | Builds the production jar with the frontend's production build inside it, as the Docker image does, without touching `src/main/resources` (it stages `frontend/dist` in `target/classes/static`). Run `./mvnw clean` before the backend test gates afterwards. |
| `perf/bench-backend.mjs --data <dir>` | Copies the vault, starts the jar (port 18600, `-Xmx768m` as in the 1 GB container) and measures: cold start, index build, memory, git bootstrap and PDF extraction; the common reads; search p50 and p95 for 19 kinds of query (as the search panel sends them), typing in the search box and 4 concurrent searchers; per-file and vault history; saves of a small note, the 5 MB note, the sheet and the canvas; a rename with 200 backlinks, its reverse and a folder move; SSE fan-out to 20 clients; then a second (warm) start. `--only reads,search,history,writes,move,sse`, `--reuse`, `--serve` (keep it running for the browser part), `--jfr <file>` (a JFR recording, dumped before the server stops), `--props 'k=v;k=v'` (extra server properties, for example an access log or `logging.level...=DEBUG`), `--jar <other jar>`, `--out <results.json>`. |
| `perf/bench-browser.mjs --data <dir>` | Drives a headless Chromium (Edge or Chrome, found or `--browser <path>`) over the DevTools protocol on port 5150, against a running server, with `perf/bench-browser.js` injected into every page: initial load, opening notes (cold and warm), the 5 MB note, typing in it (dispatched keystrokes at its start, middle and end, and real key events with Event Timing), opening and scrolling the sheet, opening and panning the canvas, the graph view (first draw, settling, zooming), the quick switcher and the search panel. `--cpu 1,4` repeats everything with DevTools CPU throttling (4× approximates a phone), each in a fresh browser; `--profile true` saves `.cpuprofile` files and prints the hottest functions; `--browser-args=...` adds switches (`--disable-gpu` for software rasterization); `--eval '<expression>'` runs one expression in the loaded app (debugging). |
| `perf/bench-browser.js` | The in-page measurements (`window.notesPerf`), usable on their own: paste it into the DevTools console of the app and call `notesPerf.open('Big/Big Note.md')`, `notesPerf.typing()`, `notesPerf.graph()`, and so on. It drives the UI as a user does (the quick switcher, the command palette, `Ctrl+Shift+F`) and reads CodeMirror's view from the DOM. |
| `perf/jfr-top.mjs <file.jfr>` | The methods with the most CPU (and native) samples in a JFR recording, inclusive and self, optionally for one thread or time window (`--from 14:42:26 --to 14:42:36`, the server log's clock). |
| `perf/compare.mjs <before.json> <after.json>` | A Markdown table of two result files of either bench. |

A full run:

```sh
node perf/generate-vault.mjs --out ../perfdata
sh perf/build-jar.sh
node perf/bench-backend.mjs --data ../perfdata --out ../perfdata/backend.json
node perf/bench-backend.mjs --data ../perfdata --reuse --only none --no-boot2 --serve &   # for the browser part
node perf/bench-browser.mjs --data ../perfdata --cpu 1,4 --out ../perfdata/browser.json
```

The backend perf tests (`@Tag("perf")`, excluded from the default build) cover the regressions found here with a 3× margin: `VaultPerformanceTest` (the §5.19 targets on 10,000 notes), `LargeDocumentPerformanceTest` (a 5 MB note: scan, a search that finds it, saves) and `ReminderTickPerformanceTest` (the reminders tick over 500 tasks): `./mvnw test -Dtest='*PerformanceTest' -DexcludedGroups=`. On this machine after the fixes they measure: a 5 MB note scanned in 71 ms (limit 600; about 900 before), found by a search in 10 ms (limit 90) and saved in 276 ms; the reminders tick over 500 tasks in 0.5 ms; and in `VaultPerformanceTest` a 3.0 s cold start, the tree in 54 ms, the graph in 83 ms, search p95 49 ms, a rename touching 200 notes in 1.4 s and a 219 MB steady heap.

## Machine and conditions

| | |
|---|---|
| Machine | AMD Ryzen 7 7800X3D (8 cores, 16 threads), 64 GB RAM, Samsung 980 PRO NVMe SSD |
| OS | Windows 11 Pro (NTFS, Microsoft Defender on) |
| Server | The production jar on JDK 21.0.12 (Temurin), `-Xmx768m`; no file watcher (it is off on Windows) |
| Browser | Microsoft Edge 156 (Chromium), headless, 1280 × 900, through `perf/bench-browser.mjs` |

- **The built-in browser pane was not usable for timing in this session:** it was hidden, so its pages ran as background pages (timers throttled to seconds, no frames unless requested). The browser numbers come from headless Edge, the same engine; `bench-browser.js` runs unchanged in the pane, or in any browser's console, when it is visible.
- **The machine was shared with other builds,** so it was 40 to 90 % busy during the runs, and repeated runs differ by 20 to 50 % (a whole run by more). Every "before" and "after" below were measured back to back, the jar built from `origin/main` (ff3263a) against the jar of this branch, on fresh copies of the same vault.
- The production server is slower than this desktop (and runs on Linux, on JDK 25 with an AOT cache): expect larger numbers there. CPU-bound work scales with the CPU; file syncs are typically faster on Linux than on NTFS.

## Results

### Server (production jar)

Startup, three boots of each jar in turn on the same vault (medians):

| | Before | After |
|---|---:|---:|
| Cold start to ready (ms) | 8,567 | 8,032 |
| Index build (ms) | 3,632 | 2,911 |
| Scanning every note once, one thread (ms; the 10,002 notes, the 5 MB one included) | 10,717 | 3,856 |

One full run of each jar, back to back (p50 / p95 in ms where two numbers are given). The rows whose code did not change (the tree, the graph, history, the startup times here) show how much the machine varied between the runs; the rows the fixes touched moved well beyond that:

| Measurement | Before | After |
|---|---:|---:|
| Cold start to ready (ms) | 9214 | 11810 |
| Index build (ms) | 3929 | 4616 |
| Git bootstrap done (ms after start) | 9919 | 12990 |
| PDF text of 150 PDFs done (ms after start) | 13778 | 22541 |
| Second start, warm (ms) | 10055 | 8959 |
| Heap after GC at ready / steady (MiB) | 289 / 236 | 233 / 236 |
| Process RSS steady (MiB) | 1021 | 996 |
| GET /api/tree, p50 / p95 (ms) | 63.8 / 76.1 | 111.9 / 128.5 |
| GET /api/files, a 4 KB note | 6 / 7.8 | 4.1 / 12 |
| GET /api/files, the 5 MB note | 243.5 / 264.7 | 422.5 / 476.7 |
| GET /api/files, the sheet | 58.5 / 60.1 | 97.6 / 108.8 |
| GET /api/notes/backlinks, 200 linked | 3.5 / 4.1 | 4.9 / 5.7 |
| Unlinked mentions | 3.8 / 6.2 | 6.1 / 8.1 |
| GET /api/graph | 106.7 / 120.1 | 188.9 / 217.1 |
| GET /api/graph?since= (unchanged) | 0.7 / 1.2 | 0.9 / 3 |
| GET /api/tags / /api/properties | 6.3 / 11 | 11.1 / 18.9 |
| GET /api/tasks?view=list (500 tasks) | 5.5 / 6.6 | 7.9 / 16.9 |
| Search, all 19 queries | 10.7 / 191.8 | 8.6 / 133.6 |
| Search "beajas zemure" (hits the 5 MB note) | 92.6 / 107 | 13.3 / 19.2 |
| Search /quarter(ly)? rev/ (regex) | 204.9 / 228.7 | 137.4 / 179.7 |
| Search while typing, 16 prefixes (total ms) | 202.9 | 148.9 |
| 4 concurrent searchers: p50 / p95 (ms), per second | 10.3 / 83.5, 262/s | 8.6 / 22.3, 442/s |
| GET /api/history, Hub (~80 entries) | 81.6 / 91.6 | 77.3 / 92.8 |
| GET /api/history, a note in 1 of 2,000 commits | 80.1 / 91.7 | 79.8 / 93.8 |
| GET /api/history, a renamed note | 66.2 / 88 | 89.8 / 94.3 |
| GET /api/history/log, first page / offset 1,900 | 40.4 / 47 | 45.4 / 56.4 |
| PUT /api/files, a 4 KB note | 9.7 / 12 | 7.6 / 13.3 |
| PUT /api/files, the 5 MB note | 718.1 / 804.8 | 387 / 416.5 |
| PUT /api/files, the sheet (one cell) | 173.1 / 212.2 | 141.7 / 159 |
| PUT /api/files, the canvas (one card) | 58.8 / 64.9 | 48.5 / 52.9 |
| Rename Hub.md, 222 linking notes (ms) | 3327 | 2167 |
| ... and back (ms) | 1654 | 920 |
| Move a folder of 100 notes (ms) | 3390 | 1648 |
| Save to file.changed at 20 SSE clients | 10.5 / 11.7 | 7 / 11.9 |

Search, per kind of query (after; p50 / p95 ms, hits): common words 12 to 22 / 15 to 31 (6,686 to 10,153 hits), a phrase 27 / 31 (384), rare words 2 / 3 (224 to 368), two rare words that hit the 5 MB note 13 / 19 (43), a prefix 8 to 12 / 13 to 14, typos 9 to 10 / 13 to 20, properties 5 to 6 / 8 to 10, paths 2 to 4 / 3 to 6, OR and groups 4 to 11 / 5 to 15, a regular expression alone 137 / 180 (343; it reads all 45 MB of text). Memory: the heap after a full GC stays at about 236 MiB with the 5 MB note, the PDF texts and everything else in memory; the process is about 1 GB resident with `-Xmx768m`.

### Browser (headless Edge; 4× is DevTools CPU throttling)

| Measurement | Before 1× | After 1× | Before 4× | After 4× |
|---|---:|---:|---:|---:|
| Initial load: file tree shown (ms) | 115.6 | 120.6 | 423.9 | 406.1 |
| Open a note, first (editor chunks load) (ms) | 359.5 | 362.1 | 656 | 664.3 |
| Open another note (ms) | 22.4 | 29.8 | 139 | 152.3 |
| Open the 5 MB note (ms) | 359.5 | 359.7 | 630.3 | 647.3 |
| Typing in it at its start, p50 (ms) | 3.1 | 3.7 | 20.1 | 19.9 |
| Typing in it in the middle, p50 (ms) | 11.8 | 22.4 | 25.7 | 25.9 |
| Typing in it at its end, p50 (ms) | 24.2 | 28.8 | 27.8 | 25.5 |
| Real keystrokes in it: keydown to paint, p50 (ms) | 48 | 32 | 48 | 48 |
| Open the sheet (ms) / longest task | 574.8 / 343 | 786.7 / 411 | 2480.7 / 1925 | 2664.2 / 2166 |
| Scroll the sheet: frame p95 (ms) | 6.2 | 6.2 | 8.6 | 8.4 |
| Open the canvas (ms) | 466.1 | 507.8 | 1490.4 | 1560.3 |
| Pan the canvas: frame p95 (ms) | 11.4 | 12.2 | 80.2 | 73.2 |
| Graph: first draw (ms) | 518.1 | 551.4 | 881.8 | 910 |
| Graph: frame while settling, p95 (ms) | 18.1 | 23.2 | 26.1 | 26.8 |
| Graph: frame while zooming, p50 / p95 (ms) | 339.8 / 2558.5 | 9.6 / 31.5 | 381.3 / 2777.6 | 28.3 / 57.3 |
| Quick switcher: keystroke, p50 / p95 (ms) | 7.8 / 39.1 | 2.7 / 45.6 | 30.2 / 183.2 | 10.8 / 174.5 |
| Quick switcher: one letter (ms) | 20.6 | 11.3 | 98.7 | 43.5 |
| Search panel: query to results (ms; 200 ms of it debounce) | 226 | 228 | 295.5 | 295.1 |

The quick switcher and search rows come from a separate pair of runs on a fresh page each. Unchanged paths (opening notes, the sheet and the canvas, typing) again show the run-to-run variation. The first switcher keystroke after a tree change builds the snapshots, which is the p95 after the fix.

## What was fixed

Each was profiled first (JFR on the server, the DevTools profiler in the browser); each has a test.

1. **Saving a big note, and the startup index: the Markdown scanner.** Saving the 5 MB note took 0.7 to 0.9 s of server time, most of it in `MarkdownScanner.scan` (0.9 s for that note on its own): its regular expressions for wikilinks, Markdown links, tags and block ids start with optional groups and look-behinds, so Java tried them at every position of every line. A line now skips each expression when it lacks the expression's literal (`[[`, `](`, `#`, `^`; headings need `#`, `=` or `-` after at most three spaces), and line starts are found with `indexOf`. The output is identical (the existing scanner tests, and a comparison of every note of the generated vault before and after); scanning is 2.7 times faster on ordinary notes and 5.5 times on the 5 MB note. The save went from 720 to 860 ms to 320 to 390 ms, the index build from 3.6 to 2.9 s and the cold start from 8.6 to 8.0 s (medians of alternating boots), and every link rewrite and reconcile is cheaper (`LargeDocumentPerformanceTest`).
2. **Searches that find a big document: snippets.** A two-word search that found the 5 MB note (or the 300-page PDF) took 60 to 400 ms, where the evaluation took 3: the snippets tokenized every line of every hit to find three matching lines and count the rest. They now come from the token sequence the index already keeps for each document: whether a line matches is decided once per distinct term with the pattern's own `matches`, then checked as integers, and only the three lines shown are tokenized for their highlight ranges (`SnippetBuilder`, `VaultIndex.bodies`). 62 to 93 ms to 13 to 14 ms (p50) for that query in two pairs of runs, and 4 concurrent searchers do 442 searches a second instead of 262; `SnippetSequenceTest` checks that snippets are the same both ways (words, prefixes, phrases, typo variants, alternatives, accents, ideographs, CRLF, encrypted sections, PDF pages).
3. **Renaming a note with 200 backlinks.** 4.1 s, mostly 222 file syncs in a row (about 10 ms each on NTFS) and two commits. The rewritten notes are now prepared first, then their temp files written, synced and parsed up to 8 at a time, then renamed into place in order, and each folder synced once (`VaultFs.stage`, `placeStaged`, `syncParents`). Renaming from several threads was tried first and was twice as slow on NTFS (renames into one folder contend), so only the syncs overlap. 3.3 to 4.1 s to 1.7 to 2.2 s; its reverse 1.7 to 1.8 s to 0.8 to 0.9 s; a 100-note folder move 3.4 to 4.3 s to 1.6 to 1.7 s (two pairs of runs; with `logging.level.com.rjgehan.notes.vault.MoveService=DEBUG` the server logs each phase). What remains is mostly the two JGit commits (below). `MoveServiceTest` covers 40 linking notes in four folders, with failures among them, reported in plan order.
4. **Zooming into the graph of 10,000 notes.** Once the zoom passed 1 (links wider than one pixel), each frame took 0.3 to 4 s: a stroke wider than one device pixel is turned into a polygon per segment and the tens of thousands of overlapping polygons are filled together, ten to fifteen times slower than hairlines (measured with the real layout: 3.4 s against 0.22 s for 45,000 visible links, software rasterization; the same shape with GPU raster in headless Edge). The links that are not highlighted are now hairlines on a layer at CSS-pixel resolution, scaled onto the canvas (so on a 2× screen they stay one CSS pixel wide); a hovered node's links keep their width. Zoom frames: p50 340 to 10 ms and p95 2.6 s to 32 ms; with 4× throttling p50 381 to 28 ms and p95 2.8 s to 57 ms. `renderer.test.ts` checks the widths and the layer.
5. **The quick switcher and `[[` completion.** Each keystroke re-ranked every match of 10,500 items (two keys each), boosted them all and sorted them, and rebuilt the items: 35 to 450 ms per keystroke with 4× throttling (the first letter matches almost everything). The items are now built once per tree, and searched through fuzzysort snapshots per boost group, each asked for its best 50: within a group the boost is the same, so the result is exactly the old one (`fuzzy.test.ts` compares them). Typing in the switcher with 4× throttling: p50 30 to 11 ms, one letter 99 to 44 ms (without throttling 7.8 to 2.7 ms and 21 to 11 ms); the first keystroke after the tree changes builds the snapshots (about 150 ms there).

## Known limits (not changed)

- **Typing in Live Preview in the 5 MB note** costs about 3 ms per keystroke at its start, 12 to 23 ms in the middle and 24 to 37 ms at its end on this machine (and about 4× with throttling: noticeable on a phone). Almost all of it is CodeMirror's incremental parse: `@lezer/markdown` reuses unchanged blocks but still walks every block before the edit (measured on its own: 16 ms at the start, 27 ms in the middle, 46 ms at the end of this note), and the background parse then works in 100 ms slices. The app's own share is small (the table blocks are mapped through each edit: about 3 ms at the end with 1,400 tables). Notes of ordinary size are not affected (the 10,000-line test in `perf.test.ts`).
- **Opening the 2,000 × 30 sheet** blocks the page for about 0.35 to 0.7 s (2 s with 4× throttling) while HyperFormula loads 60,000 cells; scrolling it is smooth. Moving the engine to a worker would be the fix.
- **Compression of large responses.** Tomcat compresses JSON with zlib's default level, which dominates the largest responses: the tree takes 27 ms to serialize and 86 ms with gzip, the 5 MB note 58 and 360 ms, the graph 79 and 161 ms. Tomcat has no setting for the level; a response filter compressing at level 1 (about 3 times faster, about 20 % larger) would be the fix.
- **Commits of many files.** The links commit of a 200-note rename takes 0.3 to 0.8 s here: JGit writes each changed blob as a loose object (a file each), which NTFS and Defender make slow; on Linux it is much cheaper. A move also first commits what is pending (with a just-saved 5 MB note, that is 0.3 to 0.8 s more).
- **Per-file history** (`GET /api/history`) walks the whole history to follow renames: 75 to 100 ms with 2,000 commits, growing with the history.
- **Cold start** is about 8 s here (the §5.19 target is 10 s), of which 2.9 s is the index build (parallel, then about 0.5 s on one thread to swap it in); the Spring context takes about 4 s on JDK 21 without the AOT cache the image uses. PDF text extraction (150 PDFs, one of 300 pages) runs after readiness on one low-priority thread and takes 5 to 10 s more.

## What needs a real iPhone

The graph (iOS Safari draws canvases with Core Graphics, not Skia), typing in very large notes, opening the big sheet, and the switcher's first keystroke after a change: the 4× CPU throttling above only approximates a phone.
