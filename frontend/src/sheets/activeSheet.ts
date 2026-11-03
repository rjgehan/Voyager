// The open spreadsheets' actions, for the palette commands their view descriptor contributes
// (DESIGN §6.21.5). Each lazy view registers them while it is mounted, by its file, so with two
// panes showing two spreadsheets the commands act on the active pane's one; the commands live in
// the main bundle and never load the view or the engine themselves.

export interface SheetActions {
  path: string;
  editable(): boolean;
  undo(): void;
  redo(): void;
  fillDown(): void;
  fillRight(): void;
  toggleBoldRows(): void;
  freezeRows(): void;
  freezeColumns(): void;
  unfreeze(): void;
  addSheet(): void;
  insertRowsAbove(): void;
  insertRowsBelow(): void;
  insertColumnsLeft(): void;
  insertColumnsRight(): void;
  deleteRows(): void;
  deleteColumns(): void;
  openNamedRanges(): void;
  openColumnWidth(): void;
  openNumberFormat(): void;
  increaseDecimals(): void;
  decreaseDecimals(): void;
  insertChart(): void;
  importFile(): void;
  exportCsv(): void;
  exportXlsx(): void;
  sortRangeAsc(): void;
  sortRangeDesc(): void;
  sortSheetAsc(): void;
  sortSheetDesc(): void;
  toggleFilter(): void;
  openConditionalFormatting(): void;
  insertCheckboxes(): void;
  insertDropdown(): void;
  openDataValidation(): void;
  openFind(): void;
  openReplace(): void;
  createPivotTable(): void;
}

/** The mounted views' actions, the latest last. */
const mounted: SheetActions[] = [];

/** Registers a mounted view's actions; returns the matching cleanup, which removes only them. */
export function setActiveSheet(actions: SheetActions): () => void {
  mounted.push(actions);
  return () => {
    const i = mounted.indexOf(actions);
    if (i >= 0) mounted.splice(i, 1);
  };
}

/** The actions of the spreadsheet showing `path` (the latest mounted, if two do), if one is mounted. */
export function activeSheet(path: string | null): SheetActions | null {
  if (path === null) return null;
  for (let i = mounted.length - 1; i >= 0; i--) if (mounted[i].path === path) return mounted[i];
  return null;
}
