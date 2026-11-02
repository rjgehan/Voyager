# Search and bookmarks

## Open a note by name

The quickest way to any note is the **quick switcher**: press `Ctrl+O` (phone: the magnifier in the top bar), type a few letters of the name, and press `Enter`. Letters can be anywhere in the name, so `wkrev` finds "Weekly review". With nothing typed it lists the files you opened recently, with a star on bookmarked ones.

- `Enter` opens the note; `Ctrl+Enter` opens it in a new tab.
- If nothing matches, the last row is **Create "…"**: `Enter` on it (or `Shift+Enter` at any time) creates a note with exactly that name.

## Search inside every note

Press `Ctrl+Shift+F`, or open the **Search** tab of the left sidebar, and type. Results list each matching note with the lines that match; click a line to open the note right there, with your words highlighted.

- **Phone**: tap the magnifier in the top bar, type what you are looking for, and choose **Search in notes for "…"** at the bottom of the list; or use the **Search** tab of the drawer.
- Search also looks inside spreadsheets, drawings, canvases, task lists and the text of PDFs. A PDF result opens the PDF at the right page.
- **Sort** results by **Relevance** or **Modified** (newest first).
- A misspelt word also finds the words it was probably meant to be; the search says which, and **Exact words only** turns that off.
- To search within one note, use `Ctrl+F` in the note instead.

### Search syntax

Words you type must all appear (in any order). Add these to narrow things down:

| Type | Finds |
|---|---|
| `meeting notes` | Notes with both words |
| `"weekly review"` | The exact phrase |
| `-draft` | Leaves out notes with this word |
| `apples OR pears` | Either word (`OR` in capitals) |
| `(apples OR pears) recipe` | Brackets group words |
| `tag:#project` | Notes with this tag (or a tag nested under it) |
| `path:Daily` | Notes whose folder or name contains "Daily" |
| `file:plan` | Notes whose file name contains "plan" |
| `[status]` | Notes that have the property `status` |
| `[status:done]` | Notes whose `status` contains "done" (`[status:"done"]` for exactly "done") |
| `line:(milk eggs)` | Both words on the same line |
| `section:(budget 2026)` | Both words under the same heading |
| `/\d{4}-\d{2}/` | A regular expression, for the technically minded |

Combine them freely: `tag:#work "weekly review" -draft`.

Folders listed under **Settings › Files and links › Excluded files** are left out of search.

## Bookmarks

Bookmarks keep notes, headings, folders and searches you use often one click away. They are shared by all your devices.

**Bookmark something:**

- **The open note**: the star at the top right of the note (computer), **⋯ › Bookmark** (phone), or **Bookmark current file** in the palette.
- **A heading**: the star next to the heading in the **Outline** tab, or put the cursor under the heading and run **Bookmark heading at cursor**.
- **A file or folder**: **Bookmark** in its menu in the Files tab, or drag it onto the Bookmarks tab (computer).
- **A search**: type the search, then click the star next to the number of results (or run **Bookmark current search**). Opening that bookmark runs the search again, so it is always up to date. This is how a search is kept: there is no separate list of saved searches.

**Use them:** the **Bookmarks** tab of the left sidebar (phone: the drawer). Click a bookmark to open it.

- **Groups**: **New group** at the top of the tab (or **Create new bookmark group** in the palette) makes a folder for bookmarks. Drag bookmarks into it on a computer, or use **Move to "…"** in a bookmark's menu. Groups fold and unfold; **Collapse all groups** folds them all.
- Each bookmark's menu (right-click; on the phone, long-press or **⋯**) can rename it, move it up or down or out of its group, and remove it.
- A bookmark follows its note when the note is renamed or moved. A bookmark whose note was deleted is shown struck through, and comes back to life if the note is restored from the trash.
- To remove the bookmark of the open note, click the star again (phone: **⋯ › Remove bookmark**).

Bookmarks are saved in the vault in the same format as Obsidian's, so they carry over in both directions.

## Recent files

The **Recent files** tab of the left sidebar lists the files you opened on this device, newest first, with when you opened them. Each row's menu can bookmark it or take it off the list; the button at the top clears the list (no file is touched). Recent files are per device: your phone and your PC each keep their own.
