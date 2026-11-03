'use strict';
// The app's identity on the Windows taskbar (docs/DESIGN.md §6.39 "Taskbar identity").
//
// Windows draws a window's taskbar button with the icon of the Start-menu shortcut that carries the
// window's AppUserModelID, not with the window's own icon. Electron's notification support creates
// such a shortcut by itself the first time an app with no matching shortcut shows a notification:
// `Start Menu\Programs\Electron.lnk`, pointing at node_modules\electron\dist\electron.exe, with the
// Electron atom. A development run (`npm start`) that used the installed app's id therefore left a
// second shortcut with that id, and the installed Voyager's taskbar button took the atom from it.
//
// So a development run has an id of its own, and the installed app removes shortcuts that a
// development run left under its id.
const fs = require('node:fs');
const path = require('node:path');

/** The installed app's AppUserModelID; the installer's shortcuts carry it (electron-builder.yml appId). */
const APP_ID = 'com.rjgehan.notesapp.desktop';
/** The id of a development run (`electron .`), which never shares a taskbar button with the installed app. */
const DEV_APP_ID = `${APP_ID}.dev`;

/** @param {boolean} isPackaged Electron's `app.isPackaged` */
function appUserModelId(isPackaged) {
  return isPackaged ? APP_ID : DEV_APP_ID;
}

/** The current user's Start-menu programs folder, where Electron puts its notification shortcut. */
function startMenuPrograms(env = process.env) {
  return env.APPDATA ? path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null;
}

/**
 * Shortcuts directly in `dir` that claim `appId` but start a development build's electron.exe
 * rather than this program. The installer's own shortcuts (and anyone else's) are left alone.
 * @param {string} dir
 * @param {string} appId
 * @param {string} execPath this program (`process.execPath`)
 * @param {{ readdir(dir: string): string[], readShortcutLink(file: string): { target?: string, appUserModelId?: string } }} io
 * @returns {string[]}
 */
function strayShortcuts(dir, appId, execPath, io) {
  let names;
  try {
    names = io.readdir(dir);
  } catch {
    return [];
  }
  const self = path.win32.normalize(execPath).toLowerCase();
  const stray = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.lnk')) continue;
    const file = path.join(dir, name);
    let link;
    try {
      link = io.readShortcutLink(file);
    } catch {
      continue;
    }
    if (!link || link.appUserModelId !== appId || typeof link.target !== 'string') continue;
    const target = path.win32.normalize(link.target).toLowerCase();
    if (target === self || path.win32.basename(target) !== 'electron.exe') continue;
    stray.push(file);
  }
  return stray;
}

/**
 * Removes the stray shortcuts (Windows, installed app only). Failures are ignored: the taskbar
 * then keeps the wrong icon, which is no reason to stop the app.
 * @param {{ execPath: string, readShortcutLink: (file: string) => object, env?: object, unlink?: (file: string) => void }} opts
 * @returns {string[]} the shortcuts removed
 */
function removeStrayShortcuts({ execPath, readShortcutLink, env = process.env, unlink = fs.unlinkSync }) {
  const dir = startMenuPrograms(env);
  if (!dir) return [];
  const removed = [];
  for (const file of strayShortcuts(dir, APP_ID, execPath, { readdir: fs.readdirSync, readShortcutLink })) {
    try {
      unlink(file);
      removed.push(file);
    } catch {
      // Left in place.
    }
  }
  return removed;
}

module.exports = { APP_ID, DEV_APP_ID, appUserModelId, startMenuPrograms, strayShortcuts, removeStrayShortcuts };
