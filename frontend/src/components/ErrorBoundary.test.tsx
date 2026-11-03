// Error boundaries of panels and pages (DESIGN §6.20): a crash stays with the panel or page that
// crashed, and "Reload view" tries a lazy chunk that failed to load again.
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { FileText, Hash } from 'lucide-react';
import { useState } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../api/queryClient';
import { AppRoutes } from '../AppRoutes';
import { registerPage, registerPanel } from '../extensions';
import { PanelTabs } from './layout/Panels';

function Boom(): never {
  throw new Error('boom');
}
function Fine() {
  return <p>OK panel</p>;
}
function ThrowsOnA({ activePath }: { activePath: string | null }) {
  if (activePath === 'a.md') throw new Error('bad note');
  return <p>Panel for {activePath}</p>;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  queryClient.clear();
});

function Go({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      {label}
    </button>
  );
}

describe('panel error boundary', () => {
  beforeEach(() => {
    registerPanel({ id: 'eb-boom', side: 'right', title: 'Boom', icon: Hash, component: Boom, load: () => Promise.resolve({ default: Boom }) });
    registerPanel({ id: 'eb-ok', side: 'right', title: 'Fine', icon: FileText, component: Fine, load: () => Promise.resolve({ default: Fine }) });
    registerPanel({ id: 'eb-note', side: 'right', title: 'Per note', icon: Hash, component: ThrowsOnA, load: () => Promise.resolve({ default: ThrowsOnA }) });
  });

  function Harness({ initial, path = '/n/a.md' }: { initial: string; path?: string }) {
    const [active, setActive] = useState(initial);
    return (
      <MemoryRouter initialEntries={[path]}>
        <PanelTabs side="right" active={active} onSelect={setActive} />
        <Go to="/n/b.md" label="Open b" />
      </MemoryRouter>
    );
  }

  it('another panel shows itself, not the crashed panel’s error', () => {
    render(<Harness initial="eb-boom" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong in this panel.');
    fireEvent.click(screen.getByRole('tab', { name: 'Fine' }));
    expect(screen.getByText('OK panel')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opening another note shows the panel again', () => {
    render(<Harness initial="eb-note" />);
    expect(screen.getByRole('alert')).toHaveTextContent('bad note');
    fireEvent.click(screen.getByRole('button', { name: 'Open b' }));
    expect(screen.getByText('Panel for b.md')).toBeInTheDocument();
  });
});

describe('page error boundary', () => {
  function renderAt(path: string) {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
          <Go to="/x/eb-ok" label="Open the other page" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('another page shows itself, not the crashed page’s error', async () => {
    registerPage({ route: 'eb-boom', title: 'Boom', icon: Hash, hidden: true, load: () => Promise.resolve({ default: Boom }) });
    registerPage({ route: 'eb-ok', title: 'Fine', icon: Hash, hidden: true, load: () => Promise.resolve({ default: () => <p>OK page</p> }) });
    renderAt('/x/eb-boom');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong in this page.');
    fireEvent.click(screen.getByRole('button', { name: 'Open the other page' }));
    expect(await screen.findByText('OK page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Reload view loads a page whose chunk failed (offline) again', async () => {
    let online = false;
    registerPage({
      route: 'eb-chunk',
      title: 'Chunk',
      icon: Hash,
      hidden: true,
      load: () => (online ? Promise.resolve({ default: () => <p>Loaded page</p> }) : Promise.reject(new TypeError('Failed to fetch dynamically imported module'))),
    });
    renderAt('/x/eb-chunk');
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch dynamically imported module');
    online = true;
    fireEvent.click(screen.getByRole('button', { name: 'Reload view' }));
    expect(await screen.findByText('Loaded page')).toBeInTheDocument();
  });
});
