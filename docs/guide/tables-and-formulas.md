# Tables and formulas

Tables in notes show as a grid you edit in place, and any cell can hold a spreadsheet formula, as in Google Sheets or Excel. For bigger sheets with several tabs and charts, use a [spreadsheet file](spreadsheets.md) instead; both understand the same functions.

## Make a table

Any of these makes a table with a header row, two columns and two rows, and puts you in its first cell:

- Type `/table` and press `Enter`.
- The table button on the phone's keyboard bar, or **Insert table** in the palette.
- Type a header line such as `| Item | Cost |` and press `Enter`.

## Edit a table

Click or tap a cell and type. Each change is saved in the note as you go, and `Ctrl+Z` undoes it like any other typing.

| Key | Moves to |
|---|---|
| `Tab`, `Shift+Tab` | The next or previous cell. `Tab` in the last cell adds a row. |
| `Enter`, `Shift+Enter` | The cell below or above. `Enter` in the last row adds a row. |
| Arrow keys | The next cell, once the cursor reaches the edge of the text |
| `Esc` | Back to the note, under the table |

On the phone, the keyboard bar shows **Previous cell** and **Next cell** buttons while you are in a table.

**Rows and columns.** Each row has a small grip on its left edge and each column one on its top edge (they show when you point at the table, or while you edit a cell).

- **Drag a grip** to move the row or column.
- **Click a grip** for its menu, or right-click any cell (phone: long-press it). The menu inserts a row above or below, moves the row up or down, deletes it; inserts a column left or right, moves or deletes it; aligns the column left, centre or right; and deletes the whole table.
- The header row always stays first, and a table always keeps at least one column.

Formatting keys work inside cells (`Ctrl+B`, `Ctrl+I`, `Ctrl+K`, …), and so do links and images. A table inside a quote or a list shows as text rather than a grid.

## Add up a column: your first formula

Columns are lettered **A, B, C…** from the left, and rows are numbered from the header: the header is row **1**, so the first row under it is row **2**. A cell is named by its column and row, like **B2**.

A cell whose text starts with `=` is a formula. Take this table:

| Item | Cost |
|---|---|
| Rent | 1450 |
| Utilities | 210 |
| Internet | 65 |
| **Total** | `=SUM(B2:B4)` |

The last cell shows **1725**. Click it to see and change the formula; click elsewhere to see the result again.

Some formulas to start with:

| Formula | Does |
|---|---|
| `=SUM(B2:B4)` | Adds B2, B3 and B4 |
| `=AVERAGE(B:B)` | The average of every number in column B |
| `=B2*12` | B2 times 12 |
| `=B2/B5` | B2 as a share of B5 |
| `=IF(B2>1000, "big", "ok")` | "big" or "ok" depending on B2 |
| `=COUNTIF(C2:C9, "done")` | How many cells in C2 to C9 say "done" |
| `=TODAY()` | Today's date |

There are about 400 functions, the same ones Google Sheets and Excel have, and the same as in [spreadsheets](spreadsheets.md).

## Typing a formula without typing cell names

While you type a formula, the table helps:

1. **Type `=` and the first letters of a function**, such as `=SU`. A list of matching functions appears, the common ones first. Pick **SUM** with the arrow keys and `Enter` (or tap it). It puts in `SUM(` with the cursor ready for what goes inside.
2. **Point at the cells** instead of typing their names. With the cursor right after `=`, `(`, a comma or an operator, click another cell and its name goes into the formula.
   - **Computer**: click the first cell, then `Shift`+click the last to make a range (`B2:B4`), or drag across the cells. Clicking another cell instead replaces the one you just put in.
   - **Phone**: tap the first cell, then tap the last: the second tap makes the range. A third tap starts again. The keyboard stays up while you tap.
   - The cells a formula uses are outlined in colour, so you can see what it adds up.
3. **Close the bracket**: type `)`.

While the cursor is inside a function's brackets, a hint under the cell shows what the function expects, with the part you are typing now in bold: `SUM(value1, [value2, …])`. Square brackets mean optional.

Above the table, the **formula bar** shows the cell's name and its result as you type, and explains errors.

## Fill a column

To repeat a formula down a column (with its cell names following along, as in a spreadsheet):

- **Drag the fill handle**: while you edit a cell, a small square sits on its bottom-right corner. Drag it down (or right) over the cells to fill. `=B2*2` filled one row down becomes `=B3*2`; a name written with `$` (`$B$2`) stays as it is. Numbers that go up in even steps continue the series (1, 2 becomes 3, 4), and other text is copied.
- **`Ctrl+D`** fills down: in a single cell it copies the cell above; with a range selected (click a cell, then `Shift`+click another) it fills the range from its first row. **`Ctrl+R`** does the same to the right.

