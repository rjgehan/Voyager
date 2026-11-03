'use strict';
// The app's user-data folder (docs/DESKTOP.md "Where things are"). It holds settings.json (the
// server's address, the capture shortcut, launch at login, the window) and Chromium's storage for the
// server's origin: the service worker and its cached app, IndexedDB (offline notes, the capture
// queue, unsent drafts) and localStorage (this device's settings).
//
// Electron names the folder after productName, which became Voyager in 1.1.0 (ROADMAP item 45). A
// computer that ran the app as NotesApp keeps using %APPDATA%\NotesApp (~/Library/Application
// Support/NotesApp on macOS), so the update finds its server and keeps its offline data; a computer
// that never did gets a Voyager folder. Nothing is copied or moved.
const fs = require('node:fs');
const path = require('node:path');

/** The folder's name before 1.1.0: the old productName. */
const LEGACY_NAME = 'NotesApp';

/**
 * The folder to use: the legacy one when it exists, otherwise Electron's default.
 * @param {string} appData Electron's `appData` path (%APPDATA%, ~/Library/Application Support)
 * @param {string} current Electron's default `userData` path (appData/<productName>)
 * @param {(dir: string) => boolean} exists
 */
function userDataDir(appData, current, exists = isDirectory) {
  const legacy = path.join(appData, LEGACY_NAME);
  return exists(legacy) ? legacy : current;
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Points Electron at the folder. Must run before the app is ready and before
 * `requestSingleInstanceLock()`, which keeps its lock in this folder. The default is worked out
 * from the name rather than asked for: asking Electron for `userData` creates that folder, and an
 * updated computer should not get an empty Voyager folder next to its NotesApp one.
 * @param {{ getPath(name: string): string, getName(): string, setPath(name: string, value: string): void }} app
 * @returns {string} the folder in use
 */
function useUserData(app, exists = isDirectory) {
  const appData = app.getPath('appData');
  const current = path.join(appData, app.getName());
  const dir = userDataDir(appData, current, exists);
  if (dir !== current) app.setPath('userData', dir);
  return dir;
}

module.exports = { LEGACY_NAME, userDataDir, useUserData };
