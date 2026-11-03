# Kanban boards

A Kanban board shows cards in columns (lanes), such as To do, Doing and Done, and you drag the cards from lane to lane. Voyager has two kinds:

- **A board note**: a note shown as a board, in the format of Obsidian's Kanban plugin. Good for anything: projects, reading lists, ideas.
- **A task list as a board**: any [task list](tasks-and-reminders.md) can show its sections or its statuses as columns.

## Make a board note

Run **Create new Kanban board** from the palette. The new board note has three lanes, **To do**, **Doing** and **Done**, and opens as a board. Then:

- **Add lane** at the top adds a column. A number in brackets in a lane's name limits how many cards it should hold: `Doing (3)`.
- **Add card** at the bottom of a lane (or its **+** at the top) adds a card. Type its text and press `Enter`. Cards can hold `[[links]]`, `#tags` and dates.
- Click a card's text to edit it.
- **Drag a card** to another place or lane. On a phone, drag it by its handle; with a keyboard, `Alt` with the arrow keys moves it.
- **Mark a card as done** from its menu, or drag it into a lane that marks cards as done: a new board's **Done** lane does, and any lane can (**Mark cards here as done** in the lane's menu). Done cards show a **Done** chip.

Each card's **⋯** menu has **Edit**, **Mark as done**, **Move to "…"** each other lane, **Duplicate**, **Archive** and **Delete**. Each lane's **⋯** menu adds a card, renames the lane, moves it left or right, marks its cards as done, archives all its cards, or deletes the lane.

**Archive** at the top shows archived cards, which you can restore to the first lane or delete for good.

A board note is still a note: **Open as Markdown** at the top shows it as text (each lane is a heading, each card a checkbox line), and **Kanban: Open as board** in the palette switches back. A note whose properties include `kanban-plugin` opens as a board, so boards made in Obsidian open here too.

> [!NOTE]
> If a board note holds something the board cannot show (a paragraph between cards, for example), it opens read-only and says what, rather than lose it. Open it as Markdown to turn the text into a card.

## Show a task list as a board

Open a task list (**Task lists** in the ribbon or drawer, then a list) and switch **List | Board** at the top to **Board**. Choose the columns:

- **By section**: one column per section of the list. Drag cards between sections; **Add section** adds a column.
- **By status**: To do, Done and Cancelled. Dropping a card on Done completes the task (a repeating task moves on to its next date instead); dropping it on Cancelled cancels it.

The choice of list or board is remembered on each device, list by list. On a phone the board shows one column at a time; swipe sideways for the next.
