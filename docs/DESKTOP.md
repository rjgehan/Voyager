# Voyager desktop app (Windows and macOS)

Voyager has a desktop app for Windows and macOS (ROADMAP item 41). It is a thin, locked-down window around **your own Voyager server**: it contains no copy of the app, so every deploy updates it too, and it shows the same live-synced vault as the browser. On top of the browser it adds:

- its own window and taskbar or Dock icon, which remembers its position and size;
- a **tray icon** (Windows notification area, macOS menu bar) with Quick capture, Open Voyager, Open today's note, Reload, Launch at login, Settings… and Quit;
- a **system-wide quick-capture shortcut**, `Ctrl+Shift+Space` on Windows and `Cmd+Shift+Space` on macOS, that opens a small always-on-top capture window from any app;
- **native notifications** (reminders from item 9, when that is switched on);
- optional **launch at login**, straight into the tray;
- the connection state in the window title (`— Reconnecting…`, `— Offline`), and offline use through the app's own offline mode (item 8).

With several vaults on the server (ROADMAP item 37), the window switches vaults like the browser (the switcher in the sidebar); the capture window captures into the default vault, and the tray's *Open today's note* opens it in the vault the window shows.

The design is in [DESIGN.md §6.39](DESIGN.md); the code is in [`desktop/`](../desktop).

## Requirements

- Windows 10 or 11 (x64), or macOS 11 or later (Intel or Apple Silicon).
- **Tailscale** installed and connected on the computer, signed in with a login the server allows (`NOTES_IDENTITY_ALLOWED_LOGINS`, see DEPLOY.md). The desktop app has no login of its own: the server recognises the computer by its Tailscale identity, exactly as for the browser, and the app stores no tokens or passwords.
- The server's address, the one you open in the browser, for example `https://notes.<tailnet>.ts.net`.

## Download

Builds are attached to the GitHub releases named `desktop-v…` of the repository:

- Windows: `Voyager-Setup-<version>.exe`
- macOS: `Voyager-<version>-mac.dmg` (one universal app for Intel and Apple Silicon)

## Install on Windows

1. Run `Voyager-Setup-<version>.exe`. The installer is **not code-signed**, so Microsoft Defender SmartScreen may say "Windows protected your PC": choose **More info**, then **Run anyway**. This happens once per version.
2. Pick the install folder (the default is per user, no administrator rights needed). The installer adds Start menu and desktop shortcuts.
3. Uninstall from Settings › Apps. Your settings stay in the user-data folder (`%APPDATA%\Voyager`, or `%APPDATA%\NotesApp` on a computer that had the app before it was renamed) so a reinstall keeps them; delete that folder to start fresh.

## Install on macOS

The app is **not signed with an Apple Developer ID and not notarised** (it carries only an ad-hoc signature, which Apple Silicon needs to run it). Gatekeeper therefore blocks the first launch. To install:

