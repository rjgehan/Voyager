# Desktop app

The desktop app shows Voyager in its own window on Windows and macOS, with a tray icon, a quick-capture key that works from any program, and native notifications. It is a window around your own server: it shows the same notes as the browser, and every update of the server updates the app too.

Step-by-step installation, including what to do when Windows SmartScreen or macOS Gatekeeper warn about an unsigned app, is in [DESKTOP.md](https://github.com/rjgehan/notesapp/blob/main/docs/DESKTOP.md).

## Before you start

- **Tailscale** must be installed and connected on the computer, signed in with an account the server allows (the same as for the browser).
- Know the server's address, the one you open in the browser.

## First launch

The app asks for the server's address. Type it as you would in the browser; `https://` is added for you. **Connect** checks that the server answers and lets this computer in, then opens Voyager. If it cannot, it says why (most often: Tailscale is not connected).

On the same page you can change the quick-capture key and turn on **Launch Voyager at login**. You can come back to it later from the tray icon's **Settings…**.

## Everyday use

- **Closing the window** keeps Voyager running in the tray (the notification area on Windows, the menu bar on a Mac), so quick capture, live sync and reminders keep working. **Quit** is in the tray menu.
- **The tray menu** has Quick capture, Open Voyager, Open today's note, Reload, Launch at login, Settings… and Quit.
- **Quick capture from anywhere**: press `Ctrl+Shift+Space` (Mac: `Cmd+Shift+Space`) in any program. A small window opens on top; type, choose **Inbox** or **Today**, and save with `Ctrl+Enter`. `Esc` closes it without saving. Inside Voyager too, this key opens the small window rather than the in-app capture dialog.
- **Reminders** arrive as Windows or macOS notifications when **In the app** is switched on under Settings › Reminders. Clicking one brings Voyager to the front.
- **Links to websites** open in your usual browser; the app's window only ever shows your server.
- **Offline**: without a connection, the app opens from its offline copy and the window title says **Offline**. Before it has one, it shows "Can't reach the server. Is Tailscale connected?" and retries by itself.
- The window title also shows **Reconnecting…** while the connection is being restored, for example after the computer wakes up.

Everything else works as in the browser, with one bonus: `Ctrl+Shift+T` reopens the last closed Voyager tab (in a browser, the browser keeps that key for itself).
