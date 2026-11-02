# Spreadsheets

A spreadsheet is a file of its own (ending in `.sheet`) that works like Google Sheets: a grid of cells, formulas with about 400 functions, several sheets in tabs, number formats, charts, and copy and paste with Google Sheets and Excel. For a few numbers inside a note, a [table with formulas](tables-and-formulas.md) may be all you need.

## Make a spreadsheet

- Run **Create new spreadsheet** from the palette, or right-click a folder and choose **New spreadsheet here**.
- Type its name and press `Enter` to go to the grid.
- To make one and show it inside the note you are writing, type `/spreadsheet` and pick **New spreadsheet (embedded)**.

You can also start from a file: **Import spreadsheet from CSV or Excel…** in the palette turns a `.csv` or `.xlsx` file into a new spreadsheet.

## Enter data

- **Computer**: click a cell and start typing, or double-click it (or press `Enter` or `F2`) to change what is there. `Enter` saves and moves down, `Tab` moves right, `Esc` cancels.
- **Phone**: tap a cell to select it, and tap it again to type. You type in the **formula bar** above the grid; `Enter` saves and moves to the next cell with the keyboard still up.
- **Delete** clears the selected cells.
- Typing `$1,450`, `12%` or a date such as `2026-10-17` stores the number and gives the cell the matching format.

Select a range by dragging (or `Shift`+click); click a column letter or a row number to select the whole column or row.

## Formulas

Start with `=`: `=SUM(B2:B9)`, `=AVERAGE(C:C)`, `=IF(D2>100, "over", "ok")`, `=VLOOKUP(A2, Prices!A:B, 2, FALSE)`. The cell shows the result; the formula bar shows the formula.

