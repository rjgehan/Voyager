# Writing

Every note opens in one view that you both read and edit in. Headings look like headings, checkboxes are real checkboxes and tables are grids, and you change any of it by clicking (or tapping) on it. There is no separate reading mode or edit mode to switch between.

Behind the scenes a note is plain Markdown text, so it also opens in Obsidian or any text editor. You never have to type Markdown yourself, but if you know it, typing it works too.

## Format text

Select some text and use a key, the toolbar or the phone's keyboard bar:

| Format | Key |
|---|---|
| Bold | `Ctrl+B` |
| Italic | `Ctrl+I` |
| Strikethrough | `Ctrl+Shift+X` |
| Highlight | `Ctrl+Shift+H` |
| Inline code | `Ctrl+E` |
| Link | `Ctrl+K` |

- **On a computer**, selecting text with the mouse shows a small toolbar above it: bold, italic, strikethrough, highlight, inline code, link and a heading menu.
- **On the phone**, the bar above the keyboard has bold, italic, heading, list, checkbox, link, table, inline code and more. Swipe it sideways to see every button.
- **With nothing selected**, press the key first and then type: `Ctrl+B`, then the words, then `Ctrl+B` again to stop. A faint **B** after the cursor shows that bold is on.
- Typing `*`, `_`, `~`, `=` or a backtick over selected text wraps it: two `*` make it bold, two `=` highlight it.

## Headings, lists, checkboxes and quotes

Type these at the start of a line and they turn into what they stand for as soon as you press the space:

| Type | You get |
|---|---|
| `# ` to `###### ` | A heading, large to small |
| `- ` or `* ` | A bulleted list |
| `1. ` | A numbered list (the numbers keep themselves in order) |
| `[] ` | A checkbox. Click or tap the box to tick it, or press `Ctrl+L` on its line |
| `> ` | A quote |
| `---`, then `Enter` | A dividing line |

- `Enter` continues a list; `Enter` on an empty item ends it. `Tab` and `Shift+Tab` indent and outdent an item (phone: the indent buttons on the keyboard bar).
- The phone's heading button cycles a line through normal text, heading 1, 2, 3 and back.
- `Alt+↑` and `Alt+↓` move the current line up and down; `Shift+Alt+↓` duplicates it.

## The / menu: insert anything

Type `/` at the start of a line (or after a space) to open a menu of everything you can insert: headings, lists, a checklist, quotes, callouts, tables, a divider, code blocks, math, diagrams, links, embeds, today's date or the time, a template, an image or file, a new drawing, spreadsheet or canvas, encrypted text, a voice note, a task, a property, and [script and query blocks](scripts-and-queries.md).

