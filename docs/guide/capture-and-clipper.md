# Quick capture and the web clipper

## Quick capture

Quick capture saves a thought, a link or a photo in a couple of seconds, without opening a note. It adds a line, with the time, to either:

- **Inbox**: the note `Inbox.md` at the top of the vault (made the first time), to sort out later; or
- **Today**: today's [daily note](calendar-and-daily-notes.md).

**Open it**: `Ctrl+Shift+Space` (it works while you type in a note too), the inbox icon in the ribbon, **Capture** in the phone's drawer, the **+** in the phone's top bar, or **Quick capture** in the palette. Type, pick **Inbox** or **Today** (the choice is remembered on the device), and **Save** (or `Ctrl+Enter`). Add photos with the **Photo** button: each becomes its own entry, with your text as the first one's caption.

Captures work offline: they wait on the device and are sent when the connection is back. If the server refuses one (for example, a photo that is too large), it is kept under **Settings › Quick capture** with **Copy**, **Try again** and **Discard**.

- **Desktop app**: `Ctrl+Shift+Space` (Mac: `Cmd+Shift+Space`) works from any program, not just NotesApp. See [Desktop app](desktop-app.md).
- **Sharing from other apps**: on Android, and with NotesApp installed from Chrome or Edge on a computer, NotesApp appears in the system's Share menu. The iPhone does not offer that to web apps, so instead set up the **Add to Notes** Shortcut: **Settings › Quick capture** (opened on the phone) lists every step, with values to copy. It then appears in the Share sheet of Safari, Photos and other apps.

## The web clipper

The web clipper saves a web page as a clean note in the `Clippings` folder: the article's text without menus and ads (or just the part you selected), with its title, address, author and date as properties and the tag `clippings`. You see a preview and can change the name before saving.

There are three clippers; **Settings › Web clipper** sets each one up:

| Clipper | Where | How to set it up |
|---|---|---|
| **Bookmarklet** | Any browser on a computer | Drag the **Clip to Notes** button from Settings › Web clipper to your browser's bookmarks bar. Click that bookmark on any page to clip it. |
| **Browser extension** | Chrome, Edge and Firefox on a computer | Installed by hand from the project's `clipper` folder: see [CLIPPER.md](https://github.com/rjgehan/notesapp/blob/main/docs/CLIPPER.md). It adds a toolbar button, a right-click menu and `Alt+Shift+K`, can clip just the selection, and can save the page's images in your vault. |
| **iPhone Shortcut** | Safari on the iPhone and iPad | Open Settings › Web clipper on the phone and follow the steps to make the **Clip to Notes** Shortcut. Then, in Safari, tap **Share › Clip to Notes**. |

Every clipper needs Tailscale to be connected, as the app does. Images in clipped pages stay links to the website (shown or not according to **Settings › This device › Load remote images**), unless the browser extension saved them.
