# Templates

A template is an ordinary note in your templates folder (`Templates` unless you changed it in **Settings › Templates**). Inserting it copies its text into a note, with placeholders such as the date filled in.

## Make a template

Create a note in the `Templates` folder and write what you want every copy to start with. For example, `Templates/Meeting`:

```markdown
---
tags: [meeting]
---
## Meeting {{date:dddd, D MMMM YYYY}}

- Attendees: {{prompt:Who is attending?}}
- Notes: {{cursor}}
```

## Use a template

- **Into the open note**: **Insert template** (the ribbon, **⋯ › Insert template** on the phone, the palette, or `/template` in the note). Pick the template; its text goes where the cursor is, and its properties are added to the note's (tags and other lists are combined).
- **As a new note**: **Create new note from template** in the palette, or right-click a folder and choose **New note from template here**. Then type the new note's name.

If the template asks questions (`{{prompt:…}}`), a small form asks them all at once before anything is inserted. **Cancel** inserts nothing.

## Placeholders

| Placeholder | Becomes |
|---|---|
| `{{title}}` | The note's name |
| `{{date}}` | Today's date, in the format set in Settings › Templates (`YYYY-MM-DD` by default) |
| `{{time}}` | The time now (`HH:mm` by default) |
| `{{date:dddd, D MMMM YYYY}}` | The date in any format: here "Monday, 2 November 2026" |
| `{{time:h:mm A}}` | The time in any format: "2:05 PM" |
| `{{prompt:Who is attending?}}` | Your answer to the question |
| `{{prompt:Project\|Home}}` | Your answer, with "Home" filled in to start with |
| `{{cursor}}` | Where the cursor goes afterwards |

Common date letters: `YYYY` year, `MM` month number, `MMMM` month name, `DD` day, `dddd` weekday name, `Do` day with "st/nd/rd/th", `HH:mm` 24-hour time, `[W]ww` week number. Letters inside `[ ]` are kept as they are.

## A template for every note in a folder

**Settings › Templates › Folder templates** gives a folder its own template: every note created in that folder starts from it, whether you use New note, **New note here**, the quick switcher, or follow a link to a note that does not exist yet. Add a row, enter the folder (`Meetings`) and the template (`Templates/Meeting.md`). In nested folders the deepest matching rule wins; a row with an empty folder applies everywhere.

For daily notes, set the template under **Settings › Daily notes** instead (see [Calendar and daily notes](calendar-and-daily-notes.md#a-template-for-every-day)).

## Good to know

- Templates are plain text: they cannot run code. For notes that compute something, see [Scripts and queries](scripts-and-queries.md).
- Notes inside the templates folder never get a folder template themselves, so editing templates is safe.
- The placeholders are the same as Obsidian's Templates plugin, plus `{{prompt}}` and `{{cursor}}`.
