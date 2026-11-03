# Accessibility

Voyager aims at **WCAG 2.2 Level AA** on every page, panel, dialog and view, at desktop size and on a phone, in the dark and the light theme. This file says where it stands, how it is checked, and what is still missing. The design rules are in [DESIGN §6.19](DESIGN.md#619-accessibility-wcag-22-aa); the theme colours and their contrast in [§6.17](DESIGN.md#617-theming).

## Status (2026-11-02)

| Area | State |
|---|---|
| Automated checks (axe-core, WCAG 2.0/2.1/2.2 A and AA) | No violations on the screens below, in both themes, at 1280 × 800 and 375 × 812, apart from the spreadsheet view (listed under known gaps). |
| Keyboard | Everything works without a pointer except drawing, arranging a canvas and opening a note from the graph (known gaps). No traps: `Esc` closes every overlay and returns the focus; `Esc` then `Tab` leaves the editor. |
| Screen readers | Landmarks, names, roles and states throughout; live regions for saving, toasts, the connection and conflicts. Note text is a single multi-line text box (CodeMirror), see known gaps. |
| Contrast | All text 4.5:1 or more, controls, borders and the focus ring 3:1 or more, in both themes (tokens checked by a unit test). |
| Zoom and reflow | Works at 200 % and at 320 CSS px wide (400 %) without sideways scrolling, except two-dimensional content (tables, code, diagrams, canvases), which WCAG allows. |
| Motion | `prefers-reduced-motion` turns off every transition and animation (spinners excepted). |
| Touch targets | At least 24 × 24 px everywhere, 44 × 44 px on touch screens. |

Screens covered by the browser audit: the home redirect, a note (Live Preview), the rich-Markdown and formulas samples, a canvas, an image, a JSON file, a missing file, search, trash, all thirteen settings sections (and the phone's settings index), every page (calendar, vault history, status, graph, compatibility report, Ask, flashcards, habits, the five task pages), the command palette, the quick switcher, the ⋯ menu, a context menu, the move, delete, template and capture dialogs, the phone's tab switcher and drawer, a kanban board, a drawing, a spreadsheet (advisory), and every sidebar panel (files, search, bookmarks, tags, recent files, properties, backlinks, outline, history, local graph).

## How it is checked

### In `npm test` (CI)

- **`src/a11y.test.tsx`**: renders the whole app over the in-memory mock API in jsdom and runs axe-core on a note, settings, trash and search at desktop and phone widths, on the command palette and quick switcher, and on the phone drawer (with its Tab trap and `Esc`). It also checks the skip link and the editor's accessible name.
- **`src/styles/contrast.test.ts`**: every theme token pair (text on every background, syntax colours on code, text on accent and error fills, focus ring and field borders, callout titles) against WCAG's ratios. Changing a colour so that a pair fails breaks the test.
- **`src/features/focus.test.ts`**, **`src/components/layout/keyboard.test.tsx`**, **`src/habits/ui/Heatmap.test.tsx`** and **`src/components/overlays/Toasts.test.tsx`**: the Tab trap, menu arrow keys, focus return, the panel tabs' and the heatmap's roving tabindex, context menus, the phone's ⋯ menu, and toasts that wait while focused, each with axe.
- `src/test/axe.ts` is the helper: `await axeViolations(root, { page })` returns one line per violation. jsdom has no layout, so contrast, target sizes and reflow are left to the browser audit.

### `npm run test:a11y` (a real browser)

`frontend/scripts/a11y-audit.mjs` starts Vite with the mock API on port 5149, drives an installed Chrome or Edge through playwright-core and runs axe-core (`@axe-core/playwright`) on every screen listed above, in both themes, at 1280 × 800 and on a 375 × 812 touch phone. It also checks, without axe:

- `Esc` closes each overlay and the focus does not end up on the page's body;
- `Tab` from the top of a note, the home page and settings only reaches visible elements, each with a focus indicator;
- at 320 CSS px wide (the phone pages, and the open drawer) nothing but two-dimensional content scrolls sideways.

It exits with 1 when it finds a WCAG violation or one of these problems. It also prints, without failing, axe's *best practices* (not WCAG requirements) and the *advisory* screens (the spreadsheet view and Excalidraw's own UI, see below). It needs a browser, so it is not part of CI; run it after changing the UI.

```powershell
cd frontend
npm run test:a11y                                    # everything (about 20 minutes)
npm run test:a11y -- --only note,palette,settings    # some screens (a name or a prefix)
npm run test:a11y -- --themes light --sizes phone    # one theme, one size (or --sizes tablet)
npm run test:a11y -- --url http://127.0.0.1:5149     # a server that is already running
npm run test:a11y -- --verbose                       # with axe's explanation of each finding
```

`A11Y_BROWSER=chrome|msedge|chromium` picks the browser (`chromium` needs `npx playwright install chromium`); `A11Y_PORT` changes the port. The few `/api` calls the mock does not cover are answered in the browser (404), so the audit never reaches a backend through Vite's proxy.

### By hand

Before a release that changes the UI: a keyboard-only pass (no mouse) through the screens above; the browser zoomed to 200 % and 400 %; the OS set to reduce motion; and VoiceOver on an iPhone (the Home-Screen app) over a note, the drawer, the bottom sheet and a dialog.

## What is in place

- **Structure.** Landmarks: `nav` for the ribbon and the left sidebar, `main` for the workspace, `complementary` for the right sidebar. Every page has one `h1` (a note's inline title, a page's title). Page titles name the note or page (`Welcome · Notes`).
- **Skip link.** "Skip to content" is the first Tab stop; it moves the focus into the active pane's editor (or its scroll area).
- **Keyboard patterns.** The file explorer is an ARIA tree (arrows, `Enter`, `F2`, `Delete`); sidebar panel tabs and workspace tabs are ARIA tab lists with a single Tab stop and `←/→`, `Home`, `End`; menus take `↑/↓`, `Home`, `End`, and `Esc` or `Tab` closes them; the palette and switcher are comboboxes over a listbox; the calendar month and the habit heatmaps are ARIA grids with a roving tabindex; a kanban card moves to another lane from its menu, not only by dragging. All shortcuts are in [DESIGN §6.14](DESIGN.md#614-keyboard-shortcuts-complete-v1-set); every command and its key is listed (and can be changed) in Settings › Hotkeys, and the palette shows each command's key.
- **Dialogs and overlays.** One `Modal` for every dialog: `role=dialog`, `aria-modal`, a label, a focus trap, `Esc`, focus returned to the opener (or to the active pane when the opener is gone). The phone drawer, the bottom sheet and the tablet sidebars are modal too: Tab stays inside, and what they cover is `inert`.
- **Names, roles, states.** Icon-only buttons have a name and a tooltip; toggles are `role=switch`; expandable things have `aria-expanded`; the selected tab, row or option is marked. Every CodeMirror editor is named ("Note text", "Table cell", …). A button that shows text has a name that starts with it.
- **Live regions.** Each document's save status (`role=status`; the status bar's summary stays quiet, so a save is announced once), toasts (polite), the desktop connection indicator (polite), the offline banners (`status`), the conflict banner and form errors (`alert`), and "Opened …" after a pointer navigation. A toast waits while the pointer is over it or the focus is in it, so Undo can be reached in time.
- **Forms.** Every field has a label; settings fields are described by their row's description and error; errors are announced and marked `aria-invalid`.
- **Contrast and colour.** The theme tokens meet AA (see [§6.17](DESIGN.md#617-theming)). Links in notes are underlined, unresolved ones dashed, so colour is never the only cue.
- **Focus.** A 2 px `--focus-ring` outline on every focusable element; fields get a ring around their border; the inline title gets a line under it.
- **Motion.** Reduced motion ends transitions and animations at once.
- **Zoom.** No `maximum-scale`; layouts reflow down to 320 px; text inputs are 16 px on phones so iOS does not zoom.
- **Targets.** 24 × 24 px minimum (2.5.8), 44 × 44 px under `(pointer: coarse)` (DESIGN §6.16).

## Known gaps

**Spreadsheets (`views/sheet`, owned by the sheets work package; not changed here).** Findings for that work package, from the audit and a keyboard and DOM check of a new spreadsheet (2026-11-02):

- **The grid is invisible to screen readers.** Glide Data Grid draws on a `<canvas>` and normally renders an accessible table (`role=grid` with `aria-rowcount`, `aria-selected` cells) inside it, but in the app the canvas has no children: focus lands on an unnamed, roleless `<canvas>`, and a cell's value is only reachable through the formula bar ("Contents of A1"). Find out why the accessibility tree is not rendered (its `experimental.disableAccessibilityTree` is not set, so look at the width the grid gets and at how the canvas is wrapped), and give the canvas a name ("Sheet1, spreadsheet").
- **Sheet tabs:** `.sheet-tab-list` is a `role=tablist` that also holds each sheet's "Actions for sheet …" button, which a tab list may not contain (axe `aria-required-children`). Put the menu button outside the tab list, or open the menu from the tab with `Shift-F10` like the workspace tabs (§6.19).
- **Toolbar:** `role=toolbar` with every button a separate Tab stop (15 of them before the grid); the toolbar pattern wants one Tab stop and the arrow keys.
- **Colour:** `styles/sheet.css` line 375 colours the selected number format's text with `--interactive-accent`, which is a fill colour and below 4.5:1 as text in the dark theme; it should be `--text-accent` (DESIGN §6.17). Line 58 (a pressed toolbar icon) is fine at 3:1.
- The browser audit lists the sheet screen as *advisory*: `npm run test:a11y -- --only sheet --verbose` shows the current findings.

**Drawings (Excalidraw, a third-party package).** Its menu button (`.main-menu-trigger`) has no accessible name. While a drawing is open on a touch device the app adds `maximum-scale=1` to the viewport (DESIGN §6.8.1) so iOS does not zoom into Excalidraw's small text editor; iOS Safari ignores the limit for pinch gestures, so the page can still be zoomed there, but axe reports it (WCAG 1.4.4), and a browser that honours it would block zooming on that screen. The drawing screen is *advisory* in the audit. A drawing itself has no text alternative.

**Elsewhere:**

- **Note text is one text box.** CodeMirror exposes a note as a single multi-line `textbox`, so a screen reader cannot jump between a note's headings, lists or links the way it can on a web page, and Live Preview widgets (rendered tables, embeds, math) are read as their text. The Outline panel lists the headings as buttons, and choosing one scrolls the note to it.
- **Canvases** are pointer-first. The board is one `role=application` with keys for the selection (select all, arrows to nudge, `Delete`, `Enter` to edit a single selected card, undo, zoom), but one card cannot be selected without a pointer, and cards and their connections are not described to screen readers.
- **The graph view** is a picture (`role=img`, named with its number of notes and links) that the keyboard can pan and zoom, but opening a note from it needs a pointer, and its nodes are not listed; the same links are in the Backlinks panel and in each note.
- **The graph layout animates** for a few seconds after it opens even with reduced motion (it is a layout settling, not decoration; WCAG 2.3.3 is AAA).
- **Saving is announced** ("Saving…", "Saved") politely after each pause in typing; with a screen reader this can be chatty. A setting to announce only problems would help.
- **Encrypted notes' passphrase fields** set `autocomplete="off"` on purpose (the passphrase should not be stored by the browser). Pasting works, so a password manager can still be used (WCAG 3.3.8).
- **Property values** in the properties table look like text until focused (Obsidian's style); they show a border on hover and focus but none at rest.
- **Not verified on a real device:** VoiceOver on the iPhone app (rotor navigation, the drawer and sheet as modal dialogs, the bottom sheet's drag handle, which has no keyboard or VoiceOver equivalent other than `Esc` and the close gesture), and Windows High Contrast (forced colours) mode.
