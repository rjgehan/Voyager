// Keyboard operation of the shell's shared controls (DESIGN §6.19, docs/ACCESSIBILITY.md): panel tabs,
// context menus, the phone's ⋯ menu and the skip link, with axe on each.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Hash, Star } from 'lucide-react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/endpoints';
import { MockVault } from '../../api/mock/vault';
import { queryClient } from '../../api/queryClient';
import { registerPanel } from '../../extensions';
import { registerBuiltins } from '../../extensions/builtins';
import { axeViolations } from '../../test/axe';
import { ContextMenu } from '../overlays/ContextMenu';
import { PanelTabs } from './Panels';
import { TopBar } from './TopBar';

function First() {
  return <p>First panel</p>;
}
function Second() {
  return <p>Second panel</p>;
}
function Third() {
  return <p>Third panel</p>;
}

beforeEach(() => {
  registerPanel({ id: 'kb-one', side: 'right', title: 'One', icon: Hash, component: First, load: () => Promise.resolve({ default: First }) });
  registerPanel({ id: 'kb-two', side: 'right', title: 'Two', icon: Star, component: Second, load: () => Promise.resolve({ default: Second }) });
  registerPanel({ id: 'kb-three', side: 'right', title: 'Three', icon: Hash, component: Third, load: () => Promise.resolve({ default: Third }) });
});

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

describe('panel tabs (ARIA tabs pattern)', () => {
  function Harness() {
    const [active, setActive] = useState('kb-one');
    return (
      <MemoryRouter>
        <PanelTabs side="right" active={active} onSelect={setActive} />
      </MemoryRouter>
    );
  }

  it('has one Tab stop, and the arrows, Home and End move between panels', async () => {
    render(<Harness />);
    const strip = screen.getByRole('tablist', { name: 'Right sidebar' });
    const tab = (name: string) => screen.getByRole('tab', { name });
    // Only the selected tab is in the Tab order; it controls the one panel shown.
    expect(tab('One')).toHaveAttribute('tabindex', '0');
    expect(tab('Two')).toHaveAttribute('tabindex', '-1');
    expect(tab('One')).toHaveAttribute('aria-controls', 'panel-kb-one');
    expect(tab('Two')).not.toHaveAttribute('aria-controls');
    tab('One').focus();
    fireEvent.keyDown(strip, { key: 'ArrowRight' });
    expect(tab('Two')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Two')).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Second panel');
    fireEvent.keyDown(strip, { key: 'End' });
    const last = screen.getAllByRole('tab').at(-1)!;
    expect(last).toHaveFocus();
    fireEvent.keyDown(strip, { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[0]).toHaveFocus();
    fireEvent.keyDown(strip, { key: 'ArrowLeft' });
    expect(last).toHaveFocus();
    fireEvent.keyDown(strip, { key: 'Home' });
    expect(screen.getAllByRole('tab')[0]).toHaveFocus();
    expect(await axeViolations()).toEqual([]);
  });
});

describe('context menu (ARIA menu pattern)', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Actions
        </button>
        {open && (
          <ContextMenu
            x={10}
            y={10}
            label="File actions"
            onClose={() => setOpen(false)}
            items={[
              { id: 'a', label: 'Rename', run() {} },
              { id: 'b', label: 'Move', disabled: true, run() {} },
              'separator',
              { id: 'c', label: 'Delete', danger: true, run() {} },
            ]}
          />
        )}
      </>
    );
  }

  it('focuses the first item, moves with arrows, Home and End, and Tab closes it back to its opener', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Actions' });
    opener.focus();
    fireEvent.click(opener);
    const menu = screen.getByRole('menu', { name: 'File actions' });
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    expect(await axeViolations()).toEqual([]);
    act(() => {
      fireEvent.keyDown(menu, { key: 'Tab' });
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('the phone top bar', () => {
  function renderTopBar() {
    const vault = new MockVault();
    vi.spyOn(api, 'getTree').mockResolvedValue(vault.getTree());
    vi.spyOn(api, 'getStatus').mockResolvedValue(vault.getStatus());
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/n/Welcome.md']}>
          <TopBar />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    registerBuiltins();
  });

  it('says whether the drawer is open, and its ⋯ menu works from the keyboard and returns focus on Esc', async () => {
    renderTopBar();
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toHaveAttribute('aria-expanded', 'false');
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    fireEvent.click(more);
    const menu = await screen.findByRole('menu', { name: 'More' });
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    expect(await axeViolations()).toEqual([]);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more).toHaveFocus();
  });
});
