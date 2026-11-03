import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigateTo, setNavigator, setNewTabOpener } from '../features/navigation';
import { installTabGestures, wantsNewTab } from './gesture';
import { installDesktopBridge, type DesktopCommand, type NotesDesktop } from '../desktop/bridge';
import { activePaneOf, activeTab, allTabs, createWorkspace, split } from './model';
import {
  closeActiveTab,
  focusPaneById,
  loadWorkspace,
  navigateHistory,
  openInNewTab,
  rebaseWorkspace,
  reopenClosedTab,
  resetWorkspace,
  routerNavigated,
  saveWorkspaceNow,
  WORKSPACE_KEY,
  workspace,
} from './store';

/** A fake router: the URL and history index the store reads, and the navigations it asked for. */
let calls: Array<{ to: string; replace: boolean }> = [];
let idx = 0;

function go(to: string, replace: boolean) {
  calls.push({ to, replace });
  if (!replace) idx++;
  window.history.replaceState({ idx }, '', to);
  routerNavigated(to, replace ? 'REPLACE' : 'PUSH');
}

function browserPop(to: string, nextIdx: number) {
  idx = nextIdx;
  window.history.replaceState({ idx }, '', to);
  routerNavigated(to, 'POP');
}

const url = () => window.location.pathname + window.location.search + window.location.hash;

beforeEach(() => {
  calls = [];
  idx = 0;
  window.history.replaceState({ idx: 0 }, '', '/n/a.md');
  resetWorkspace(createWorkspace('/n/a.md'));
  setNavigator((to, opts) => go(to, !!opts?.replace));
});

afterEach(() => {
  setNewTabOpener(null);
  localStorage.clear();
});

describe('the URL and the active tab', () => {
  it('router pushes land in the active tab; back walks it', () => {
    routerNavigated('/n/a.md', 'POP');
    go('/n/b.md', false);
    expect(activeTab(workspace())).toMatchObject({ route: '/n/b.md', back: ['/n/a.md'] });
    browserPop('/n/a.md', 0);
    expect(activeTab(workspace()).route).toBe('/n/a.md');
  });

  it('a new tab pushes its route; back returns to the tab it came from', () => {
    routerNavigated('/n/a.md', 'POP');
    openInNewTab('/n/b.md');
    expect(url()).toBe('/n/b.md');
    expect(calls.at(-1)).toEqual({ to: '/n/b.md', replace: false });
    expect(activePaneOf(workspace()).tabs).toHaveLength(2);
    browserPop('/n/a.md', 0);
    expect(activeTab(workspace()).route).toBe('/n/a.md');
    expect(activePaneOf(workspace()).tabs).toHaveLength(2);
  });

  it('back into another tab’s entry is put back to the active tab', () => {
    routerNavigated('/n/a.md', 'POP');
    go('/n/x.md', false);
    openInNewTab('/n/b.md');
    // The new tab has no history: back lands on /n/x.md, which no tab of the pane shows now.
    browserPop('/n/x.md', 1);
    expect(activeTab(workspace()).route).toBe('/n/x.md');
    expect(url()).toBe('/n/x.md');
  });

  it('switching panes replaces the URL with the pane’s route', () => {
    let ws = createWorkspace('/n/a.md');
    const first = ws.activePane;
    ws = split(ws, first, 'right');
    resetWorkspace(ws);
    go('/n/b.md', false);
    focusPaneById(first);
    expect(url()).toBe('/n/a.md');
    expect(calls.at(-1)).toEqual({ to: '/n/a.md', replace: true });
  });

  it('the desktop app’s navigate command lands in the active pane', () => {
    let ws = createWorkspace('/n/a.md');
    const first = ws.activePane;
    ws = split(ws, first, 'right');
    const second = ws.activePane;
    resetWorkspace(ws);
    focusPaneById(first);
    let send: (cmd: DesktopCommand) => void = () => undefined;
    const shell = {
      isCaptureWindow: false,
      setConnection: () => undefined,
      focusWindow: () => undefined,
      onCommand: (fn: (cmd: DesktopCommand) => void) => {
        send = fn;
        return () => undefined;
      },
    } as unknown as NotesDesktop;
    const remove = installDesktopBridge(shell);
    send({ type: 'navigate', to: '/x/calendar' });
    remove();
    expect(url()).toBe('/x/calendar');
    expect(workspace().activePane).toBe(first);
    expect(activeTab(workspace()).route).toBe('/x/calendar');
    expect(activePaneOf({ ...workspace(), activePane: second }).tabs.map((t) => t.route)).toEqual(['/n/a.md']);
  });

  it('closes and reopens the active tab, following the URL', () => {
    openInNewTab('/n/b.md');
    closeActiveTab();
    expect(url()).toBe('/n/a.md');
    reopenClosedTab();
    expect(url()).toBe('/n/b.md');
  });
});

