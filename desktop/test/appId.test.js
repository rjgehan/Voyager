'use strict';
// The taskbar identity (src/appId.js): Windows takes a window's taskbar icon from the Start-menu
// shortcut that carries its AppUserModelID, so the installed app must be the only one with its id.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { APP_ID, DEV_APP_ID, appUserModelId, startMenuPrograms, strayShortcuts, removeStrayShortcuts } = require('../src/appId');

const PROGRAMS = path.join('C:', 'Users', 'me', 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const VOYAGER_EXE = 'C:\\Users\\me\\AppData\\Local\\Programs\\NotesApp\\Voyager.exe';
const DEV_ELECTRON = 'C:\\dev\\NotesApp\\desktop\\node_modules\\electron\\dist\\electron.exe';

/** A Start-menu folder of `{ name: link }`; a link of `null` cannot be read. */
function io(links) {
  return {
    readdir: () => Object.keys(links),
    readShortcutLink(file) {
      const link = links[path.basename(file)];
      if (!link) throw new Error('not a shortcut');
      return link;
    },
  };
}

test('the installed app uses the installer\'s id, a development run one of its own', () => {
  assert.equal(APP_ID, 'com.rjgehan.notesapp.desktop');
  assert.equal(appUserModelId(true), APP_ID);
  assert.equal(appUserModelId(false), DEV_APP_ID);
  assert.notEqual(DEV_APP_ID, APP_ID);
});

test('the Start-menu folder is the current user\'s', () => {
  assert.equal(startMenuPrograms({ APPDATA: path.join('C:', 'Users', 'me', 'AppData', 'Roaming') }), PROGRAMS);
  assert.equal(startMenuPrograms({}), null);
});

test('the shortcut Electron left for a development run under the installed id is stray', () => {
  const found = strayShortcuts(PROGRAMS, APP_ID, VOYAGER_EXE, io({
    'Electron.lnk': { target: DEV_ELECTRON, appUserModelId: APP_ID },
    'Voyager.lnk': { target: VOYAGER_EXE, appUserModelId: APP_ID },
  }));
  assert.deepEqual(found, [path.join(PROGRAMS, 'Electron.lnk')]);
});

test('the installer\'s shortcuts and other apps\' are left alone', () => {
  const found = strayShortcuts(PROGRAMS, APP_ID, VOYAGER_EXE, io({
    // This program, whatever the case of its path.
    'Voyager.lnk': { target: VOYAGER_EXE.toUpperCase(), appUserModelId: APP_ID },
    // Another Electron app's development shortcut.
    'Electron.lnk': { target: DEV_ELECTRON, appUserModelId: 'com.example.other' },
    // A development run with its own id.
    'Electron (dev).lnk': { target: DEV_ELECTRON, appUserModelId: DEV_APP_ID },
    // Our id on something that is not a development Electron: not ours to judge.
    'Other.lnk': { target: 'C:\\Tools\\other.exe', appUserModelId: APP_ID },
    'No id.lnk': { target: DEV_ELECTRON },
    'Unreadable.lnk': null,
    'readme.txt': { target: DEV_ELECTRON, appUserModelId: APP_ID },
  }));
  assert.deepEqual(found, []);
});

test('a missing Start-menu folder finds nothing', () => {
  const found = strayShortcuts(PROGRAMS, APP_ID, VOYAGER_EXE, {
    readdir() {
      throw new Error('ENOENT');
    },
    readShortcutLink() {
      throw new Error('unreachable');
    },
  });
  assert.deepEqual(found, []);
});

test('removing deletes only the stray shortcut, and a failure does not throw', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'voyager-appid-'));
  try {
    const dir = startMenuPrograms({ APPDATA: appData });
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['Electron.lnk', 'Voyager.lnk']) fs.writeFileSync(path.join(dir, name), '');
    const links = {
      'Electron.lnk': { target: DEV_ELECTRON, appUserModelId: APP_ID },
      'Voyager.lnk': { target: VOYAGER_EXE, appUserModelId: APP_ID },
    };
    const readShortcutLink = (file) => links[path.basename(file)];
    const removed = removeStrayShortcuts({ execPath: VOYAGER_EXE, readShortcutLink, env: { APPDATA: appData } });
    assert.deepEqual(removed, [path.join(dir, 'Electron.lnk')]);
    assert.deepEqual(fs.readdirSync(dir), ['Voyager.lnk']);

    links['Again.lnk'] = links['Electron.lnk'];
    fs.writeFileSync(path.join(dir, 'Again.lnk'), '');
    const failing = removeStrayShortcuts({
      execPath: VOYAGER_EXE,
      readShortcutLink,
      env: { APPDATA: appData },
      unlink() {
        throw new Error('EPERM');
      },
    });
    assert.deepEqual(failing, []);
    assert.deepEqual(removeStrayShortcuts({ execPath: VOYAGER_EXE, readShortcutLink, env: {} }), []);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('main.js removes stray shortcuts before it sets the id, and only when installed on Windows', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const remove = main.indexOf('removeStrayShortcuts({');
  const set = main.indexOf('app.setAppUserModelId(appUserModelId(app.isPackaged))');
  assert.ok(remove > 0 && set > remove);
  assert.match(main.slice(main.lastIndexOf('if (', remove), remove), /process\.platform === 'win32' && app\.isPackaged/);
});