Keep typing to filter it: `/h2`, `/table`, `/todo`, `/python`, `/today`. Arrow keys choose, `Enter` inserts, `Esc` closes the menu and keeps the `/`. On the phone, the **/** button at the left of the keyboard bar opens the same menu.

## Code

**A word or two of code inside a sentence**: select it and press `Ctrl+E` (phone: the `</>` button on the keyboard bar), or type it between backticks, like `` `print()` ``.

**A block of code**, with colours for its language:

1. On an empty line, type three backticks and the language name, for example ` ```python `.
2. Press `Enter`. The block is closed for you and the cursor is inside it.
3. Type or paste your code.

Or type `/code` and pick a language from the menu: JavaScript, TypeScript, Python, Java, Shell, JSON, YAML, SQL, HTML, CSS, Go, Rust, C#, C, C++ and Markdown are listed by name. For any other language, pick **Code block** and type its name right after the opening backticks.

Click into a code block to edit it: its first and last lines (the backticks and the language) show while the cursor is inside, and hide again when you leave. A link or tag inside code is just text.

## Links

Type `[[` and start typing a note's name to link to it. Everything about links, backlinks and tags is on its own page: [Links, backlinks and tags](links-and-tags.md).

For a web link, select the text and press `Ctrl+K`, then paste the address. Pasting a web address over selected text makes a link too.

## Callouts

A callout is a coloured box for a tip, a warning or a note. Type `/callout` and pick a kind (Note, Info, Tip, Warning, Danger, Success, Question, To do, Example, Quote, Abstract, Failure, Bug), then write inside it. A callout that starts folded opens with a click on its title.

In the text a callout is a quote whose first line names its kind, which is also how to write one by hand:

```markdown
> [!tip] Optional title
> The text of the tip.
```

Write `[!faq]-` to make it start folded, `[!faq]+` to make it foldable but open.

## Math and diagrams

- **Math**: type it between dollar signs, `$e^{i\pi} + 1 = 0$`, and it shows typeset. For a formula on its own lines, use `/math`.
- **Diagrams**: `/mermaid` inserts a Mermaid diagram block. Describe the diagram in text (`graph LR`, then `A --> B`) and it draws as soon as the cursor leaves the block.

Click a formula or a diagram to see and edit its text.

## Images and files

- **Paste or drop** an image (or a PDF, or any file) into a note. It is uploaded to the vault and shown where the cursor was.
- **Phone**: the image button on the keyboard bar picks photos from your library or camera.
- `/image` and `/attachment` (or **Insert attachment…** in the palette) pick a file.

Where uploaded files go is set in **Settings › Files and links › Default location for attachments**. To change an image's size, click it: its text shows, and you can add a width after a `|`, as in `![[photo.jpg|300]]`. Audio, video and PDFs play or show right in the note.

## Properties

Properties are facts about a note, such as its tags, a due date or a status, shown in a box at the top. Press `Ctrl+;` (or use `/property`, or **Add file property** in the palette) to add one, give it a name, and fill in the value.

- Each property has a type, shown by its icon: text, list, number, checkbox, date, date and time, tags or aliases. Click the icon to change the type, rename the property, move it or remove it. The type applies to that property in every note.
- Dates use your device's date picker; tags and lists add an item on `Enter`.
- A number can use a comma for its decimals (`3,5`). Something that is not a number stays in the field, outlined as invalid, until you correct it or press `Esc`.
- The **Properties** tab of the left sidebar lists every property in the vault with how many notes use it. From there you can rename a property in every note at once (also **Rename property in every note…** in the palette).
- Search for notes by property with `[status]` or `[status:done]` (see [Search](search-and-bookmarks.md#search-syntax)).

In the file, properties are the YAML lines at the top of the note, between two `---` lines. The `</>` button on the properties box shows them as text, for anything the editor cannot show.

## Highlights, footnotes and hidden comments

- `==highlighted text==` is highlighted (`Ctrl+Shift+H`).
- A footnote: type `[^1]` where it belongs and `[^1]: The footnote text.` at the end of the note. It shows as a small number; hover over it or tap it to read it.
- `%%a comment%%` is hidden. A small `%%` marker shows where it is; click it to read or edit the comment.

## Fold, find and replace

- **Fold a section**: click the arrow that appears left of a heading (on the phone it is always there, faintly), or press `Ctrl+Shift+[` to fold and `Ctrl+Shift+]` to unfold the section the cursor is in. **Fold all headings** and **Unfold all headings** are in the palette. Folds are not saved with the note.
- **Find and replace in the note**: `Ctrl+F`. To search every note, see [Search](search-and-bookmarks.md).

## Pasting from web pages, Google Docs and Word

Pasting keeps the formatting: headings, bold and italic, lists, links, tables, checklists and code all arrive as the same things here. To paste plain text without any formatting, press `Ctrl+Shift+V`.

## Undo

`Ctrl+Z` undoes and `Ctrl+Shift+Z` (or `Ctrl+Y`) redoes, also after you switch to another note and back. On the phone the keyboard bar has Undo and Redo buttons. For older changes, see [History and trash](history-and-trash.md).

## When something looks wrong

If a note ever shows something oddly, open its **⋯** menu (computer: the **⋯** at the top right of the note; phone: **⋯** in the top bar) and choose **Show Markdown source**. You then see and edit the note's plain text. A bar above it has **Back to normal view**, and the next time you open the app every note is back to normal anyway. The palette has it too, as **Show Markdown source (toggle)**.

> [!TIP]
> By default the Markdown marks (`**`, `#`, `[[`) stay hidden even where you are typing. If you would rather see them around the cursor, choose **Reveal at cursor** under **Settings › This device › Markdown syntax**.
