# History and trash

Voyager keeps every version of every note, so a change you regret, a deleted note or a mistake made on another device can always be undone.

## How saving and history work

- Notes save **as you type**. Until the server confirms a save, your edits are also kept on the device, so closing the tab or losing the connection loses nothing.
- About **30 seconds after you stop typing**, the changes go into the vault's history (a git repository on the server), with your name as the author. Changes made outside the app (another program, Obsidian on the server) are recorded too.
- Spreadsheets, drawings, canvases and task lists have history like notes.

For the last few minutes, `Ctrl+Z` in the note is quicker. For anything older, use the history.

## Go back to an earlier version

1. Open the note, then the **History** tab of the right sidebar (phone: **⋯ › History**; a file's menu in the Files tab has **File history** too).
2. Each row is a saved version, with when and who. Click one.
3. The **diff** shows what changed between that version and the current text (removed text in red, added text in green). **Full text** shows the old version on its own, and **Compare with** compares two old versions.
4. **Restore this version** makes it the current text, after asking. The text you replace stays in the history, so a restore can be undone the same way. **Copy text** copies the old version instead, to paste just a part of it.

The top row, **Uncommitted changes**, means your latest edits are not in the history yet; **Commit now** records them at once.

## Everything that changed, and deleted files

**Vault history** (ribbon, drawer, or the link at the bottom of the History tab) shows the whole vault:

- **Timeline**: every recorded change, newest first, filtered by folder or file, by author and by period (today, this week, this month, the last 30 days, all time). Click a file to see that version. A note renamed or moved since is compared with, and restored into, the note under its new name; if Voyager cannot tell where it went, it says there is no file at that path now, and restoring creates a new note there.
- **Changes**: what changed over a period ("This week" by default), file by file, with a diff from the start to the end of the period.
- **Deleted files**: every file that was ever deleted and is not back, with a search box. **Preview** shows its last version; **Restore** brings it back, even if it is long gone from the trash.

## The trash

Deleting a note (or a folder or any file) moves it to the trash; nothing is deleted outright.

- Open the trash with the bin icon in the ribbon, **Trash** at the bottom of the phone's drawer, or **Open trash** in the palette.
- **Restore** puts an item back where it was (if something else now has its name, you are asked whether to restore it as a copy).
- **Delete permanently** removes one item; **Empty trash** removes them all. If the trash changes while you are being asked (something else is deleted, or a sync app drops a file into it), you are asked again with the new count. Even then, notes can still be brought back from **Vault history › Deleted files**.
- Moving and renaming are not deletions: links follow along, and a move made by dragging shows **Undo** for a few seconds.

## When two devices disagree

If you edit a note on one device while it changed on another (for example, the phone was offline), Voyager never silently throws either version away. A banner at the top of the note says the note was changed on another device, and offers:

- **Keep mine**: save your version. The other one stays in the history.
- **Take theirs**: replace your text with the other device's. Your text can be brought back with **Undo** or `Ctrl+Z`.
- **Compare**: see both side by side and accept or reject each difference, then **Save merged**.

Saving pauses until you choose, but your edits are kept on the device meanwhile. Spreadsheets, drawings, canvases and task lists merge most changes by themselves, so you rarely see the banner for them.

If the note was deleted on the other device while you were changing it, the banner offers **Recreate with my text** or **Discard**. If it was deleted while you were only reading it, it offers **Restore**.

## Edits that were never saved

Text that a device set aside without saving (for example when you chose **Take theirs**) is not lost either: **Settings › This device › Recently discarded edits** keeps it on that device for 7 days, with **Copy**, **Restore into note** and **Forget**.

## Very large files

Files larger than the server's limit (25 MB unless changed) stay in the vault and in backups, but their versions are not kept in the history. The History tab says so for such a file, and replacing it moves the old copy to the trash instead.