describe('persistence', () => {
  it('saves per device and adopts the URL on load', () => {
    openInNewTab('/n/b.md');
    saveWorkspaceNow();
    expect(JSON.parse(localStorage.getItem(WORKSPACE_KEY)!).activePane).toBe(workspace().activePane);
    window.history.replaceState(null, '', '/n/a.md');
    const loaded = loadWorkspace();
    expect(activePaneOf(loaded).tabs.map((t) => t.route)).toEqual(['/n/a.md', '/n/b.md']);
    expect(activeTab(loaded).route).toBe('/n/a.md');
  });

  it('leaves the workspace alone on the capture and clip pages', () => {
    openInNewTab('/n/b.md');
    saveWorkspaceNow();
    for (const page of ['/capture', '/clip?url=x']) {
      window.history.replaceState(null, '', page);
      const loaded = loadWorkspace();
      expect(allTabs(loaded).map(({ tab }) => tab.route)).toEqual(['/n/a.md', '/n/b.md']);
    }
  });

  // The desktop capture window and a /clip tab load the workspace and keep that copy: they must
  // never write it over the one the main window saved since (on pagehide, or after a rename).
  for (const page of ['/capture', '/clip?url=x']) {
    it(`${page} never writes its old copy over a newer one`, async () => {
      openInNewTab('/n/b.md');
      saveWorkspaceNow();
      window.history.replaceState(null, '', page);
      resetWorkspace(loadWorkspace());
      const newer = JSON.stringify(createWorkspace('/n/c.md'));
      localStorage.setItem(WORKSPACE_KEY, newer);
      window.dispatchEvent(new Event('pagehide'));
      expect(localStorage.getItem(WORKSPACE_KEY)).toBe(newer);
      rebaseWorkspace('b.md', 'd.md', 'file');
      await new Promise((r) => setTimeout(r, 300));
      expect(localStorage.getItem(WORKSPACE_KEY)).toBe(newer);
    });
  }

  it('pagehide writes only a change that is not saved yet', () => {
    saveWorkspaceNow();
    const newer = JSON.stringify(createWorkspace('/n/c.md'));
    // Another window of this device saved since: an unchanged page leaves that alone.
    localStorage.setItem(WORKSPACE_KEY, newer);
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(WORKSPACE_KEY)).toBe(newer);
    openInNewTab('/n/b.md');
    window.dispatchEvent(new Event('pagehide'));
    expect(allTabs(JSON.parse(localStorage.getItem(WORKSPACE_KEY)!)).map(({ tab }) => tab.route)).toEqual(['/n/a.md', '/n/b.md']);
  });

  it('starts over from a damaged record', () => {
    localStorage.setItem(WORKSPACE_KEY, '{"panes":5}');
    window.history.replaceState(null, '', '/x/tasks');
    expect(activeTab(loadWorkspace()).route).toBe('/x/tasks');
  });
});

