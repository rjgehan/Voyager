'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { windowTitle, isConnectionState } = require('../src/title');

test('the title shows the connection state', () => {
  assert.equal(windowTitle('Inbox · Voyager', 'live'), 'Inbox · Voyager');
  assert.equal(windowTitle('Inbox · Voyager', 'reconnecting'), 'Inbox · Voyager — Reconnecting…');
  assert.equal(windowTitle('Inbox · Voyager', 'offline'), 'Inbox · Voyager — Offline');
  assert.equal(windowTitle('', 'offline'), 'Voyager — Offline');
  assert.equal(windowTitle(undefined, 'weird'), 'Voyager');
});

test('connection states', () => {
  assert.equal(isConnectionState('live'), true);
  assert.equal(isConnectionState('reconnecting'), true);
  assert.equal(isConnectionState('offline'), true);
  assert.equal(isConnectionState('online'), false);
  assert.equal(isConnectionState(undefined), false);
});
