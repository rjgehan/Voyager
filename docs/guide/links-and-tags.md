# Links, backlinks and tags

Links turn separate notes into a web you can walk through. A link to a note that does not exist yet is fine: it becomes that note the first time you follow it.

## Link to a note

1. Type `[[` (phone: the `[[ ]]` button on the keyboard bar).
2. Start typing the note's name. A list of matching notes appears, recent ones first; names a note is also known by (its aliases) are found too.
3. Press `Enter`, or tap the note.

The link shows as the note's name. To show other words instead, write them after a `|`: `[[Plan|the plan]]`.

- **A heading of a note**: after the name, type `#` and pick the heading: `[[Plan#Risks]]`. In the same note, start with `[[#`.
- **One paragraph or list item**: type `[[Plan#^` and pick the block from the list. Voyager gives that block a short id (like `^a1b2c3`) so the link keeps finding it.
- **A note that does not exist yet**: just type its name. The link shows dimmed until the note exists.

## Follow a link

- **Computer**: `Ctrl`+click the link, or put the cursor on it and press `Ctrl+Enter`. A plain click puts the cursor in the link so you can edit it: the whole link then shows as typed, so you can change where it goes.
- **Phone**: tap the link. To edit it instead, long-press it, or put the cursor next to it and use the arrow keys.
- **Back and forward**: the arrows at the top left of the note, or `Ctrl+Alt+←` and `Ctrl+Alt+→`.

Following a link to a note that does not exist creates it (in the folder set in **Settings › Files and links**) and opens it.

To open a link in a new tab instead, `Ctrl+Shift`+click it, or middle-click it (see [Tabs and split panes](tabs-and-splits.md)).

## Show one note inside another

Put a `!` in front of a link to show the other note's content in place: `![[Meeting notes]]`. It works for headings and blocks too (`![[Plan#Risks]]`, `![[Plan#^a1b2c3]]`), and for images, PDFs, audio, drawings, spreadsheets, canvases and task lists. Type `/embed` to pick a file.

An embedded note is shown, not copied: change the original and every embed follows. Click the embed's title to open the original, or the `</>` button to edit the embed's link.

## Renaming and moving keep links working

Rename a note (click its title) or move it to another folder, and every link to it in the vault is updated. The **Move to…** dialog says how many notes will change before you confirm; a drag-and-drop move shows a message with **Undo**.

If you change a heading's text, Voyager offers to update the links that pointed at the old heading. You can also do it on purpose: put the cursor in the heading and run **Rename heading and update links to it…** from the palette.

## Backlinks: what links here

The **Backlinks** tab in the right sidebar (phone: **⋯ › Backlinks**) lists every note that links to the open note, each with the line that holds the link.

- **Linked mentions** are real links.
- **Unlinked mentions** are places where another note mentions this note's name without linking to it. **Link** turns a mention into a link.
- **Linked blocks** lists the paragraphs of this note that other notes link to.

The status bar on a computer shows the number of backlinks of the open note.

## Outline

The **Outline** tab (phone: **⋯ › Outline**) lists the open note's headings. Click one to jump to it. The star next to a heading bookmarks it.

## Tags

A tag is a word with `#` in front: `#idea`, `#project/alpha`. A `/` nests tags, so `#project/alpha` also counts as `#project`.

- Type `#` and pick a tag from the list (phone: the `#` button on the keyboard bar).
- Tags can also go in a note's **tags** property.
- Click or tap a tag to search for every note with it.
- The **Tags** tab in the left sidebar lists every tag with the number of notes that use it.

## Graph

- **Graph** in the ribbon (phone: the drawer) shows every note as a dot and every link as a line. Click a dot to open the note. The settings on the page filter by search, tags, folders and attachments, colour groups of notes, and change how the graph looks and moves. Drag to move around; scroll or pinch to zoom.
- **Local graph** in the right sidebar (phone: **⋯ › Local graph**) shows only the notes around the open note. The slider sets how many steps away to look.

## Link style

**Settings › Files and links** decides how new links are written: as `[[wikilinks]]` (the default) or as Markdown links `[text](note.md)`, and with the shortest name, a relative path or the full path. Both kinds of link work everywhere, and Obsidian reads both.
