# Calendar and daily notes

## Daily notes

A daily note is a note for one day, named after its date (`2026-11-02`), for a journal, a log of what you did, or a place to jot things down.

**Open today's note**: the calendar icon in the ribbon, **Today** in the phone's drawer, **⋯ › Today**, or **Open today's daily note** in the palette. If today's note does not exist yet it is created, from your daily-note template if you set one.

- **Open previous daily note** and **Open next daily note** (palette, while a daily note is open) step through the days that have notes.
- **Settings › Daily notes** sets the name format (`YYYY-MM-DD` by default; a `/` in it makes subfolders, such as `YYYY/MM/YYYY-MM-DD`), the folder (`Daily` by default), a template, and whether the app opens today's note when it starts.
- Settings › Reminders can nudge you at a chosen time on days you have not opened today's note yet (see [Reminders](tasks-and-reminders.md#reminders)).
- [Quick capture](capture-and-clipper.md) can add a line to today's note without opening it.

### A template for every day

Make a note in your `Templates` folder, for example `Templates/Daily note`:

```markdown
# {{date:dddd, D MMMM YYYY}}

## Plan
- {{cursor}}

## Log
```

Then set it under **Settings › Daily notes › Template file location**. Each new daily note starts from it, with the date filled in and the cursor where `{{cursor}}` is. More placeholders are on the [Templates](templates.md) page.

## The calendar

**Calendar** in the ribbon (phone: the drawer) shows a month, or a week, of your notes and tasks. **Open Calendar: this week** in the palette opens the week view.

Each day shows:

- a dot when it has a daily note;
- a square for each note dated on that day by a property (a `date` property, unless you choose others);
- rings for tasks due that day (red when overdue), and faint dashed rings for the coming dates of repeating tasks.

On a wide screen the days show the titles themselves.

- **Tap or click a day** to see its notes and tasks beside (phone: below) the calendar, tick tasks there, or **Add task** for that day.
- **Tap the selected day again** (or double-click it, or press `Enter`) to open its daily note, which is created from your template if it does not exist yet. This works for any day, past or future.
- **Move around** with the arrows and **Today** at the top, by swiping sideways on a phone, or with the keyboard: arrow keys by a day or a week, `Page Up` and `Page Down` by a month (with `Shift`, by a year).
- **Month** and **Week** switch the view.
- **Calendar options** set the first day of the week, week numbers, and which properties date a note. These are kept per device.

### The calendar panel

The **Calendar** tab of the right sidebar (phone: open the bottom sheet with **⋯ › Backlinks**, then its **Calendar** tab) is a small month, like the Obsidian Calendar plugin: one click on a day opens its daily note. It highlights the day of the daily note you are reading, and lists the selected day's notes and tasks underneath. Click the month's name to open the full calendar on that day.

## Notes with a date

Any note can appear on the calendar: give it a `date` property (press `Ctrl+;`, name it `date`, choose the day). Meeting notes, events and trips then show on their day. To use other property names, such as `due` or `event`, add them under **Calendar options › Note date properties** (up to five, separated by commas).
