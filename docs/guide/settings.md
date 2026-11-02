# Settings

Open Settings with **Settings** at the bottom of the ribbon (phone: at the bottom of the drawer), `Ctrl+,`, or **Open settings** in the palette.

Most settings belong to the **vault** and apply on every device. **Hotkeys** and **This device** belong to the device you change them on, so your phone and your PC can differ. Changes save by themselves.

## Files and links

- **Default location for new notes**: the top of the vault, the same folder as the note you are in, or a folder you name.
- **New link format**: how links are written: the shortest name that is unique (the default), a path relative to the note, or the full path in the vault.
- **Use [[Wikilinks]]**: off writes Markdown links, `[text](path.md)`, instead.
- **Automatically update internal links**: rewrite links when a note is renamed or moved (on by default).
- **Default location for attachments**: where pasted and dropped files go: the `Attachments` folder (by default), the top of the vault, the note's folder, or a subfolder of the note's folder.
- **Excluded files**: folders or files (one per line) left out of search, unlinked mentions, the graph and Ask your vault.

## Daily notes

The **date format** of daily notes' names, their **folder**, their **template** and whether to **open today's daily note on startup**. See [Calendar and daily notes](calendar-and-daily-notes.md).

## Templates

The **template folder**, the formats of `{{date}}` and `{{time}}`, and **Folder templates** (a template for each folder). See [Templates](templates.md).

## Editor

- **Readable line length**: keeps lines at a comfortable width on wide screens.
- **Strict line breaks**: how single line breaks show in notes embedded in other notes. A note itself always shows its lines as you typed them.

## Hotkeys

Every command with its key on this device. Filter the list by name or key, then **Change** a key (press the new combination), **Remove** it, or **Reset** it to the default; **Reset all** starts over. See [Keyboard shortcuts](keyboard-shortcuts.md#change-a-key).

## Quick capture and Web clipper

How to set up capturing and clipping from other apps: the iPhone Shortcuts (step by step, with values to copy), the bookmarklet, and the browser extension. Captures the server refused are listed here too. See [Quick capture and the web clipper](capture-and-clipper.md).

## Ask and summaries

Switches [Ask your vault](ask-your-vault.md) on or off (it is off by default), and sets the provider, the model, the folders that are never sent, how much text one request may carry, and the monthly budget.

## Reminders

Which ways reminders reach you (Web Push, ntfy, in the app), this device's subscription, tests for each way, and the daily-note nudge. See [Reminders](tasks-and-reminders.md#reminders).

## Publishing

Publishing puts a read-only copy of a note on a public web address, for people outside your private network. It is **off** unless whoever runs the server turns it on; until then, **Publish to the web** (the globe at the top of a note, or the ⋯ menu) only says so. When it is on, this section lists the published notes.

## Vaults

Your vaults, and creating a new one. See [Multiple vaults](vaults.md).

## This device

| Setting | Does |
|---|---|
| **Theme** | Dark, Light, or Follow the system |
| **Markdown syntax** | **Hide all** keeps marks like `**` and `#` hidden; **Reveal at cursor** shows them around the cursor |
| **Spell check**, **Autocorrect** | The device's spelling help (on the iPhone, Autocorrect also controls smart quotes) |
| **Load remote images** | Off: pictures from other websites wait for a tap |
| **Scripts in notes** | Run, ask first, or show as code (see [Scripts and queries](scripts-and-queries.md)) |
| **Vim key bindings** | Vim keys in notes, on a computer with a keyboard (the status bar shows the mode; `:w` saves) |
| **Keep recent notes for offline reading** | A copy of your last 100 opened notes on the device |
| **Transcribe voice notes** | Whether new recordings are written out, when the server can |
| **Lock encrypted notes after**, **…when the app is hidden** | See [Encryption](encryption.md#locking) |
| **Recently discarded edits** | Text this device set aside without saving, kept 7 days |

## About

The version of the app and of the server, facts about the vault and its history, and links to:

- **User guide**: this guide. (**Help and user guide** at the end of the list of sections goes there too.)
- **Status page**: whether the server is healthy: uptime, history, disk space, the last backup and alerts. Useful when something seems wrong; see [Troubleshooting](troubleshooting.md).
- **Compatibility report**: for a vault brought over from Obsidian, which of its settings, plugins and syntax work here and what to do about the rest. It can also apply Obsidian's settings.
