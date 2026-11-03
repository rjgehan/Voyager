'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LEGACY_NAME, userDataDir, useUserData } = require('../src/userData');

const APPDATA = path.join('C:', 'Users', 'me', 'AppData', 'Roaming');
const VOYAGER = path.join(APPDATA, 'Voyager');
const NOTESAPP = path.join(APPDATA, 'NotesApp');

test('a computer that ran NotesApp keeps its folder, settings and offline data', () => {
  assert.equal(LEGACY_NAME, 'NotesApp');
  assert.equal(userDataDir(APPDATA, VOYAGER, (dir) => dir === NOTESAPP), NOTESAPP);
  // Even when a Voyager folder appeared too (an earlier run of a development build).
  assert.equal(userDataDir(APPDATA, VOYAGER, () => true), NOTESAPP);
});

test('a new computer gets a Voyager folder', () => {
  assert.equal(userDataDir(APPDATA, VOYAGER, () => false), VOYAGER);
});

test('Electron is pointed at the legacy folder before anything uses it, and left alone otherwise', () => {
  const app = (paths) => ({
    paths,
    getPath(name) {
      if (name === 'userData') throw new Error('asking for userData creates the default folder');
      return this.paths[name];
    },
    getName: () => 'Voyager',
    setPath(name, value) {
      this.calls.push([name, value]);
      this.paths[name] = value;
    },
    calls: [],
  });
  const upgraded = app({ appData: APPDATA, userData: VOYAGER });
  assert.equal(useUserData(upgraded, (dir) => dir === NOTESAPP), NOTESAPP);
  assert.deepEqual(upgraded.calls, [['userData', NOTESAPP]]);
  assert.equal(upgraded.paths.userData, NOTESAPP);

  const fresh = app({ appData: APPDATA, userData: VOYAGER });
  assert.equal(useUserData(fresh, () => false), VOYAGER);
  assert.deepEqual(fresh.calls, []);
});

test('on disk: the settings file NotesApp 1.0 wrote is the one the new app reads', () => {
  const settingsStore = require('../src/settings');
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'voyager-userdata-'));
  try {
    const legacy = path.join(appData, 'NotesApp');
    fs.mkdirSync(legacy);
    // As 1.0.0 saved it (src/settings.js, unchanged since).
    fs.writeFileSync(path.join(legacy, 'settings.json'), JSON.stringify({ serverUrl: 'https://homeserver.example.ts.net:8443', captureHotkey: 'CommandOrControl+Shift+Space', launchAtLogin: true, window: null }));
    const dir = userDataDir(appData, path.join(appData, 'Voyager'));
    assert.equal(dir, legacy);
    const settings = settingsStore.load(path.join(dir, 'settings.json'));
    assert.equal(settings.serverUrl, 'https://homeserver.example.ts.net:8443');
    assert.equal(settings.launchAtLogin, true);

    // Without that folder, a new install starts from the first-run page in its own folder.
    fs.rmSync(legacy, { recursive: true });
    const fresh = userDataDir(appData, path.join(appData, 'Voyager'));
    assert.equal(fresh, path.join(appData, 'Voyager'));
    assert.equal(settingsStore.load(path.join(fresh, 'settings.json')).serverUrl, null);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('main.js chooses the folder before the single-instance lock and before anything is read', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const chosen = main.indexOf('useUserData(app)');
  assert.ok(chosen > 0, 'main.js calls useUserData(app)');
  assert.ok(chosen < main.indexOf('app.requestSingleInstanceLock()'));
  assert.ok(chosen < main.indexOf('app.whenReady()'));
  assert.ok(chosen < main.indexOf('settingsStore.load('));
});

test('main.js registers launch at login again at startup, for the renamed program file', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const loaded = main.indexOf('settings = settingsStore.load(settingsFile());');
  const reapplied = main.indexOf('if (settings.launchAtLogin) applyLaunchAtLogin();');
  assert.ok(loaded > 0 && reapplied > loaded);
  assert.ok(reapplied < main.indexOf('createTray()', loaded));
});
