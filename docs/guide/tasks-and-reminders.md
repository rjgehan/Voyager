# Tasks and reminders

Voyager has a real task manager: lists, due dates, priorities, repeating tasks, subtasks and reminders, with **Today** and **Upcoming** views. Tasks are kept in your vault as files in the `Tasks` folder (one file per list), so they sync, have history and can be linked from notes.

> [!NOTE]
> A checkbox in a note (`- [ ]`) is just part of the note: tick it and nothing else happens. A **task** has a date, can repeat and can remind you. You can turn a checkbox into a task at any time (see [Tasks in notes](#tasks-in-notes)).

## Add a task

Open **quick add** and type the task in plain words:

```text
Pay rent tomorrow 9am every month !high #home @Bills [[Apartment]]
```

As you type, the parts it recognises turn into chips under the text: the date and time, the repeat, the priority (`!high`, `!med`, `!low` or `!!!`), tags (`#home`), the list (`@Bills`; a name that does not exist yet makes a new list) and links to notes (`[[Apartment]]`). Tap a chip's **×** to keep that part as plain text instead. Press `Enter` to save. Without `@List`, the task goes to the **Inbox** list.

Where to find quick add:

- **Command palette**: **Add task (quick add)**.
- **In a note**: type `/task` and pick **New task…**.
- **On a task page**: the **Add task** button at the top (phone: the round **+** button).
- **A key**: `Ctrl+Alt+Q`, even while you are typing in a note. You can give it another key under **Settings › Hotkeys** (see [Keyboard shortcuts](keyboard-shortcuts.md#change-a-key)).

## The task pages

Open them from the ribbon (computer) or the drawer (phone). Each task page has tabs to the others along the top.

- **Today's tasks**: overdue tasks, tasks due today, and tasks whose start date has come.
- **Upcoming tasks**: the next 14 days, day by day, with a week strip at the top to jump to a day. Each day has its own add button.
- **Task lists**: every list with its number of open and overdue tasks. **New list** makes a list; each list's menu renames it, gives it a colour, moves it up or down, archives it or deletes it.
- **Completed**: finished tasks, newest first. Untick one to reopen it.
- **Filter**: tasks by list, tag and priority. A filter's address can be saved as a browser bookmark, or linked from a note.

## Work with tasks

- **Tick the circle** to complete a task. A repeating task moves on to its next date instead. A message offers **Undo**.
- **Click a task** to edit it in place: title, notes, due date and time, priority and tags. **Details** in its menu opens everything: status, start date, repeat, reminders, related notes, list and section, subtasks.
- **Subtasks**: **Add subtask** in a task's menu or details. Tasks nest up to three levels.
- **Reorder**: drag a task by its handle; moving it sideways while dragging makes it a subtask or takes it out. With a keyboard, `Alt+↑` and `Alt+↓` move a task, `Alt+→` makes it a subtask of the task above, and `Alt+←` moves it out.
- **Sections** divide a list (**Add section…** in the list's menu). Each section has its own add button, and can be renamed, moved or deleted.
- **Show completed tasks** in a list's menu shows the finished ones again.
- **Board**: switch **List | Board** at the top of a list to see it as a [Kanban board](kanban.md#show-a-task-list-as-a-board).

## Repeating tasks

In a task's details, **Repeat** offers every day, every weekday, weekly, every two weeks, monthly and yearly, or **Custom…**: every few days, weeks, months or years, on chosen weekdays, on "the second Tuesday", until a date or for a number of times. You can also type the rule in words ("every 2 weeks on Monday and Friday").

**Repeat from** chooses whether the next date counts from the due date (rent: always on the 1st) or from when you completed it (water the plants: a week after you last did).

## Reminders

In a task's details, **Add reminder…** offers times relative to the due date (at the due time, 15 minutes or 1 hour before, the morning of an all-day task, the evening before), times from now (in an hour, tomorrow morning), or **Custom time…**.

Reminders reach you only through the ways switched on in **Settings › Reminders**:

| Way | What you get | Needs |
|---|---|---|
| **In the app** | A message in every open Voyager tab, and a system notification where the browser allows | Voyager open somewhere. In the [desktop app](desktop-app.md) these are native Windows or macOS notifications, even with the window closed to the tray. |
| **Web Push** | A notification on the device, even with Voyager closed | On an iPhone or iPad: iOS 16.4 or later and Voyager [added to the Home Screen](phone.md#add-voyager-to-the-home-screen). Then **Subscribe this device** in Settings › Reminders. |
| **ntfy** | A notification from the ntfy app | Set up on the server (ask whoever runs it) |

Each way has a **test** button in Settings › Reminders. On a computer, a notification has **Snooze 10 min** and **Done** buttons; on the iPhone, tapping it opens the task.

Settings › Reminders can also send a **daily-note nudge**: a reminder at a time you choose, only on days when you have not opened today's daily note yet.

## Tasks in notes

- **Show a list in a note**: `![[Home.tasks]]` shows the Home list's open tasks, live, with an add field at the bottom. `![[Home.tasks#Errands]]` shows one section. Tick tasks right there.
- **Turn a checkbox into a task**: put the cursor on a `- [ ]` line and run **Convert checkbox to task**. The task goes to the Inbox, and the line becomes a link to it. Dates and priorities written in the Obsidian Tasks plugin's style (📅 2026-11-01, ⏫) come along.
- **Link notes from tasks**: `[[Note]]` in a task's title or notes links to the note, and the note's right sidebar tab **Tasks linking to this note** lists those tasks, with **Add task for this note**.
- Tasks show on the [calendar](calendar-and-daily-notes.md#the-calendar) on their due dates.

## Good to know

- Tasks completed more than 90 days ago move to a yearly archive file in `Tasks/Archive`, so lists stay quick; the Completed page still shows them.
- Two devices editing different tasks, or different parts of the same task, never conflict.
- A list's file can be opened as text (**Open list file (JSON)** in its menu), but editing tasks on the task pages is easier.
