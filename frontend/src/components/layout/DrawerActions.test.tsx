// The phone drawer's page tiles (DESIGN §6.16): every registered page is one tap away, as a grid
// that leaves the file tree most of the drawer (a list of 11 pages left it one row).
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { menuPages, registerPage } from '../../extensions';
import * as navigation from '../../features/navigation';
import { useUi } from '../../state/ui';
import { sourceFiles } from '../../test/sources';
import { DrawerActions } from './AppShell';

beforeEach(() => {
  registerPage({ route: 'drawer-test', title: 'Compatibility report of the vault', icon: Activity, load: () => Promise.resolve({ default: () => null }) });
});

describe('the drawer’s pages', () => {
  it('shows every page as a tile named by its title', () => {
    render(<DrawerActions />);
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    const tiles = within(pages).getAllByRole('button');
    expect(tiles.map((t) => t.textContent)).toEqual(menuPages().map((p) => p.title));
    const tile = within(pages).getByRole('button', { name: 'Compatibility report of the vault' });
    expect(tile).toHaveClass('drawer-page');
    expect(tile).toHaveAttribute('title', 'Compatibility report of the vault');
  });

  it('opens the page and closes the drawer', () => {
    const navigate = vi.spyOn(navigation, 'navigateTo').mockImplementation(() => {});
    useUi.getState().setDrawerOpen(true);
    render(<DrawerActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Compatibility report of the vault' }));
    expect(navigate).toHaveBeenCalledWith('/x/drawer-test');
    expect(useUi.getState().drawerOpen).toBe(false);
  });
});

describe('the tiles’ layout', () => {
  let css = '';
  beforeAll(async () => {
    css = (await sourceFiles('.css'))['styles/features.css'].replace(/\/\*[\s\S]*?\*\//g, '');
  });

  const rule = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === selector)?.[2] ?? '';

  it('are four to a row, scrolling within a third of the screen when they do not fit', () => {
    expect(rule('.drawer-pages')).toMatch(/grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(rule('.drawer-pages')).toMatch(/max-height:\s*calc\(var\(--vvh, 100dvh\) \/ 3\)/);
    expect(rule('.drawer-pages')).toMatch(/overflow-y:\s*auto/);
  });

  it('are at least 44 px tall, with a label of at most two lines', () => {
    expect(rule('.drawer-page')).toMatch(/min-height:\s*60px/);
    expect(rule('.drawer-page-label')).toMatch(/-webkit-line-clamp:\s*2/);
  });
});
