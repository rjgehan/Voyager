'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideUnload, UNLOAD_PROMPT } = require('../src/unload');

// The page cancels an unload while a note has unsaved changes (its beforeunload handler). Electron
// shows no prompt and silently cancels the close, quit or reload unless the shell decides.

test('quitting always goes ahead (drafts keep the text on this device), without asking', () => {
  let asked = 0;
  assert.equal(
    decideUnload({
      quitting: true,
      ask: () => {
        asked++;
        return 1;
      },
    }),
    'leave',
  );
  assert.equal(asked, 0);
});

test('a reload or a server change asks: Continue leaves, Stay keeps the page', () => {
  assert.equal(decideUnload({ quitting: false, ask: () => UNLOAD_PROMPT.buttons.indexOf('Continue') }), 'leave');
  assert.equal(decideUnload({ quitting: false, ask: () => UNLOAD_PROMPT.buttons.indexOf('Stay') }), 'stay');
});

test('the prompt says the changes are kept, and Escape or closing it means Stay', () => {
  assert.equal(UNLOAD_PROMPT.buttons[UNLOAD_PROMPT.cancelId], 'Stay');
  assert.equal(UNLOAD_PROMPT.buttons[UNLOAD_PROMPT.defaultId], 'Stay');
  assert.match(UNLOAD_PROMPT.detail, /kept on this device/);
});
