// `/` at an offline cold start (the iPhone Home-Screen app, start_url '/', with Tailscale off): the
// device's tree snapshot stands in for the server's, and the last-opened note has an offline copy.
// Its own file, so HomePage's once-per-page-load flag starts fresh.
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransientError } from '../../api/client';
import { api } from '../../api/endpoints';
import { refetchTree } from '../../api/hooks';
import { queryClient } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import type { FileEntry, TreeResponse } from '../../api/types';
import { recordOpened } from '../../features/recent';
import { treeLoadedFromSnapshot } from '../../offline/offlineSync';
import { HomePage } from './HomePage';

const file = (path: string): FileEntry => ({
  path,
  name: path,
  basename: path.replace(/\.md$/, ''),
  extension: 'md',
  kind: 'note',
  size: 1,
  mtime: '2026-11-01T10:00:00.000Z',
  version: 'v1',
  aliases: [],
});

const snapshot: TreeResponse = { eventId: 'b.1', folders: [], files: [file('A.md')] };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  recordOpened('A.md');
  vi.spyOn(api, 'getTree').mockRejectedValue(new TransientError('Failed to fetch'));
  vi.spyOn(api, 'getSettings').mockRejectedValue(new TransientError('Failed to fetch'));
  // As startLiveSync does before the first render: the tree request starts, then the snapshot stands in.
  void refetchTree().catch(() => undefined);
  queryClient.setQueryData(queryKeys.tree(), snapshot);
  treeLoadedFromSnapshot(Date.now());
});

afterEach(() => {
  vi.useRealTimers();
  queryClient.clear();
});

function renderHome() {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/n/*" element={<p>note A</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HomePage at an offline cold start', () => {
  it('opens the last note from the snapshot at once, without waiting for the settings retries', async () => {
    renderHome();
    await vi.advanceTimersByTimeAsync(200);
    expect(screen.getByText('note A')).toBeInTheDocument();
  });

  it('never says "Cannot reach the server" while the snapshot is shown, even after every retry failed', async () => {
    await vi.advanceTimersByTimeAsync(20_000);
    expect(queryClient.getQueryState(queryKeys.tree())?.status).toBe('error');
    renderHome();
    await vi.advanceTimersByTimeAsync(200);
    expect(screen.queryByText('Cannot reach the server')).not.toBeInTheDocument();
    expect(screen.getByText('note A')).toBeInTheDocument();
  });
});
