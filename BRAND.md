# Voyager

<img src="docs/images/icon.svg" width="128" height="128" alt="Voyager's icon: a pale blue dot in a sunbeam">

The app is called **Voyager**. The two Voyager probes left Earth in 1977 and are still sending data
home, almost fifty years later, from beyond the edge of the solar system. That is what this app is
for: notes that last. They are plain files on your own server, with every version kept, readable
by any editor long after any particular app is gone.

The name carries three ideas, in this order:

1. **Built to last.** Like the probes, which outlived every plan made for them. Plain Markdown and
   JSON files, full git history, nothing locked in a database or a company's cloud.
2. **Your own Golden Record.** Each probe carries a gold-plated record of what mattered to the people
   who sent it. Voyager is yours: notes, sheets, drawings and tasks in one place.
3. **It goes with you.** On the PC and on the iPhone, live, and in the tray of the desktop app.

It replaces the working name **NotesApp** (renamed 2026-11-03, ROADMAP item 45), which described
the app but could never be anyone's, and which no longer fit an app that is as much spreadsheets,
drawings and tasks as notes.

- **App name:** `Voyager` (the installed web app, the Home Screen label, the desktop app, the
  Windows Start menu, the CasaOS dashboard)
- **Browser tab:** `<page> · Voyager`, `<page> · <vault> · Voyager` in a second vault,
  `Shared · Voyager` on a share page, `Voyager demo` for the live demo
- **Companions:** `Voyager clipper` (the browser extension), `Voyager desktop 1.1.0` (the tray's
  version line), `Voyager Backup` and `Voyager Whisper` (the CasaOS add-on apps)
- **Suggested iPhone Shortcuts:** `Add to Voyager`, `Clip to Voyager`
- **One-line explainer** (manifest, CasaOS, link previews): *Your notes, sheets, drawings and tasks
  in one place: plain files with full history, on every device of your tailnet.*
- **Pitch** (README, social preview): *Your notes, sheets, drawings and tasks, built to last and
  with you on every device.*

## The voice

Voyager talks the way its documentation does: plainly, calmly, and to the point.

- **Say what happens.** "Saved", "Can't reach Voyager. Is Tailscale connected?", "This list was
  written by a newer version of Voyager and is read-only here." The message says what is true and
  what to do next; it never apologises, jokes or shouts.
- **Short sentences, everyday words, second person.** "Your notes", never "the user's data". No
  exclamation marks, no emoji in the interface.
- **The space story stays in the name and the icon.** No "launch", "mission control", "liftoff" or
  "houston" in the interface or the docs: a notes app that makes space puns gets old fast. The one
  place the story is told is here, the README's *Why "Voyager"* and the social preview.
- **Writing the name:** `Voyager`, capital V, the rest lower case. Not "VOYAGER", not "the Voyager
  app", not "Voyager Notes". In running text the app is "Voyager"; when the sentence is about the
  program rather than the product, "the app" is fine ("the app keeps a copy for offline use").
- **Spelling:** British, as in the rest of the repository (licence, colour, behaviour), except in
  code and in names that come from elsewhere.

## Colours

The rename keeps the interface's colours: the purple accent **#8a5cf5** and the tokens in
[`frontend/src/styles/tokens.css`](frontend/src/styles/tokens.css) (named after Obsidian's, so theme
snippets port; every text colour passes WCAG 2.2 AA, checked by `contrast.test.ts`). The ones that
make the brand:

