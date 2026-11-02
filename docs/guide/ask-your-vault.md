# Ask your vault

Ask questions about your notes in plain language ("What did I decide about the kitchen?", "Which books did I finish this year?") and get an answer written from your notes by Claude, with links to the notes it used. It can also summarise and suggest.

> [!NOTE]
> This is **off** until it is switched on twice: on the server, by whoever runs it (it needs a Claude subscription token or an Anthropic API key), and in **Settings › Ask and summaries › Use Claude**. When it is not available, the Ask view says why.

## Ask a question

- **Computer**: the **Ask** tab of the right sidebar, **Ask your vault** in the ribbon, or **Ask a question about your notes** in the palette.
- **Phone**: **Ask your vault** in the drawer.

Type the question and press `Enter` (`Shift+Enter` starts a new line). The answer appears as it is written; **Stop** ends it early. Its links open the notes it is based on, and under the answer you see which notes were sent, the model, and the estimated cost. Ask follow-up questions in the same conversation.

**Include the open note** (ticked by default) sends the note you are reading along with the question, for questions such as "summarise this" or "what is missing here?".

Conversations are kept on the device you asked on: **New conversation** starts afresh, and the list of conversations on this device can reopen or delete them.

## Summaries and suggestions

From the palette, or the buttons above the question box:

- **Summarize current note**, **Summarize selection** and **Summarize current folder**;
- **Summarize this week's daily notes**;
- **Suggest links, tags and tasks for current note**.

## Privacy and cost

- Your question, and the text of the notes needed to answer it, are sent to Anthropic when you ask, and only then. The first time on each device, a notice says so.
- Folders listed under **Settings › Ask and summaries › Never send** (`Private` by default), excluded files, and [encrypted](encryption.md) text are never sent.
- A **monthly budget** in the same settings stops requests once the month's estimated spend reaches it. The settings page shows this month's spend.
- **Model**: Sonnet (recommended) answers well for everyday questions; Opus is slower and costs more.
