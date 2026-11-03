# NotesApp: QA pass, 2 Nov 2026

> **Status since (round 2 of the bug hunt, merged into `build/next`):** F1, F2, F8, F9, F10, F11, F12 and F14 are fixed. The F1 and F2 tests are no longer `KNOWN BUG`s: `known-bugs.spec.ts` is gone and they run as ordinary tests in `e2e/tests/ui/sync.spec.ts` (F1) and `e2e/tests/ui/core-loop.spec.ts` (F2). F7, F13, F15, F16 and F17 are still open. The text below is the pass as written.

`origin/main` at `ff3263a` plus `fix/e2e-qa`, on a scratch vault seeded with `npm run seed` (notes with links, tags, properties and table formulas; a spreadsheet, a drawing, a canvas, a PDF and an image; task lists with sections, subtasks, reminders and repeats; a Kanban board; daily notes, templates, flashcards, habits, bookmarks, history, trash; a second vault). Driven at iPhone size (390 × 844, touch, no hover, an iPhone user agent) and as the PC (1366 × 860), dark and light, against Vite (`npm run reset`) and against the jar serving the built frontend as the Docker image does (`npm run reset -- --prod`). Browser: Edge 156 (Chromium), since this PC has no Chrome; CI uses Chrome.

Covered: every page, panel and sheet (the screen inventory after these pages), the API's edge cases (paths, names, sizes, versions, CSRF, Host and identity allowlists, Funnel, vault isolation, the event stream), two devices on one note including offline edits, and the everyday flows (new note, links, rename, delete and undo, capture, daily notes, quick add, search).

## Verdict

**Nothing blocks a deploy.** No High findings: the version protocol, conflicts, trash, history, moves and the security boundary held under everything the suite threw at them, and no text typed into a note was lost. Two Medium bugs, both only in the built app and both about timing (F1, F2), are tests marked `KNOWN BUG`. Four Low ones were trivial and are fixed on this branch with regression tests (F3–F6).

| Severity | Count | |
|---|---|---|
| High | 0 | |
| Medium | 2 | F1, F2 (open) |
| Low | 15 | F3–F6 fixed; F7–F17 open |

## Fixed on this branch

| # | Sev. | What was wrong | Fix | Regression test |
|---|---|---|---|---|
| F3 | Low | PC, split panes: in a pane about 370 px wide the save status and buttons slid over the breadcrumb ("Projects / Home r✓Saved"). | Header columns keep the buttons' width; the breadcrumb ellipsizes. | `e2e/tests/ui/layout.spec.ts` |
| F4 | Low | Phone: a Dataview `TABLE` split words ("ratin\|g", "readi\|ng"): rendered tables inherited CodeMirror's break-anywhere wrapping. | Rendered table cells in the editor wrap at words; the table scrolls sideways. | `e2e/tests/ui/layout.spec.ts` |
| F5 | Low | Phone, Compare versions: the legend wrapped between the red swatch and its label. | Swatch and label are one unbreakable key. | `e2e/tests/ui/sync.spec.ts` |
| F6 | Low | Compatibility report: `![[Budget.sheet#Budget!A1:C6]]` listed as a missing heading; a task link `[[Inbox.tasks#^id]]` would be a missing block. | Headings and block ids are checked only when the target is a note (DESIGN §5.23). | `CompatScannerTest.subpathsIntoDocumentsAreNotHeadings` |

## Open: Medium

**F1. Offline, the built app reloads itself into the browser's "no internet" page.** Open a note, lose the network, click into the note: the editor asks for a lazy chunk (`htmlToMarkdown`) that cannot load offline; `vite:preloadError` is taken for a new deploy and `handleNewBuild()` reloads the page (nothing is unsaved yet). Offline, the reload lands on the browser's error page. Only without a service worker (the worker precaches every chunk): a first visit, a browser or webview that blocks workers, every Playwright run. Suggested fix in `state/buildCheck.ts`: reload only when the server's build really changed (skip when `navigator.onLine === false`, or confirm through `/api/status`'s `X-Notes-Build`). Test: `known-bugs.spec.ts` (production mode).

