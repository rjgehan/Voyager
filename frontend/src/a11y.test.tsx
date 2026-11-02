// Accessibility of the app's key screens in jsdom (docs/ACCESSIBILITY.md): the whole shell over the
// in-memory mock API, checked by axe-core (WCAG 2.2 A and AA rules that need no layout), at desktop
// and phone widths. Colour contrast, target sizes and reflow need a browser: `npm run test:a11y`.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { installMockApi } from './api/mock';
import { queryClient } from './api/queryClient';
import { registerBuiltins } from './extensions/builtins';
import { installHotkeys } from './features/hotkeys';
import { resetOverlayHistory } from './features/overlayHistory';
import { useUi } from './state/ui';
import { createWorkspace } from './workspace/model';
import { resetWorkspace } from './workspace/store';
import { axeViolations } from './test/axe';

type Size = 'desktop' | 'phone';

// A whole app per test, the editor's modules loaded cold and axe over the full page: slower than a unit test.
vi.setConfig({ testTimeout: 30_000 });

function emulateSize(size: Size) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) =>
      ({
        matches: size === 'desktop' ? q.includes('min-width: 1200px') || q.includes('min-width: 768px') : q.includes('max-width: 767px') || q.includes('pointer: coarse'),
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

let uninstallHotkeys: (() => void) | undefined;

beforeAll(() => {
  const mock = installMockApi();
  mock.latency = 0;
  registerBuiltins();
});

beforeEach(() => {
  // The phone runs leave history entries for their overlays (DESIGN §6.4); start each test clean.
  resetOverlayHistory();
  queryClient.clear();
  useUi.setState({ overlay: null, drawerOpen: false, sheetOpen: false, leftOpen: true, rightOpen: true, leftTab: 'files', rightTab: 'backlinks' });
  uninstallHotkeys = installHotkeys();
});

afterEach(() => {
  uninstallHotkeys?.();
  vi.restoreAllMocks();
});

async function renderApp(url: string, size: Size = 'desktop') {
  emulateSize(size);
  resetWorkspace(createWorkspace(url));
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.querySelector('main')).not.toBeNull(), { timeout: 10_000 });
  // Lazy panels and pages settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return view;
}

describe.each(['desktop', 'phone'] as const)('the app at %s width', (size) => {
  it('has a main landmark, a skip link and no axe violations on a note', async () => {
    await renderApp('/n/Welcome.md', size);
    // The first note loads the editor's modules: allow for a cold start.
    await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull(), { timeout: 10_000 });
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
    expect(document.querySelector('.cm-content')).toHaveAttribute('aria-label', 'Note text');
    expect(await axeViolations(document.body, { page: true })).toEqual([]);
  });

  it.each(['/settings/files', '/settings/editor', '/settings/hotkeys', '/trash', '/search?q=plan'])('has no axe violations on %s', async (url) => {
    await renderApp(url, size);
    expect(await axeViolations(document.body, { page: true })).toEqual([]);
  });
});

describe('overlays', () => {
  it('the command palette is a labelled modal dialog with a combobox', async () => {
    await renderApp('/n/Welcome.md');
    act(() => useUi.getState().setOverlay('palette'));
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('combobox', { name: 'Command palette' })).toHaveFocus();
    expect(await axeViolations(document.body, { page: true })).toEqual([]);
  });

  it('the quick switcher is a labelled modal dialog', async () => {
    await renderApp('/n/Welcome.md');
    act(() => useUi.getState().setOverlay('switcher'));
    expect(await screen.findByRole('dialog', { name: 'Quick switcher' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('combobox', { name: 'Quick switcher' })).toHaveFocus();
    expect(await axeViolations(document.body, { page: true })).toEqual([]);
  });

  it('the phone drawer is a modal dialog that keeps Tab inside and closes on Esc', async () => {
    await renderApp('/n/Welcome.md', 'phone');
    const open = screen.getByRole('button', { name: 'Open sidebar' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    open.focus();
    fireEvent.click(open);
    const drawer = await screen.findByRole('dialog', { name: 'Sidebar' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(await axeViolations(document.body, { page: true })).toEqual([]);
    // Shift-Tab from the drawer itself wraps to its last control instead of leaving it.
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(drawer.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUi.getState().drawerOpen).toBe(false);
  });
});