| Token | Dark theme (default) | Light theme | Use |
| --- | --- | --- | --- |
| Brand purple (`--blockquote-border`) | `#8a5cf5` | `#7a4fe0` | The brand colour: the icon's glow, quotes, the README's badges and chips; the base of the selection and tag tints |
| `--interactive-accent` | `#8352f4` | `#7a4fe0` | Fills under white text: buttons, the cursor, selections |
| `--text-accent` | `#aa89f8` | `#6b3fd8` | Text in the accent colour |
| `--tag-fg` | `#b9a2fb` | `#6b3fd8` | Tags, the soft lavender of the chips |
| `--background-primary` | `#1e1e1e` | `#ffffff` | The page (and `theme-color`, so the iPhone's status bar matches) |

Dark is the default theme. The icon adds the space palette below; it is for the icon and the images
around it (the social preview), not for the interface.

## The icon

<img src="frontend/public/icon-512.png" width="160" alt=""> <img src="frontend/public/favicon.svg" width="48" alt="">

**The pale blue dot.** On 14 February 1990, Voyager 1 turned its camera back towards home and
photographed Earth from six billion kilometres away: a speck less than a pixel wide, caught in a
band of scattered sunlight. The icon is that picture, simplified: deep space, one soft diagonal
sunbeam, and in it, a little right of centre, a small bright pale-blue dot with a gentle glow.

| | |
| --- | --- |
| Space | Gradient from top left to bottom right: `#06051a`, `#110c36`, `#2a1872`, `#4b2bb5` |
| Glow | The accent `#8a5cf5`, rising from the bottom-right corner (55% at the corner, fading out across the middle) |
| Sunbeam | Warm white `#fff6ec` at 23% in the middle of the beam, fading to nothing at its edges and towards the bottom; 25° from vertical, from the top right |
| Dot | White `#ffffff` at its centre to pale blue `#9fd2ff` at its edge, in a halo of `#cfe9ff` |
| Stars | Six, `#e9e4ff` at about 30 to 45%, too faint to survive below about 120 px (on purpose) |

Why it looks like this: most notes apps' icons are a page, a pencil, a notebook or a letter on
a flat colour (the old NotesApp icon was a purple page). A picture of a place is rare, it says
"built to last" without a word, and the dot is one shape that stays a dot at any size.

**Two drawings.** At 64 px and above the icon is drawn from `voyager.svg`. From 48 px down a dot
4% of the width would vanish, so `voyager-small.svg` widens and brightens the beam, makes the dot
bigger (17% of the width, with its halo) and drops the stars. Both have the same space, beam angle
and dot position, so they read as one icon. The favicon, the tray icon, the clipper's 16 to 48 px
icons and the small Windows icon sizes are the small drawing.

**Using it.**
- On its own tile, never cropped, recoloured, rotated or outlined, and never with text over it.
- Rounded tile (corner radius 22.5% of the side) in browsers, the README, Windows and macOS; full
  bleed where the platform rounds or masks it (the iPhone's Home Screen, Android's maskable icon).
  The dot stays well inside a maskable icon's 80% safe zone.
- Under 64 px use the small drawing; never shrink the large one to a favicon.
- Next to the name, the icon goes on the left, as tall as the name's capital letters or a little
  taller (the README, the social preview, the desktop app's first-run page).
- On a light page, give it room: the tile is dark and needs no border.

**Files.** The drawings are in [`scripts/brand/`](scripts/brand) (`voyager.svg`, 1024 full bleed;
`voyager-small.svg`, 64). Edit those, then render everything again:

```sh
cd e2e && npm ci && cd ..                      # once: the scripts use e2e's Playwright
node scripts/brand/render-icons.mjs --preview icon-preview.png
node scripts/brand/render-images.mjs           # with the demo build served on :5230 (the script says how)
```

`render-icons.mjs` draws each size on a canvas in headless Edge or Chrome and writes every icon the
apps ship: `frontend/public/` (favicon.svg; apple-touch-icon.png, 180, opaque RGB, because iOS
paints transparency black; icon-192 and icon-512 on the rounded tile; icon-maskable-512 full
bleed), `docs/images/icon.svg`, the desktop app's `build/icon.png` (1024), `build/icon.ico` and
`src/pages/icon.ico` (16 to 48 px from the small drawing, 64 to 256 from the large one),
`src/pages/icon.png` and `icon-small.png`, and the clipper's 16, 32, 48 and 128 px icons. No image
library and no new dependency. `render-images.mjs` renders the social preview (1280×640, the
repository's and the live demo's link preview) and the two README screenshots that show the name.
The demo vault's `Attachments/voyager-logo.svg` is a copy of `docs/images/icon.svg`.

## What keeps the old name

Only what people read was renamed. Identifiers that something depends on keep `notesapp`, because
renaming any of them would break the live server, an installed app or the data:

| Kept | Why |
| --- | --- |
| The image `ghcr.io/rjgehan/notesapp`, the containers (`notesapp`, `notesapp-backup`, …), `/DATA/AppData/notesapp` | Watchtower updates the running server by the image's name; CasaOS and the backups know the containers by theirs |
| `NOTES_*` environment variables, `notes.*` settings keys, API paths | The server's configuration and every client |
| The vault's `.notesapp/` folder, the `notesapp-sheet` and `notesapp-tasks` file types | The user's data |
| `notesapp:*` local-storage keys, `notesapp-*` service-worker caches, the `notesapp` IndexedDB database | A new name would wipe each device's settings, offline notes and unsent edits |
| `notesapp-clip-*` messages, the clipper's Firefox id `clipper@notesapp.rjgehan.github.io` | An older extension and a newer server (and the reverse) keep working; Firefox keeps the add-on |
| The desktop app's id `com.rjgehan.notesapp.desktop` | The installer finds NotesApp by it and replaces it in place; Windows' taskbar and notifications know the app by it |
| The desktop app's user-data folder `NotesApp` on a computer that had it | Its settings and web storage are there (`desktop/src/userData.js`) |
| The git committer `NotesApp <notesapp@notes>` | It authors the app's own commits in every vault's history; a second name would split the timeline's author filter |
| The repository `rjgehan/notesapp`, the demo at `rjgehan.github.io/notesapp/`, Java packages, the Maven artifactId, npm package names | Links, the Pages URL and the build |

## Still to do by hand

- **iPhone:** a Home Screen app added before the rename keeps the label *Notes* and the old icon;
  iOS never refreshes a web app's name or icon. Check that it says everything is saved, delete it
  from the Home Screen and add it again from Safari (the guide's *Phone tips*). Then subscribe it
  to reminders again if it had Web Push.
- **Windows:** install `Voyager-Setup-1.1.0.exe` once; it replaces NotesApp and keeps its settings.
  Re-pin it to the taskbar if NotesApp was pinned (DESKTOP.md, *Updating from NotesApp*).
- **GitHub:** upload `docs/images/social-preview.png` in the repository's Settings › Social preview,
  and use "Voyager" as the repository's description if you like. The repository's name stays.
- **CasaOS (optional):** paste `deploy/casaos-compose.yml` again to see the new title, description
  and icon in the dashboard; the app itself updates through Watchtower either way.

## A note on the name

"Voyager" is a common word and many products use it. No trademark screening was done: this is a
self-hosted app for one household, not a store listing. Before publishing it under this name (an
app store, a hosted service), get a proper clearance search for note-taking and productivity
software.