1. Open the dmg and drag **Voyager** to **Applications**.
2. Open **Applications** in Finder, **Control-click** (or right-click) Voyager and choose **Open**, then **Open** again in the dialog. From macOS 15 (Sequoia) on, that dialog has no Open button: click **Done**, then go to **System Settings › Privacy & Security**, scroll to "Voyager was blocked…", click **Open Anyway**, confirm with your password, and open the app again.
3. If macOS instead says the app "is damaged and can't be opened", the download's quarantine flag is the cause. Remove it in Terminal and open the app again:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Voyager.app
   ```

4. If the app quits immediately on an Apple Silicon Mac (the signature did not survive copying), sign it again ad hoc:

   ```sh
   codesign --force --deep --sign - /Applications/Voyager.app
   ```

You only need to do this once per version. The first time you use the capture shortcut, macOS may ask for nothing at all (global shortcuts need no Accessibility permission); notifications are allowed in System Settings › Notifications › Voyager.

## Updating from NotesApp

The desktop app was called **NotesApp** until version 1.1.0 (ROADMAP item 45). It is the same app with a new name and icon, and the update keeps everything:

- **Windows:** run `Voyager-Setup-1.1.0.exe` (or later). It recognises the NotesApp installation (the app's id, `com.rjgehan.notesapp.desktop`, never changes), closes NotesApp if it is running, runs NotesApp's own uninstaller, which removes `NotesApp.exe` and the NotesApp shortcuts but not your data, and installs Voyager. The folder page proposes the folder NotesApp was in (`%LOCALAPPDATA%\Programs\NotesApp`); keep it, or change it to `%LOCALAPPDATA%\Programs\Voyager`: the old folder is emptied either way, so there is never a second copy. Settings › Apps then lists one app, *Voyager 1.1.0*, and the Start menu and desktop have Voyager shortcuts.
- **macOS:** drag **Voyager** to Applications as above, then move **NotesApp** from Applications to the Bin (a dmg never replaces another app). The Gatekeeper steps are needed once for the new app.
- **Your settings and offline copy stay.** A computer that ran NotesApp keeps using its folder (`%APPDATA%\NotesApp`, `~/Library/Application Support/NotesApp`): Voyager opens straight onto your server, with the same shortcut, window position, offline notes and unsent captures. A computer that never had NotesApp uses a `Voyager` folder.
- **Launch at login** is registered again for the new program the first time Voyager starts. On a Mac, remove a leftover *NotesApp* entry from System Settings › General › Login Items if it is still listed.
- **A taskbar pin** made for NotesApp points at the removed `NotesApp.exe`: unpin it and pin Voyager.
- **The taskbar shows Electron's atom instead of the disc** on a computer where the app was also run from source (`npm start` before 1.1.1): that run left a Start-menu shortcut, `Electron.lnk`, under the installed app's id, and Windows took the taskbar icon from it. Voyager 1.1.1 and later delete that shortcut when they start; the disc appears from the next start (Windows takes a few seconds to notice the change). Development runs now use an id of their own (`com.rjgehan.notesapp.desktop.dev`).
- **Update the server and the desktop app together.** NotesApp 1.0 checks that the server's manifest names *NotesApp*, so once the server says *Voyager*, the automatic retry on its offline page stops succeeding (the **Retry** button still works) and its Settings… page refuses the address. Voyager accepts a server of either name.

## First launch

The app asks for the server address. Type it as you would in the browser (`notes.<tailnet>.ts.net` is enough: `https://` is added). **Connect** checks that the server answers and admits this computer, then opens the app:

| Message | What to do |
|---|---|
| Can't reach the server. Is Tailscale connected? | Connect Tailscale and check the name. **Save anyway** keeps the address so the app connects once Tailscale is up. |
| The server doesn't answer to this host name. | The server's `NOTES_ALLOWED_HOSTS` doesn't list the name you typed. Use the name you use in the browser, or add it on the server. |
| The server doesn't allow this computer's Tailscale login. | Add the login to `NOTES_IDENTITY_ALLOWED_LOGINS` on the server. |
| The server's HTTPS certificate was not accepted. | Use the `*.ts.net` name: Tailscale issues its certificate. |
| Use https:// | Plain `http://` works only for `localhost` (development); over the tailnet the app needs HTTPS for offline mode. |

On the same page you can change the quick-capture shortcut (an Electron accelerator such as `CommandOrControl+Alt+N`; empty for none) and switch on **Launch Voyager at login**. The page comes back under tray › **Settings…**.

## Everyday use

