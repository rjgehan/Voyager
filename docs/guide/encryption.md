# Encryption

Encryption locks a note, or a piece of one, with a passphrase. The text is encrypted on your device before it is saved, so the server, its history and its backups only ever hold scrambled text. Use it for passwords, account numbers, medical details and other secrets.

> [!WARNING]
> **If you forget the passphrase, the text is gone for good.** Nobody, not even whoever runs the server, can reset it or get the text back. Choose a passphrase you will remember (four or more random words work well) or keep it in a password manager.

## Encrypt a whole note

- **A new encrypted note**: run **Create new encrypted note** from the palette. Choose a passphrase (at least 8 characters, typed twice), optionally a hint, tick the box that you understand the warning, and write.
- **An existing note**: open it and run **Encrypt this note…**. The note becomes an encrypted note (its name ends in `.mdenc`), and links to it keep working.

> [!NOTE]
> Encrypting an existing note does not erase its earlier, unencrypted versions from the [history](history-and-trash.md). For a secret, start a new encrypted note rather than encrypting a note that already held it.

Opening an encrypted note asks for its passphrase (and shows the hint). After that you read and edit it as usual, and it is saved encrypted.

**Encrypted note: Change passphrase…** and **Encrypted note: Remove encryption…** are in the palette while an encrypted note is open.

## Encrypt part of a note

Keep most of a note readable and lock just one secret:

- **Insert encrypted text…** (palette, or `/encrypt` in the note): type the secret into the dialog, so it never touches the note unencrypted.
- **Encrypt selection…** (palette): encrypts text you have selected. As above, the plain text may already be in the note's history.

The secret shows in the note as a chip, **🔒 Encrypted · hint**. Click it (or put the cursor on it and run **Open encrypted text at cursor**), enter the passphrase, and the text opens in a dialog where you can read it, change it and **Save** it encrypted again. One passphrase opens all the encrypted parts of a note that share it.

## Locking

Once you enter a passphrase, encrypted text stays open on that device for a while, then locks by itself:

- after **10 minutes** without typing or tapping (change it under **Settings › This device › Lock encrypted notes after**: 1, 5, 10, 30 or 60 minutes);
- when you reload the app;
- at once when you switch to another app or tab, if you turn on **Lock encrypted notes when the app is hidden**;
- whenever you run **Lock encrypted notes** from the palette, or use the encrypted note's lock button.

Passphrases are never saved anywhere: not on the device, not on the server.

## Good to know

- Encrypted text is left out of search, backlinks and tags, and is never sent to [Ask your vault](ask-your-vault.md).
- The hint is stored unencrypted next to the text, so do not put the secret, or a clue that gives it away, in the hint.
- Encrypted notes and sections use the format of Obsidian's **Meld Encrypt** plugin: they open in Obsidian with that plugin, and the plugin's notes open here.