describe('new-tab gestures', () => {
  it('Mod-click opens a new tab; in an editable note it takes Mod-Shift', () => {
    const plain = document.createElement('button');
    const editor = document.createElement('div');
    editor.className = 'cm-content';
    editor.setAttribute('contenteditable', 'true');
    const mod = { ctrlKey: true, metaKey: true, shiftKey: false };
    expect(wantsNewTab({ ...mod, target: plain })).toBe(true);
    expect(wantsNewTab({ ...mod, target: editor })).toBe(false);
    expect(wantsNewTab({ ...mod, shiftKey: true, target: editor })).toBe(true);
    expect(wantsNewTab({ ctrlKey: false, metaKey: false, shiftKey: false, target: plain })).toBe(false);
  });

  it('navigateTo during a middle click opens a new tab', () => {
    const remove = installTabGestures();
    const opened: string[] = [];
    setNewTabOpener((to) => opened.push(to));
    const row = document.createElement('div');
    row.setAttribute('role', 'treeitem');
    row.addEventListener('click', () => navigateTo('/n/c.md'));
    document.body.appendChild(row);
    row.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(opened).toEqual(['/n/c.md']);
    // A plain click navigates the tab.
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(opened).toEqual(['/n/c.md']);
    expect(calls.at(-1)).toEqual({ to: '/n/c.md', replace: false });
    row.remove();
    remove();
  });
});

// The app reopened (desktop app, a new browser tab, the Home-Screen app): the tab's saved history
// comes back, but the browser has no earlier entry of the app to go back to.
describe('back and forward after the app is reopened', () => {
  function reopenAt(page: string) {
    const saved = createWorkspace('/n/c.md');
    const pane = activePaneOf(saved);
    pane.tabs[0] = { ...pane.tabs[0], back: ['/n/a.md', '/n/b.md'], forward: [] };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(saved));
    idx = 0;
    window.history.replaceState({ idx: 0 }, '', page);
    resetWorkspace(loadWorkspace());
  }

  it('Back walks the tab’s own history instead of leaving the app', () => {
    reopenAt('/n/c.md');
    routerNavigated('/n/c.md', 'POP');
    const back = vi.spyOn(window.history, 'back');
    navigateHistory('back');
    expect(back).not.toHaveBeenCalled();
    expect(activeTab(workspace())).toMatchObject({ route: '/n/b.md', back: ['/n/a.md'], forward: ['/n/c.md'] });
    expect(url()).toBe('/n/b.md');
    expect(calls.at(-1)).toEqual({ to: '/n/b.md', replace: true });
    navigateHistory('back');
    expect(url()).toBe('/n/a.md');
    navigateHistory('back');
    expect(url()).toBe('/n/a.md');
    const forward = vi.spyOn(window.history, 'forward');
    navigateHistory('forward');
    navigateHistory('forward');
    expect(forward).not.toHaveBeenCalled();
    expect(activeTab(workspace())).toMatchObject({ route: '/n/c.md', back: ['/n/a.md', '/n/b.md'], forward: [] });
  });

  it('starting at "/" (the installed app) does not add the note it reopens to its own history', () => {
    reopenAt('/');
    // HomePage opens the last note.
    go('/n/c.md', true);
    expect(activeTab(workspace()).back).toEqual(['/n/a.md', '/n/b.md']);
    navigateHistory('back');
    expect(url()).toBe('/n/b.md');
  });

  it('within a session, the browser’s own history is used as before', () => {
    routerNavigated('/n/a.md', 'POP');
    go('/n/b.md', false);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => browserPop('/n/a.md', 0));
    navigateHistory('back');
    expect(back).toHaveBeenCalledTimes(1);
    expect(activeTab(workspace()).route).toBe('/n/a.md');
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => browserPop('/n/b.md', 1));
    navigateHistory('forward');
    expect(forward).toHaveBeenCalledTimes(1);
    expect(activeTab(workspace()).route).toBe('/n/b.md');
  });
});
