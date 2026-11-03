// Focus helpers (DESIGN §6.19): the Tab trap of modal overlays, arrow keys in menus, and where the
// focus goes when an overlay closes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelNoteFocus, menuKey, requestNoteFocus, returnFocus, trapTab, wantsNoteFocus } from './focus';

function key(key: string, shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, shiftKey, cancelable: true });
}

beforeEach(() => {
  // jsdom lays nothing out, so nothing has an offsetParent: treat attached elements as shown.
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) {
    return this.isConnected && !this.hidden ? this.parentElement : null;
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

function dialog(): { panel: HTMLElement; first: HTMLButtonElement; field: HTMLInputElement; last: HTMLButtonElement; outside: HTMLButtonElement } {
  document.body.innerHTML = `
    <button id="outside">Outside</button>
    <div id="panel" tabindex="-1">
      <button id="first">First</button>
      <button disabled>Off</button>
      <input id="field" />
      <button hidden>Hidden</button>
      <div inert><button>Inert</button></div>
      <button id="last">Last</button>
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  return { panel: $('panel'), first: $('first'), field: $('field'), last: $('last'), outside: $('outside') };
}

describe('requestNoteFocus', () => {
  afterEach(() => cancelNoteFocus());

  it('is taken by the view of the file it was made for, not by another file’s view mounting first', () => {
    // A new note opening: the previous note's view may mount for a moment on the way.
    requestNoteFocus('Plan.md');
    expect(wantsNoteFocus('A.md')).toBe(false);
    expect(wantsNoteFocus('Plan.md')).toBe(true);
  });

  it('without a file, is taken by the next view whatever its file', () => {
    requestNoteFocus();
    expect(wantsNoteFocus('A.md')).toBe(true);
  });

  it('ends with the task that took it, but a newer request made meanwhile stays', async () => {
    requestNoteFocus('Untitled.md');
    expect(wantsNoteFocus('Untitled.md')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(wantsNoteFocus('Untitled.md')).toBe(false);
    // A new note's text took the focus, then its title renames it: the renamed view takes it again.
    requestNoteFocus('Untitled.md');
    expect(wantsNoteFocus('Untitled.md')).toBe(true);
    requestNoteFocus();
    await new Promise((r) => setTimeout(r, 0));
    expect(wantsNoteFocus('Groceries.md')).toBe(true);
  });
});

describe('trapTab', () => {
  it('wraps Tab from the last element to the first, and Shift-Tab from the first to the last', () => {
    const { panel, first, last } = dialog();
    last.focus();
    const tab = key('Tab');
    trapTab(tab, panel);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const back = key('Tab', true);
    trapTab(back, panel);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab between inner elements to the browser, skipping disabled, hidden and inert ones', () => {
    const { panel, first } = dialog();
    first.focus();
    const tab = key('Tab');
    trapTab(tab, panel);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('brings the focus back in from outside, and from the panel itself', () => {
    const { panel, first, last, outside } = dialog();
    outside.focus();
    trapTab(key('Tab'), panel);
    expect(document.activeElement).toBe(first);
    panel.focus();
    trapTab(key('Tab', true), panel);
    expect(document.activeElement).toBe(last);
  });

  it('ignores other keys', () => {
    const { panel, last } = dialog();
    last.focus();
    const down = key('ArrowDown');
    trapTab(down, panel);
    expect(down.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(last);
  });
});

describe('menuKey', () => {
  function menu(): { el: HTMLElement; items: HTMLElement[] } {
    document.body.innerHTML = `
      <div role="menu">
        <button role="menuitem">One</button>
        <button role="menuitem" disabled>Off</button>
        <button role="menuitemcheckbox">Two</button>
        <button role="menuitem">Three</button>
      </div>`;
    const el = document.querySelector<HTMLElement>('[role=menu]')!;
    return { el, items: [...el.querySelectorAll<HTMLElement>('[role^=menuitem]:not([disabled])')] };
  }

  it('moves with the arrows, wrapping, and jumps with Home and End', () => {
    const { el, items } = menu();
    items[0].focus();
    expect(menuKey(key('ArrowDown'), el)).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    menuKey(key('End'), el);
    expect(document.activeElement).toBe(items[2]);
    menuKey(key('ArrowDown'), el);
    expect(document.activeElement).toBe(items[0]);
    menuKey(key('ArrowUp'), el);
    expect(document.activeElement).toBe(items[2]);
    menuKey(key('Home'), el);
    expect(document.activeElement).toBe(items[0]);
  });

  it('starts from the last item on ↑ when no item has the focus', () => {
    const { el, items } = menu();
    menuKey(key('ArrowUp'), el);
    expect(document.activeElement).toBe(items[2]);
  });

  it('leaves other keys alone', () => {
    const { el } = menu();
    const e = key('a');
    expect(menuKey(e, el)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('returnFocus', () => {
  it('returns the focus to the element that had it', () => {
    const { first, panel } = dialog();
    returnFocus(first, panel);
    expect(document.activeElement).toBe(first);
  });

  it('gives it to the active pane when that element is gone, never leaving it on the body', async () => {
    document.body.innerHTML = '<div id="workspace-scroll" tabindex="-1"><div class="cm-content" contenteditable="true"></div></div>';
    const gone = document.createElement('input');
    returnFocus(gone, null);
    await Promise.resolve();
    expect(document.activeElement).toBe(document.querySelector('.cm-content'));
  });

  it('keeps a focus that something else took meanwhile', async () => {
    const { first, field } = dialog();
    field.focus();
    returnFocus(first, null);
    await Promise.resolve();
    expect(document.activeElement).toBe(field);
  });
});
