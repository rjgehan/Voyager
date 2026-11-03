# End-to-end tests

NotesApp driven the way it is used: the real backend on a scratch vault, and Chrome as the
Windows PC and as the iPhone's Home-Screen app. Nothing here touches a real vault: every file the
suite makes lives in `e2e/.run/`, which `npm run reset` wipes.

## Run it

```bash
cd e2e
npm ci                     # once (no browser download: the installed Chrome is used)
npm run reset              # fresh scratch vault; backend jar (dev profile) on :18570, Vite on :5153
npm run seed               # optional: a lived-in vault to click around (lib/seed.ts)
npm test                   # API + PC + iPhone, about 2 minutes
npm run screens            # screen inventory → screens-output/screens.pdf
npm run report             # open the last HTML report
npm run stop               # stop what reset started
npm run test:scripts       # the tooling's own tests (no server needed)
```

- **Production mode.** `npm run reset -- --prod` serves the *built* frontend from the jar on :18570,
  as the Docker image does (the frontend is built first when anything its build reads changed:
  `frontend/src`, `public/`, the files at the top of `frontend/` such as `index.html`, `share.html`,
  `vite.config.ts` and its plugins, and the user guide in `docs/guide`). CI uses it.
  Some bugs only exist in the built app (lazy chunks, see "Known bugs" below).
- **Rebuilds.** `reset` rebuilds the jar when `backend/src/main`, `pom.xml` or `backend/target/classes`
  is newer than the jar's last packaging (the time of `notesapp-*.jar.original`: the jar's own is
  fixed by the reproducible build), so a `mvnw test`, a failed `verify` or an IDE compile after an
  edit no longer passes for a current jar. `--build` forces both rebuilds. Run `npm ci` in
  `frontend/` once before the first reset.
- **Ports and processes.** Only :18570 and :5153 (`E2E_API_PORT`, `E2E_WEB_PORT` to change them), on
  loopback (`E2E_WEB_HOST` and `E2E_EXTRA_HOSTS` are for the hallway test below).
  `reset` refuses to start when something else listens there, and stops only the processes it
  recorded in `.run/pids.json`, by PID, after checking each is still the java or node it started
  (with `tasklist` on Windows, `/proc` on Linux, `ps` on macOS). A recorded process it cannot check
  is left running and stays recorded, and `reset` names it.
- **Browser.** `channel: 'chrome'`. Without Chrome the suite uses the installed Edge (also
  Chromium); `PW_CHANNEL=chrome|msedge|chromium` picks one (`chromium` is Playwright's own build,
  which CI installs only when the runner has no Chrome).