- **Closing the window** keeps Voyager running in the tray, so the shortcut, live sync and reminders keep working. **Quit Voyager** is in the tray menu (and `Cmd+Q` on macOS). Opening Voyager again while it runs brings back the existing window.
- **Quick capture:** press the shortcut anywhere. A small window opens over everything, on the screen you're working on, with the same capture form as the app (Inbox or today's note, photos, offline queue). `Ctrl+Enter` / `Cmd+Enter` saves; `Esc` or Cancel closes it (an unsent draft is discarded). "Open the note" opens the result in the main window. The shortcut is system-wide, so inside Voyager it opens this window rather than the in-app capture dialog. If another app already uses the shortcut, a notification says so: choose another under Settings….
- **Unsaved changes:** when a note has changes not yet saved to the server (offline, a conflict, or just typed), **Reload**, a new server address or a vault switch first asks whether to continue; the changes stay on this computer either way. **Quit Voyager** quits without asking, and the changes are saved the next time Voyager reaches the server.
- **Open today's note** in the tray opens (or creates) today's daily note.
- **Links** to other websites open in your default browser; `mailto:` links in your mail app. The window itself never leaves your server.
- **Notifications:** when reminders are delivered in the app (ROADMAP item 9, "in-app" route), they appear as native notifications; clicking one brings Voyager to the front and opens the task or note. Web Push is not available inside the desktop app; it doesn't need it, because the app keeps running in the tray.
- **Offline:** if the server can't be reached, Voyager opens from its offline copy (the app keeps it by itself; "Keep recent notes for offline reading" in its Settings adds your recent notes) and the title says *Offline*. Without an offline copy yet you see "Can't reach the server. Is Tailscale connected?" with **Retry**; it also retries every 15 seconds and when the network returns. After sleep, Voyager reconnects live sync straight away.
- **Microphone:** voice notes and dictation may use the microphone (the system asks once). The app is never given the camera, location or other devices.

## Security

- Each window runs the server's pages in Chromium's sandbox with context isolation and no Node.js; the server's Content Security Policy applies unchanged.
- Navigation is locked to the configured server's origin; other links go to the default browser, and other link types (files, scripts, custom protocols) are refused.
- Only notifications, clipboard writes, fullscreen and the microphone are granted, and only to the server.
- The pages can reach the shell only through a small bridge (notifications, the capture window, the title's connection state and the tray's commands); messages from any other page are ignored.
- Settings (`settings.json` in `%APPDATA%\Voyager` or `~/Library/Application Support/Voyager`, or the `NotesApp` folder of a computer that had the app before it was renamed) hold the server address, the shortcut, launch at login and the window position. Cookies, the offline copy and the capture queue are in the same folder, like a browser profile.

## Building it yourself

```sh
cd desktop
npm ci
npm test                 # unit tests (node --test)
node ../scripts/brand/render-icons.mjs   # the icons, after changing the drawings (BRAND.md)
npm start                # run from source (its own taskbar id, so it never takes over the installed app's button)
npm run dist:win         # Windows: dist/Voyager-Setup-<version>.exe (on Windows)
npm run dist:mac         # macOS: dist/Voyager-<version>-mac.dmg (on a Mac)
npm run dist:dir         # an unpacked app in dist/, quickest for a try-out
```

Against a local backend: start the backend's dev profile on `127.0.0.1:18330` with `notes.allowed-hosts` listing `127.0.0.1:5175`, run `vite preview --port 5175` (or `vite` for development) in `frontend/` with `NOTES_DEV_BACKEND=http://127.0.0.1:18330`, and connect the app to `http://127.0.0.1:5175`. The service worker (offline mode) runs only with a production build (`vite build` + `vite preview`).

### Releases

Push a tag `desktop-v<version>` (for example `git tag desktop-v1.0.1 && git push origin desktop-v1.0.1`). The **Desktop app** workflow ([`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)) creates the release as a draft, builds the Windows installer and the macOS dmg on GitHub's runners with the version taken from the tag, attaches both, and only then publishes the release. If either platform fails, the release stays a draft (visible only to the repository's maintainers on the Releases page): fix the cause and re-run the failed jobs, or delete the draft and tag again. Ordinary pushes never build the desktop app; it rarely changes, because its UI comes from the server. **Run workflow** on the Actions tab builds both without publishing.

The packages include Electron's licence and Chromium's third-party licences (`LICENSE.electron.txt`, `LICENSES.chromium.html` next to the executable). The shell itself is GPL-3.0-only, like the rest of the repository.
