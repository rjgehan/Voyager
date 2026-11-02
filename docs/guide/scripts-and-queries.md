# Scripts and queries

A script or query block shows something computed from your vault, right in a note: a list of open projects, a table of this week's daily notes, a countdown. It runs again by itself when the notes it reads change, so it is always up to date. The note itself keeps only the block's text, never its output.

## A query: no programming needed

Type `/dataview` and pick **Dataview query**, then write what you want to list:

````markdown
```dataview
TABLE status, due
FROM #project
WHERE status != "done"
SORT due
```
````

When the cursor leaves the block, it shows a table of every note tagged `#project` that is not done, with its `status` and `due` properties, soonest first. Click into the block to change the query.

The pieces:

| Part | Means |
|---|---|
| `TABLE status, due` | A table with these properties as columns (add `AS "Due date"` to name a column; `TABLE WITHOUT ID` leaves out the note column) |
| `LIST` | A list of notes instead (`LIST due` adds a value) |
| `TASK` | The checkboxes of the matching notes |
| `FROM #tag`, `FROM "Folder"`, `FROM [[Note]]` | Which notes: by tag, by folder, or linking to a note. Combine them with `and`. |
| `WHERE status != "done"` | Only notes where this is true |
| `SORT due DESC` | The order (`ASC` or `DESC`) |
| `LIMIT 10` | At most this many |

Besides your own properties, you can use `file.name`, `file.folder`, `file.mtime` (last changed), `file.tags`, `file.size`, `file.link` and more, and functions such as `contains(tags, "work")`, `date("today")`, `length(…)` and `lower(…)`. This is a large part of the Obsidian Dataview plugin's query language; `GROUP BY`, `FLATTEN`, `CALENDAR` and `dataviewjs` are not supported.

## A script: a few lines of JavaScript

Type `/script` and pick **Script block** for a small example. A script uses a handful of functions to read your notes and `show()` to display things:

````markdown
```script
const open = notes({ tag: "project" }).filter(n => n.props.status !== "done")
show(`${open.length} open projects`)
show(list(open))
```
````

More examples:

- A countdown: `` show(`${today().daysUntil("2026-12-25")} days to Christmas`) ``
- Something only on Mondays: `if (today().weekday === "Monday") show(embed("Monday checklist"))`
- A table: `show(table(notes({ folder: "Daily" }).slice(0, 7), ["title", "mood"]))`
- A sum with spreadsheet functions: `show(fn.SUM(1, 2, 3))`, or a formula over this note's [tables](tables-and-formulas.md): `show(formula("=budget!B5*12"))`

| Function | Gives |
|---|---|
| `today()`, `now()`, `date("2026-11-02")` | A date with `.weekday`, `.day`, `.month`, `.year`, `.format("D MMMM")`, `.add(3, "days")`, `.daysUntil(…)` |
| `note("Name")`, `thisNote()` | One note: `title`, `path`, `folder`, `tags`, `props`, `modified`, `links`, `.text()`, `.tasks()` |
| `notes({ tag, folder, prop, linksTo, search })` | Matching notes, to filter and sort |
| `tasks({ … })` | The checkboxes of matching notes |
| `show(…)` | Shows text (as Markdown), numbers, lists, tables, embeds |
| `list(items)`, `table(rows, columns)`, `embed("Note")` | Things to show |
| `query("TABLE … FROM …")` | A Dataview query's result |

If a script has an error, the block shows the message and the line number.

## Safe by design

Scripts run in a sealed sandbox: they can read your notes but cannot change, create or delete anything, cannot reach the internet, and are stopped if they run too long. So a script that arrived in a clipped web page or a copied note cannot do harm.

**Settings › This device › Scripts in notes** decides what happens on each device: **Run as the note shows** (the default), **Ask before running** (a Run button first), or **Off (show the code)**.

Each block has two buttons at its top right (on a computer, point at it to see them): **↻** runs it again now, **</>** shows its code. Blocks also run again at midnight, so `today()` stays right. Embedded notes show blocks as code; they only run in the note itself.
