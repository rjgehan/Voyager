'use strict';
// The app's page cancels an unload while a note has unsaved changes (its beforeunload handler,
// frontend/src/sync/documents.ts). A browser turns that into a "Leave site?" prompt; Electron shows
// nothing and silently cancels the close, quit or reload unless the shell handles
// `will-prevent-unload`. This decides what happens instead.

/** The question asked before a reload, a server change or a vault switch leaves unsaved changes. */
const UNLOAD_PROMPT = Object.freeze({
  type: 'warning',
  buttons: ['Continue', 'Stay'],
  defaultId: 1,
  cancelId: 1,
  noLink: true,
  title: 'Voyager',
  message: 'Some changes are not saved to the server yet.',
  detail: 'They are kept on this device and saved once the connection is back. Continue anyway?',
});

/**
 * `quitting`: Quit was chosen, which always goes ahead: the drafts keep the text on this device and
 * the page sends what it can as it unloads. Otherwise `ask()` shows UNLOAD_PROMPT and returns the
 * index of the button picked. Returns 'leave' (let the unload happen) or 'stay'.
 */
function decideUnload({ quitting, ask }) {
  if (quitting) return 'leave';
  return UNLOAD_PROMPT.buttons[ask()] === 'Continue' ? 'leave' : 'stay';
}

module.exports = { decideUnload, UNLOAD_PROMPT };
