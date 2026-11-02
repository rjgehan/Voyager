// The Help page (DESIGN §6.45): the guide's pages rendered read-only, links and search that stay in
// Help, and the entries that open it. Nothing on it touches the vault.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCommand, runCommand } from '../features/commands';
import { navigateTo } from '../features/navigation';
import { registeredPages } from '../extensions';
import { useUi } from '../state/ui';
import HelpPage from './HelpPage';
import { registerHelp } from './register';

vi.mock('../features/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../features/navigation')>()),
  navigateTo: vi.fn(),
}));

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  // The guide is in the bundle: showing it never asks the server for anything.
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.mocked(navigateTo).mockClear();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/x/help/*" element={<HelpPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const article = () => document.querySelector<HTMLElement>('.help-article')!;

describe('Help page', () => {
  it('shows the guide’s contents at /x/help, with links that stay in Help', () => {
    renderAt('/x/help');
    expect(within(article()).getByRole('heading', { level: 1 })).toHaveTextContent('NotesApp user guide');
    expect(document.title).toMatch(/^Help/);
    const link = within(article()).getByRole('link', { name: 'Getting started' });
    expect(link).toHaveAttribute('href', '/x/help/getting-started');
    fireEvent.click(link);
    expect(navigateTo).toHaveBeenCalledWith('/x/help/getting-started');
    // A Mod-click goes through the app too, which opens it in a new tab (DESIGN §6.40).
    vi.mocked(navigateTo).mockClear();
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(false);
    expect(navigateTo).toHaveBeenCalledWith('/x/help/getting-started');
    // A link to a heading of another page carries its anchor.
    const code = within(article()).getAllByRole('link').find((a) => a.getAttribute('href') === '/x/help/writing#code');
    expect(code).toBeDefined();
    // The contents link is for the other pages.
    expect(screen.queryByRole('link', { name: 'Contents' })).not.toBeInTheDocument();
  });

  it('shows a page with its neighbours and a way back to the contents', () => {
    renderAt('/x/help/tables-and-formulas');
    expect(within(article()).getByRole('heading', { level: 1 })).toHaveTextContent('Tables and formulas');
    expect(document.title).toMatch(/^Tables and formulas · Help/);
    const pages = screen.getByRole('navigation', { name: 'Guide pages' });
    expect(within(pages).getByRole('link', { name: /Previous/ })).toHaveAttribute('href', '/x/help/history-and-trash');
    expect(within(pages).getByRole('link', { name: /Next/ })).toHaveAttribute('href', '/x/help/spreadsheets');
    fireEvent.click(screen.getByRole('link', { name: 'Contents' }));
    expect(navigateTo).toHaveBeenCalledWith('/x/help');
    // Headings carry GitHub's anchors; web links open in a new tab.
    expect(article().querySelector('[data-anchor="when-a-formula-shows-an-error"]')).not.toBeNull();
  });

  it('opens web links in a new tab', () => {
    renderAt('/x/help/desktop-app');
    const web = within(article()).getByRole('link', { name: 'DESKTOP.md' });
    expect(web).toHaveAttribute('target', '_blank');
    expect(web).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('searches the whole guide and opens a hit at its heading', () => {
    renderAt('/x/help/getting-started');
    const field = screen.getByRole('searchbox', { name: 'Search the guide' });
    fireEvent.change(field, { target: { value: 'code block' } });
    expect(document.querySelector('.help-article')).toBeNull();
    const hits = screen.getByRole('list', { name: 'Guide sections' });
    const hit = within(hits).getByRole('link', { name: /Writing › Code/ });
    expect(hit).toHaveAttribute('href', '/x/help/writing#code');
    fireEvent.click(hit);
    expect(navigateTo).toHaveBeenCalledWith('/x/help/writing#code');
    expect(field).toHaveValue('');
  });

  it('says when nothing matches, and Escape clears the search', () => {
    renderAt('/x/help');
    const field = screen.getByRole('searchbox', { name: 'Search the guide' });
    fireEvent.change(field, { target: { value: 'zzqx-nothing' } });
    expect(screen.getByRole('status')).toHaveTextContent('Nothing in the guide matches');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field).toHaveValue('');
    expect(article()).not.toBeNull();
  });

  it('says when a page does not exist', () => {
    renderAt('/x/help/no-such-page');
    expect(screen.getByRole('heading', { name: 'No such help page' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'See the contents' }));
    expect(navigateTo).toHaveBeenCalledWith('/x/help');
  });
});

describe('Help entries', () => {
  beforeEach(() => registerHelp());

  it('registers the route and the palette commands', () => {
    const page = registeredPages().find((p) => p.route === 'help/*');
    expect(page).toMatchObject({ title: 'Help', hidden: true });
    expect(getCommand('help.open')?.name).toBe('Open help (user guide)');
    useUi.getState().setDrawerOpen(true);
    runCommand('help.open', { activePath: null });
    expect(navigateTo).toHaveBeenCalledWith('/x/help');
    expect(useUi.getState().drawerOpen).toBe(false);
    runCommand('help.shortcuts', { activePath: null });
    expect(navigateTo).toHaveBeenLastCalledWith('/x/help/keyboard-shortcuts');
  });
});