- **The server it starts** (`scripts/reset.mjs`): the dev profile, a scratch vault and a scratch
  folder for extra vaults, the Host allowlist `localhost`/`127.0.0.1` on both ports, the identity
  allowlist `e2e-owner@example.test` (any other `Tailscale-User-Login` is refused; no login is the
  dev profile's default "Owner"), a 2-second history batch, and the vault watcher on, as in the
  Docker image, except on Windows (the dev profile turns it off there: JDK-6972833 keeps watched
  folders from being renamed).

## In CI

The `e2e` job of `.github/workflows/ci.yml` runs `npm run reset -- --prod` and `npm test` on Linux with
the runner's Google Chrome, on pull requests and pushes to `main`, in about four minutes. A failed run
keeps its HTML report, traces and server log as the `e2e-report` artifact. Publishing the image waits
for it, as for the unit tests: a change that renames a button or label a test uses updates the test too.

## What's covered

| File | What |
| --- | --- |
| `tests/api/files.spec.ts` | Create, read, save; versions as git blob ids; 409 with the server copy; idempotent saves; deleted and moved files; `rename` and case collisions; `Idempotency-Key`; name and path rules; 415s; problem+json |
| `tests/api/move.spec.ts` | Rename and move rewrite wikilinks, Markdown links, embeds and task links; dry run; `updateLinks: false`; folders; refusals; documents reported `not-rewritable` |
| `tests/api/trash-history.spec.ts` | Trash and restore (files, folders, taken paths), purge; history per path, content at a commit, restore, renames followed, deleted files |
| `tests/api/search.spec.ts` | Words, phrases, `tag:`, `path:`, negation, `[property:value]`, typo correction, prefix; tasks, spreadsheet cells and PDF text; bad parameters |
| `tests/api/bookmarks.spec.ts` | Obsidian's format round-trips (search bookmarks included), version conflicts, validation, bookmarks following a move |
| `tests/api/tasks.spec.ts` | Inbox, Today/Upcoming/list/Completed, recurrence roll-forward and retried completion, per-field conflicts, subtasks and sections, validation, backlinks and search, list rename and delete |
| `tests/api/properties.spec.ts` | Property list, counts and inferred types; values; `types.json`; rename that keeps every other byte |
| `tests/api/vaults.spec.ts` | Same path in two vaults, search/tasks/trash per vault, path escapes, `/api/v/main`, names and refusals |
| `tests/api/security.spec.ts` | `X-Client-Id`, `Origin`/`Sec-Fetch-Site` (CSRF), the Host allowlist (DNS rebinding), the identity allowlist and RFC 2047 names, commit authors, Funnel, security headers |
| `tests/api/events.spec.ts` | What another device hears and in which order, echo suppression, task events, replay from the last id and resync |
| `tests/ui/core-loop.spec.ts` | New note, Live Preview, a wikilink from autocomplete (Mod-click / tap to follow), rename from the title updating links, table formulas recalculating and saving what was typed |
| `tests/ui/sync.spec.ts` | Two devices on one note: live update, offline edits ending in the conflict banner, Compare, Keep mine, Take theirs |
| `tests/ui/find-and-plan.spec.ts` | Search page (open at the match, search-as-you-type), task quick add, checking off on Today, the calendar's day and daily note, a spreadsheet formula from the formula bar, a sheet embed |
| `tests/ui/layout.spec.ts` | Layout regressions jsdom cannot see: the note header in a narrow split pane, Dataview tables on a phone |
| `tests/ui/known-bugs.spec.ts` | Bugs found and not fixed yet (below) |
| `tests/screens/inventory.spec.ts` | Not a test: captures every page, panel and sheet for the PDF |
| `scripts/*.test.mjs` | The suite's own tooling, with `npm run test:scripts` (no server, no browser; CI runs it before the suite): each project lists only its own folder wherever the checkout lives; `reset` rebuilds a jar or frontend older than what it is built from, and starts the server with the vault watcher except on Windows; `stop` stops what was recorded on Windows, Linux and macOS, and never forgets a process it could not check |

UI tests run on both devices (`desktop`, 1366 × 860, and `iphone`, 390 × 844 with touch, no hover
and an iPhone user agent, so the app takes its iOS paths); a title with `@desktop` or `@phone` keeps
a test to one.

### Known bugs are tests too

A test for something broken today is marked `test.fail(…, 'KNOWN BUG …')`. It shows as ✘ but
counts as passing. When the bug is fixed, Playwright reports **"Expected to fail, but passed"**:
delete the `test.fail` line. A green run means "nothing got worse", and the `KNOWN` lines are the
bug list.

```bash
grep -rn "KNOWN BUG" tests/
```

## Writing a new test

- Arrange with the API (`lib/api.ts`: `createFile`, `saveFile`, `move`, `newList`, `newTask`, …),
  then click only through the part the test is about. Every test makes its own notes under a
  `unique()` name: the vault is shared, and runs pile up until the next `reset`.
- Basenames resolve vault-wide (`[[Plan]]` finds any `Plan.md`), so make linked names unique too.
- Search for a `madeUpWord('stem')` of the test's own: random letters, so no earlier run's word
  shares its prefix or is a typo away from it (a word from the clock would be, and a rerun without
  `reset` would find both).
- After typing, poll the file (`eventually(() => readFile(path), …)`) rather than trusting the
  screen: the app saves in the background.
- Follow a link with Mod-click on the PC and a tap on the phone; a plain click edits it.
- Keyboard shortcuts differ between the projects (the iPhone user agent makes the app use ⌘):
  prefer clicks and taps, `typeAtEndOf` (click a line, End, type) and the formula bar.
- Start from an open note, not `/`, before pressing New note (see the known bug).
- `secondDevice(browser, testInfo)` opens the second phone or PC tab with the project's settings;
  `context.setOffline(true)` takes a device off the network.

## The hallway test (people, not Playwright)

Give the iPhone to someone who has not seen the app, one task at a time, and say nothing. Write down
every pause, wrong tap and "where's the…". Stop a task after two minutes.

Set up on the PC, with Vite on its tailnet address only (never 0.0.0.0, which would open the
unauthenticated dev backend to every network the PC joins):

```bash
E2E_WEB_HOST=<the PC's address from `tailscale ip -4`> npm run reset && npm run seed
```

then open `http://<that address>:5153` in Safari on the phone (on the tailnet). To use the PC's
tailnet name instead, add `E2E_EXTRA_HOSTS=<pc>.<tailnet>.ts.net:5153` (comma-separated, each
`host:port`): the server and Vite then answer that name too. The phone talks to Vite directly, so it
sends no Tailscale identity and the dev profile's default "Owner" applies. It is a plain-http origin,
so there is no service worker: offline, the open page keeps working (task 11), but a reload does not
load the app. `npm test`
still works against this stack (it uses the address reset reports); `npm run reset` without
`E2E_WEB_HOST` goes back to localhost.

1. Write a note called **Packing list** with three things to bring.
2. In it, link to the note about the **renovation**.
3. Find the note that mentions **cabinets** in a PDF.
4. Add a task: **call the plumber tomorrow at 9**, high priority.
5. What is due today? Check one off.
6. Open next Thursday in the calendar and make its daily note.
7. In **Home renovation**, change the number of cabinets to 8. What is the new total?
8. In **Budget**, add a row for **Paint** at 120 and make the total include it.
9. Put **Dune** in your bookmarks, then get back to it from somewhere else.
10. Rename **Garden** to **Garden 2027**. Is the link in Home renovation still fine?
11. Turn on airplane mode, edit a note, turn it off again. What happened?

For each: time taken, first tap, where they got lost, what they said out loud.
