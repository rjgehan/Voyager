'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideUnload, serverAfterStay, UNLOAD_PROMPT } = require('../src/unload');

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

// Changing the server loads the new one; a page with unsaved changes can refuse, and Stay keeps
// the window on the old server. The shell must then go back to the old server too, or it rejects
// that page's notifications and links as coming from elsewhere (fromApp checks the origin).
test('Stay after a server change keeps the old server while the window is still on it', () => {
  const change = { previous: 'http://127.0.0.1:18095' };
  assert.equal(serverAfterStay(change, 'http://127.0.0.1:18095/n/Note.md'), 'http://127.0.0.1:18095');
});

test('Stay changes nothing when no server change is waiting, or the window already left the old server', () => {
  assert.equal(serverAfterStay(null, 'http://127.0.0.1:18095/n/Note.md'), null);
  assert.equal(serverAfterStay({ previous: 'http://127.0.0.1:18095' }, 'https://other.example/n/Note.md'), null);
  assert.equal(serverAfterStay({ previous: 'http://127.0.0.1:18095' }, 'file:///pages/offline.html'), null);
});