- **Suggestions**: type `=SU` and pick **SUM** from the list (arrow keys and `Enter`, or tap it). Inside the brackets, a hint shows what the function expects.
- **Point at cells** instead of typing their names: with the cursor after `=`, `(`, a comma or an operator, click a cell to put its name in. Drag for a range, or click the first cell and `Shift`+click the last. On the phone, tap the first cell and then the last.
- **Other sheets** are written with the sheet's name and `!`: `Sheet2!B4`, `'Budget 2026'!A1:A9`.
- **Errors** show in red, with an explanation next to the formula bar: `=SUM` without brackets says "Did you mean SUM(…)?". The [error table](tables-and-formulas.md#when-a-formula-shows-an-error) applies here too.

## Fill, copy and move

- **Fill handle** (computer): drag the small square at the bottom right of the selection over the cells to fill. Formulas adjust their cell names (`$B$2` stays fixed), and numbers in even steps continue (1, 2, 3…).
- **`Ctrl+D`** fills down and **`Ctrl+R`** fills right, also from the toolbar (on the phone, select the range first, then use the toolbar).
- **Copy and paste** with `Ctrl+C` and `Ctrl+V`, between spreadsheets here and to and from Google Sheets, Excel and LibreOffice. A copy pasted in this spreadsheet keeps its formulas.
- **Cut and paste** (`Ctrl+X`, then `Ctrl+V`) moves cells, and formulas that pointed at them follow. `Esc` cancels a cut.
- **Undo** is `Ctrl+Z`; redo is `Ctrl+Shift+Z` or `Ctrl+Y`.

## The toolbar

Point at a button to see its name (on the phone, swipe the toolbar sideways to see them all):

- **Undo**, **Redo**.
- **Bold** for the selected rows (or columns, when whole columns are selected), `Ctrl+B`.
- **Fill down** and **Fill right**.
- **Freeze** keeps rows or columns in place while the rest scrolls: it freezes the rows above and the columns left of the selected cell, or unfreezes them.
- **Column width**, for exact widths (on a computer you can also drag the edge of a column letter).
- **Insert or delete rows and columns**: above, below, left or right of the selection, or delete the selected ones. Right-clicking a cell, a row number or a column letter opens the same menu. Formulas follow the cells they used.
- **Decrease** and **Increase decimal places**, and **Number format**: currency, percent, a number of decimals, dates and times, or your own format code.
- **Insert chart** (below).
- **Named ranges**: give a range a name (`Total`, `Prices`) and use it in formulas.
- **Import CSV or Excel**, into a new sheet of this spreadsheet or as a new spreadsheet.
- **Download** the current sheet as CSV, or the whole spreadsheet as Excel (`.xlsx`).

The box at the left of the formula bar shows where you are (`B3`, `A1:C4`). Type a cell, a range, `Sheet2!A1` or a named range there and press `Enter` to jump to it.

## Sheets

The tabs under the grid are the spreadsheet's sheets. **+** adds one. Double-click a tab (or use its menu) to rename it; the menu also moves it left or right and deletes it. On a computer you can drag tabs to reorder them.

## Charts

Select the data to chart, then **Insert chart** and choose **Bar**, **Line** or **Pie**. Charts appear in a pane under the grid that folds away; each has **Edit chart** and **Delete chart** buttons. On the phone the pane starts folded, so the grid keeps its room.

## Spreadsheets inside notes

Embed a spreadsheet like any file, and edit it right there in the note:

| Write | Shows |
|---|---|
| `![[Budget.sheet]]` | The first sheet (a picker switches to the others) |
| `![[Budget.sheet#Summary]]` | The sheet named Summary |
| `![[Budget.sheet#Budget!A1:C10]]` | Just that range |
| `![[Budget.sheet#Total]]` | A named range |
| `![[Budget.sheet#chart:Spending]]` | The chart titled Spending (`#chart:` alone shows the first chart) |

In a note you can edit, the embed is a small spreadsheet of its own:

- **Click a cell and type** (or double-click it, or press `Enter` or `F2`); `Enter` and `Tab` save and move on, `Esc` cancels, `Delete` clears. On the phone, tap a cell to select it and tap it again to type.
- **Formulas** work as in the full spreadsheet: suggestions, the hint inside the brackets, and clicking (or tapping) cells to put their names in. The bar above the grid shows the selected cell's formula and explains errors.
- **The toolbar** has Undo, Redo, Bold rows, Fill down, Insert a row below and Delete rows; `Ctrl+Z`, `Ctrl+D`, `Ctrl+B` and copy and paste work too.
- **Open full sheet** opens the spreadsheet itself, for everything else: the fill handle, freezing, column widths, number formats and editing charts.

It is the same spreadsheet: an edit in the note is saved, synced and undone exactly like one made in the spreadsheet, and a spreadsheet open in another tab shows it at once. The embed shows up to 100 rows and 26 columns. In a note you cannot edit (a locked one, a note shown inside another note, a canvas), the embed is a read-only table; click it to open the spreadsheet.

## Read notes from a spreadsheet

Four functions bring your notes into a spreadsheet. Name a note as a link would (`"Plan"`, `"Projects/Plan"` or `"[[Plan]]"`):

| Formula | Gives |
|---|---|
| `=NOTEPROP("Projects/Plan", "status")` | A property of the note, or a file field such as `file.name`, `file.mtime`, `file.size` or `file.tags` |
| `=NOTETABLE("Budget note", "budget")` | A table of the note, with its formulas worked out: the table named `^budget` (see [Use a table from elsewhere in the note](tables-and-formulas.md#use-a-table-from-elsewhere-in-the-note)), or the first one without a name. Add `TRUE` to include the header row. |
| `=NOTECOUNT("tag:work")` | How many notes match (all of them without a query) |
| `=NOTEQUERY("tag:work status!=done", "title, status, due")` | One row per matching note (up to 500), with the columns you name (`title` alone without them). Add `TRUE` for a header row. |

- **Queries** combine words with AND: `tag:work` or `#work`, `folder:Projects`, `links:Plan` or `[[Plan]]` (notes that link to it), `status=open`, `status!=done`, `prop:status` (has the property), and any other words as a search in the notes' text.
- `NOTETABLE` and `NOTEQUERY` fill the cells below and to the right, so leave them empty. Write their note and table as text in the formula: with a cell reference instead (`=NOTETABLE(A1)`) they show `#VALUE!`.
- Dates come in as dates, numbers as numbers, lists joined with commas. A note or table that does not exist shows `#REF!`; a property the note does not have shows `#N/A`. While a note is being read, the cell shows `#N/A` with "Loading…" for a moment.
- The values follow your notes: change a property or a table, here or on another device, and the spreadsheet shows it within a moment. They are saved in the spreadsheet with its next edit, so a change in a note never adds a history entry to the spreadsheet by itself.
- A spreadsheet that reads a note with `NOTEPROP` or `NOTETABLE` is one of that note's [backlinks](links-and-tags.md). Renaming the note does not change the name in the formula: correct it if the formula shows `#REF!`.

Notes can read a spreadsheet's cells too: see [Use a spreadsheet's cells in a note](tables-and-formulas.md#use-a-spreadsheets-cells-in-a-note).

## Good to know

- Spreadsheets save as you type, keep their [history](history-and-trash.md) and show changes from your other devices live. Two devices changing different cells at the same time never conflict.
- Search finds the text and numbers in cells, and `[[links]]` in cells count as backlinks.
- On Excel files: number formats, column widths and row heights carry over both ways; colours, borders, merged cells, comments and Excel's charts do not (an import says what it left out).

> [!NOTE]
> **Coming soon:** sorting and filtering a range in place, colouring cells by their value (conditional formatting) and drop-down lists in cells are being added. Until then, the `SORT` and `FILTER` functions give a sorted or filtered copy of a range: `=SORT(A2:C20, 2, FALSE)`. This page will be updated when they arrive.