A fill never adds rows: add the rows first, then fill them.

## When a formula shows an error

An error shows in red in the cell. Point at it (computer) to read what went wrong, or click the cell: the formula bar above the table explains it.

| Error | Usually means | Fix |
|---|---|---|
| `#NAME?` | A function name without its brackets, or misspelt: `=SUM` or `=SUMM(B2:B4)` | Write the brackets and the cells: `=SUM(B2:B4)`. The formula bar suggests the right name ("Did you mean SUM(…)?"). |
| `#ERROR!` | The formula is not finished, often a missing `)` | The formula bar says what is missing ("Missing a closing bracket )") |
| `#DIV/0!` | Dividing by zero or by an empty cell | Check the cell you divide by |
| `#REF!` | A cell name that does not exist (a deleted row or column, a table name typed wrong) | Point at the cells again |
| `#VALUE!` | Text where a number is needed | Check the cells it uses hold numbers |
| `#CYCLE!` | The formula uses its own cell, directly or through others | Take its own cell out of the range |

## Use a table from elsewhere in the note

Give a table a name with a line that holds only `^` and the name, after a blank line under the table:

```markdown
| Item | Cost |
|---|---|
| Rent | 1450 |

^budget
```

Then any formula in the note can use it: `=budget!B2*12`, `=SUM(budget!B2:B4)`. Pointing at a cell of another named table puts its name in for you. (Tables without a name are called `Table1`, `Table2`, … from the top of the note, but those names change when you add a table above, so name the ones you refer to.)

## Use a spreadsheet's cells in a note

A formula in a note's table, or in a sentence, can read a [spreadsheet](spreadsheets.md) by naming the file where a sheet name goes:

| Formula | Reads |
|---|---|
| `=Budget.sheet!B10` | Cell B10 of the spreadsheet Budget's first sheet |
| `=SUM(Budget.sheet!B2:B9)` | A range |
| `='Budget.sheet#Summary'!A1` | Another sheet of the file (quotes, because of the `#`) |
| `='Finance/Budget.sheet'!B10` | A spreadsheet in another folder (quotes, because of the `/`) |
| `=Budget.sheet!Total` | A named range of the spreadsheet |

- The value follows the spreadsheet as it changes, even before it is saved when it is open on this device, and when another device saves it.
- A formula that is just one cell (`=Budget.sheet!B10`) shows in that cell's number format, such as `$1,450.00`.
- Filling a column or `Ctrl+D` moves these references like any other (`Budget.sheet!B2` becomes `B3`).
- `#REF!` means no such spreadsheet or sheet, `#NAME?` no such named range. `#CYCLE!` means the spreadsheet reads this note's values back (with `NOTETABLE`), so neither can use the other's.
- Reading a spreadsheet does not make a link: to see the note among the spreadsheet's backlinks, link it too (`[[Budget.sheet]]`).
- In a note shared with family, these read the spreadsheets shared with it (in the same shared folder). `NOTEPROP`, `NOTECOUNT` and `NOTEQUERY` need your whole vault, so on the shared page they say *Not available in a shared note*.

## Formulas in a sentence

Inline code that starts with `=` is a formula too: type `` `=1450*12` `` (or select `=1450*12` and press `Ctrl+E`) and it shows **17,400**. It can use named tables (`` `=budget!B2*12` ``) and spreadsheets (`` `=Budget.sheet!B10` ``). Click the result to see the formula again.

## Number formats

To show a column as money, percentages or dates, add a hidden line under the table (after the blank line, next to its `^name` line if it has one):

```markdown
%% formats: B=currency C=percent %%
```

You can use `number`, `integer`, `decimal`, `percent`, `currency`, `currencyRounded`, `financial`, `scientific`, `date`, `dateUs`, `dateLong`, `time`, `datetime` and `duration`, or a format code such as `#,##0.0`. Without a format, numbers show with thousands separators from five digits on (`17,400`).

## Good to know

- The note keeps exactly what you typed: the formula, never the result. Search finds the formula's text.
- A note that should show cells starting with `=` as plain text can turn formulas off with the property `formulas: false`.
- A note shown inside another note (an embed) shows its formulas as typed.
- An array formula such as `=SEQUENCE(3)` fills the empty cells below it.
