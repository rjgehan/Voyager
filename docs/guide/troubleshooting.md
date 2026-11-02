# Troubleshooting and FAQ

## Writing

### How do I write code?

For a few words of code in a sentence, select them and press `Ctrl+E` (phone: `</>` on the keyboard bar). For a block of code, type three backticks and the language name on an empty line (` ```python `) and press `Enter`; or type `/code` and pick the language. See [Code](writing.md#code).

### The note shows `**`, `#` or `[[` marks, or looks scrambled

- If the marks show only around the cursor, **Settings › This device › Markdown syntax** is set to **Reveal at cursor**; choose **Hide all** to keep them hidden.
- If the whole note shows as plain text with a bar above it, it is in **Show Markdown source**: click **Back to normal view** in that bar.
- If one part shows wrongly, the Markdown there may be broken. Open **⋯ › Show Markdown source** to see and fix the text, then go back. The [Writing](writing.md) page shows what each element looks like as text.

### A table shows as lines of text, not as a grid

Only tables at the top level of a note become grids: a table inside a quote, a list item or a callout stays text. A table also needs its second line, the one made of dashes (`|---|---|`). The easiest way to get a correct table is `/table`.

## Formulas and spreadsheets

### How do I make something like a Google Sheet?

For a few numbers in a note (a budget, a shopping list with prices), use a table with formulas: [Tables and formulas](tables-and-formulas.md). For a real spreadsheet with tabs, number formats and charts, create a spreadsheet file: **Create new spreadsheet** in the palette, see [Spreadsheets](spreadsheets.md). Both use the same functions as Google Sheets.

### My formula shows `#NAME?`

A function was written without its brackets and cells, or the name is misspelt. `=SUM` alone is a name the formula does not know; write `=SUM(B2:B4)`. Click the cell: the formula bar above the table says what is wrong, and suggests a fix ("Did you mean SUM(…)?"). Easiest: type `=SU`, pick **SUM** from the suggestions, click (or tap) the first and last cell, and type `)`. See [When a formula shows an error](tables-and-formulas.md#when-a-formula-shows-an-error).

### My formula shows as text instead of a result

- The cell must start with `=` (no space before it).
- Inline formulas must be in backticks: `` `=1450*12` ``.
- Formulas compute only in the note itself: a note embedded in another note, and **Show Markdown source**, show them as typed.
- A table inside a quote or a list is not a grid, so its cells are not computed.
- The note may have the property `formulas: false`.

### I selected two cells but the formula only has the second one

On a computer, clicking another cell replaces the cell you just put in. To make a range, `Shift`+click the last cell, or drag across the cells. (On a phone, a second tap makes the range.)

## Finding things

### I can't find a note

- Try the quick switcher (`Ctrl+O`) with a few letters of the name, then a full search (`Ctrl+Shift+F`) for words in it.
- Folders listed under **Settings › Files and links › Excluded files** are left out of search.
- Check the **Trash**, and **Vault history › Deleted files** for notes deleted long ago. See [History and trash](history-and-trash.md).

### Where did saved searches go?

Searches are kept as **bookmarks**: type the search, then click the star next to the number of results. See [Bookmarks](search-and-bookmarks.md#bookmarks).

### Clicking a link made a new, empty note

The link's name did not match any note, so following it created one. Check the spelling, or type `[[` and pick the note from the list so the link is exact. Links that point nowhere show dimmed. If you did not want the new note, delete it; it goes to the trash.

## Sync and connection

### The app says I am offline

The dot next to the note's title (phone) or **Live** in the status bar (computer) shows the connection. NotesApp reaches your server through Tailscale, so check that **Tailscale is connected** on this device. While offline you can keep working in notes opened recently; your edits are saved when the connection returns.

### A change I made on another device does not show

Changes show within a second or two while both devices are connected. If one does not, check the connection dot; **⋯ › Reload** (phone) or reloading the page fetches everything again, and **Reload vault from server** in the palette does so without reloading.

### A banner says the note was changed on another device

Two devices changed the same note at the same time. Choose **Keep mine**, **Take theirs** or **Compare**; nothing is lost either way. See [When two devices disagree](history-and-trash.md#when-two-devices-disagree).

### "A new version is available"

The server was updated. Click **Reload** in the banner when it suits you; your unsaved edits are kept.

### "Unsaved changes are not protected on this device"

The browser does not let NotesApp keep edits on the device until they are saved (often a private window, or storage turned off for the site). Notes still save to the server, but an edit made while offline could be lost. Use a normal window.

## Keys

### `Ctrl+Alt+Q` types a character instead of adding a task

On a keyboard where AltGr+Q types a character (`@` on a German one, a backslash on a Czech one), Windows reports AltGr as `Ctrl+Alt`, so in a note or a text field that key types the character, as it should. Press it outside a text field, give **Add task (quick add)** another key under **Settings › Hotkeys**, or use `/task` in a note or **Add task** on the task pages. See [Change a key](keyboard-shortcuts.md#change-a-key).

### `Ctrl+Shift+T` reopened a browser tab

In a browser, that key belongs to the browser. Use **Reopen closed tab** from the palette, give it another key under Settings › Hotkeys, or use the [desktop app](desktop-app.md), where the key reaches NotesApp.

## Phone

### Pulling down does not reload

That is on purpose, so scrolling a note never reloads it. Use **⋯ › Reload**.

### Notifications do not arrive on the iPhone

Web Push on the iPhone needs iOS 16.4 or later, NotesApp [added to the Home Screen](phone.md#add-notesapp-to-the-home-screen), and **Subscribe this device** under **Settings › Reminders** (opened from the Home Screen app), with **Send by Web Push** switched on. The test button there sends a test notification.

## Other features

### A script or Dataview block shows its code

Check **Settings › This device › Scripts in notes**: **Off** shows the code, **Ask before running** shows a **Run** button. Blocks also show as code inside an embedded note.

### Pictures from websites do not show

Turn on **Settings › This device › Load remote images**, or tap the placeholder to load one picture.

### Ask your vault says it is not available

It must be switched on in **Settings › Ask and summaries**, and set up on the server by whoever runs it. The Ask view says which of the two is missing, or whether the month's budget is used up.

### Can I use NotesApp and Obsidian on the same notes?

Yes. The vault is a folder of ordinary Markdown files in Obsidian's format: links, embeds, tags, properties, callouts, canvases, Kanban boards, Excalidraw drawings, bookmarks and encrypted notes all work in both. For a vault brought over from Obsidian, **Settings › About › Compatibility report** lists what carries over and what does not.

### Is the server healthy?

**Settings › About › Status page** shows the server at a glance: problems first, then uptime, history, disk space, the last backup and alerts.
