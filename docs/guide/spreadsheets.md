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

## Show a spreadsheet in a note

Embed it like any file:

| Write | Shows |
|---|---|
| `![[Budget.sheet]]` | The first sheet, with its charts |
| `![[Budget.sheet#Summary]]` | The sheet named Summary |
| `![[Budget.sheet#Budget!A1:C10]]` | Just that range |
| `![[Budget.sheet#Total]]` | A named range |

The embed always shows the latest values (up to 100 rows and 26 columns). Click it to open the spreadsheet.

## Good to know

- Spreadsheets save as you type, keep their [history](history-and-trash.md) and show changes from your other devices live. Two devices changing different cells at the same time never conflict.
- Search finds the text and numbers in cells, and `[[links]]` in cells count as backlinks.
- On Excel files: number formats, column widths and row heights carry over both ways; colours, borders, merged cells, comments and Excel's charts do not (an import says what it left out).

> [!NOTE]
> **Coming soon:** sorting and filtering a range in place, colouring cells by their value (conditional formatting) and drop-down lists in cells are being added. Until then, the `SORT` and `FILTER` functions give a sorted or filtered copy of a range: `=SORT(A2:C20, 2, FALSE)`. This page will be updated when they arrive.