**F2. New note pressed while the app is still opening loses what is typed.** On a slow start (the tree answering after 1.5 s; a phone's cold start over the tailnet) New note creates `Untitled.md` but its title does not get the focus, so the typing goes nowhere; with other timings the start page's note replaces the new note once loaded. An empty `Untitled N.md` is left behind. Every time on the PC with a delayed tree, sometimes on the phone. Suggested fix: the home route must not redirect once the user has navigated, and the pending note's title takes the focus whenever it mounts. Test: `known-bugs.spec.ts` (PC).

## Open: Low

| # | Where | Finding | Suggestion |
|---|---|---|---|
| F7 | Compatibility report | The app's own inline formulas (`` `=costs!D5/12` ``) are reported as unsupported "Dataview queries". | Report only `` `$=…` `` and `=` with a dotted field (`this.file.name`); a decision, since only the engine knows. |
| F8 | Ask your vault | Off, it says questions go to "Anthropic's Claude API"; under the box, "Sent to Claude with your subscription" and "$0 of $5.00 this month" (an API budget). | One wording per provider; no budget for the subscription. |
| F9 | Search, Backlinks | A task's related note shows as `[Home renovation](/Projects/Home%20renovation.md)`. | Render it as a link, or index it as `[[Home renovation]]`. |
| F10 | History panel | Batch subjects list hidden files first: "Update 28 files: .notesapp/bookmarks.json, …". | Visible files first. |
| F11 | Notes, phone | A Dataview block's ↻ and `</>` sit over the table's last header on touch. | A bar above the output on touch. |
| F12 | Habits | The year grid's first month label is cut ("n", "ul"). | Hide a partly scrolled-out label. |
| F13 | PDF, phone | The zoom select reads "Automati". | "Fit" or an icon at phone width. |
| F14 | Excalidraw, PC pane | The toolbar is clipped in a 370 px pane (sized by the window). | The compact layout by pane width. |
| F15 | Formulas | `` `=costs!D5/12` `` shows 441.6666667 though column D is currency; Sheets shows $441.67. | Inherit a single referenced cell's or column's format. |
| F16 | New note | Leaving a new note at once leaves an empty `Untitled.md` (as Obsidian). | Delete an untouched empty Untitled note when left. |
| F17 | Editor | "Tab indents in the editor…" shows after Enter from a new note's title. | Show it on the first Tab. |

## Checked and fine

- Version protocol: stale saves get the server copy; equal content never conflicts; retried saves and creates (`Idempotency-Key`) succeed once; deleted and moved files say so (`movedTo`).
- Names and paths: `..` (also encoded), `\`, `//`, dot folders, Windows names, over-long names, `:` `?` `#` `[[` refused; NFD in, NFC out; `+` survives the query string.
- Moves rewrite wikilinks, Markdown links, embeds, task titles and task links (never in code); sheets and drawings are reported; bookmarks and history follow.
- Trash, history and restore as documented; search with phrases, `tag:`, `path:`, negation, properties, typos, prefix, PDF pages, sheet cells and tasks; long and catastrophic queries refused in time.
- Security: `X-Client-Id`, `Origin`, `Sec-Fetch-Site`, Host (421), identity (403, RFC 2047 names, commit authors), Funnel (403 everywhere), security headers, `no-store`.
- Vaults: per-vault files, search, tasks and trash; no path from an extra vault reaches the default one.
- Live sync: events in order, no echo, replay and resync; two browsers: live updates, the conflict banner after offline edits, Compare, Keep mine, Take theirs.
- Everyday flows on both devices; no console errors.

## Not covered

A real iPhone (Safari's keyboard, safe areas, gestures, the installed app and its service worker); Tailscale itself, deploys, the mirror, backups, ntfy and Web Push; Ask, transcription, publishing, the desktop app and the clipper; editing inside drawings and canvases; large vaults.

## After the concurrent merges

- Saved searches into bookmarks: the suite tests `type: "search"` bookmarks, never `/api/searches`; the Search page's ☆ goes; re-run `npm run screens`.
- Sheets parity pass: tests use the formula bar's "Cell reference" and "Contents of B4" and Enter to commit.
- User guide: nothing asserts Welcome's content; the inventory shoots Welcome and `Live Preview demo.md` when they exist.
- Hotkeys (quick add off Mod-Alt-T): the suite uses buttons, no hotkeys.
- When F1 or F2 is fixed, delete its `test.fail` line.

---

# UX pass, 2 Nov 2026

A pass over every screen at iPhone size and on the PC, with four rules: one obvious primary action per screen; rare actions behind ⋯; the same words everywhere; and the user's two devices first (the iPhone Home-Screen app, the Windows PC). Nothing below was changed on this branch except F3–F5; each item is a proposal with a size (S, M, L).

## Whole app

| | Now | Proposal |
|---|---|---|
| Phone top bar | Title · status · **+** (Quick capture) · search · tabs · ⋯ | The **+** of a notes app reads as New note; New note is two taps away in the drawer. Long-press + for Capture, or a small menu (New note / Capture) on +. (S, a product decision) |
| Phone title | Cut after about ten characters ("Home reno…") by four icons | Drop the tabs counter when there is one tab. (S) |
| Narrow PC panes | Breadcrumb overlap (fixed, F3); property names cut to "stat…", "bud…"; tag rows leave tall gaps | A minimum width for the name column, names wrapping instead. (S) |
| Start of the app | New note during the first second goes wrong (F2) | Disable New note until the workspace is ready, or fix the race. (M) |

## Notes

- **Goal:** read and write. **Primary:** typing. **Secondary:** properties, links, the ⋯ menu.
- **Properties on the phone** take two rows each (name, then value): seven fill the first screen before the note starts. Proposal: one row each from 360 px (name 35 %, value 65 %), and collapse the block on the phone when it has more than four. (M)
- **Table formats** (`%% formats: B=currency %%`) show as a "%%" chip under every formatted table. Proposal: hide comment lines that only hold a table's formats and id; show them on a click in the table's grip menu. (S)
- **Inline results** do not inherit the format they read (F15). (M)
- **Dataview tables** on the phone: fixed (F4); the ↻ `</>` bar covers the last header (F11). (S)

## Search

- **Goal:** find a note. **Primary:** the box. **Secondary:** sort, bookmark the search.
- Results do not say what they are: a spreadsheet, a drawing or a task list shows the note icon (only a PDF has a badge). Proposal: the explorer's kind badge (SHEET, EXCALIDRAW, TASKS) on results. (S)
- Task snippets show the indexer's Markdown (F9). (S)
- ☆ and the bookmark button sit side by side while saved searches fold into bookmarks: one "Bookmark this search" after the merge. (S, in progress elsewhere)

## Files that are not notes

- **Canvas** opens zoomed to fit the board: on the phone, card text is about 7 px. Proposal: open at 100 % on the first card, or remember the view per device. (M)
- **Excalidraw** opens where it was left (the hall is off-screen on a phone) and its toolbar is clipped in a narrow PC pane (F14). Proposal: zoom to fit on the first open of a device. (S)
- **PDF**: the zoom select is cut on the phone (F13). (S)

## Tasks

- **Goal:** see what is due and tick it off. **Primary:** the check circle; **Add task**.
- On the PC the **Lists** page has no Add task (the phone has the floating +; Today has a button). Proposal: Add task in every task page's header on the PC. (S)
- A task due on a Wednesday that repeats "every week on Monday" is accepted as it is. Proposal: say so in the detail sheet, or move the date to the rule's next day, as Todoist does. (S)

## Calendar, habits, flashcards

- Calendar: clear on both devices; the day details and "Create daily note" work as described.
- Habits: the year grid's first month label is cut (F12). (S)
- Flashcards: one primary button (Study now / Show answer), big answer buttons with intervals: no change.

## Other pages

- **Graph** on the phone shows dots without labels until zoomed. Proposal: labels for the largest nodes at the default zoom. (S)
- **Ask your vault** (off): two descriptions of where the text goes (F8). (S)
- **Compatibility report**: false findings fixed (F6) or listed (F7).

## New notes

- New note makes `Untitled.md` at once; leaving it empty keeps it (F16, as Obsidian). Proposal: delete an untouched empty Untitled note when it is left. (S)

## Checked and fine

The conflict banner and Compare (one primary, Keep mine), the quick switcher (aliases first, Create and Search rows), quick capture, quick add with chips, the trash, the vault switcher and Settings › Vaults, the light theme on the main pages, the status page.
