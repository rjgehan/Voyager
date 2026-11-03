// The habits keep Today current when the app comes back from the background: an iPhone PWA is
// frozen overnight, so its 60 s timer has not run when the first tap of the morning arrives.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/endpoints';
import { queryClient } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import type { HabitsResponse, SaveFileRequest, TextFile, WriteResult } from '../../api/types';
import { EMPTY_TREE } from '../../api/vaultTree';
import { DEFAULT_SETTINGS } from '../../features/settings';
import { habitApi } from '../api';
import { getProperty } from '../frontmatterEdit';
import HabitsPage from './HabitsPage';
import HabitsPanel from './HabitsPanel';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  habitApi: { list: vi.fn() },
}));

const files = new Map<string, string>();
let version = 0;

function response(): HabitsResponse {
  return {
    folder: 'Habits',
    tag: 'habit',
    habits: [{ path: 'Habits/Exercise.md', version: `v${version}`, properties: { entries: getProperty(files.get('Habits/Exercise.md')!, 'entries') } }],
    dailyFolder: 'Daily',
    daily: [],
  };
}

function wrap(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/x/habits']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The phone sleeps overnight: the clock moves on, no timer runs, then the page shows again. */
function resumeNextMorning() {
  vi.setSystemTime(new Date(2026, 10, 3, 8, 0));
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
  });
}

beforeEach(() => {
  // Only the clock is faked: the 60 s interval never fires, as in a suspended PWA.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 2, 22, 0));
  version = 0;
  queryClient.setQueryData(queryKeys.tree(), EMPTY_TREE);
  queryClient.setQueryData(queryKeys.settings(), { settings: DEFAULT_SETTINGS, version: 'v', readOnly: false });
  files.set('Habits/Exercise.md', '---\nentries: []\n---\n');
  vi.mocked(habitApi.list).mockImplementation(async () => response());
  vi.spyOn(api, 'readFile').mockImplementation(async (path: string) => ({ path, content: files.get(path)!, version: `v${version}`, mtime: '2026-11-02T00:00:00.000Z', size: 1, lossy: false }) as TextFile);
  vi.spyOn(api, 'saveFile').mockImplementation(async (path: string, req: SaveFileRequest) => {
    files.set(path, req.content);
    version++;
    return { file: { path, version: `v${version}` }, created: false, createdFolders: [] } as unknown as WriteResult;
  });
});

afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('habits after the app resumes on a new day', () => {
  it('the Habits page checks in the new day, not yesterday', async () => {
    wrap(<HabitsPage />);
    await screen.findByRole('button', { name: 'Exercise, today' });
    resumeNextMorning();
    fireEvent.click(screen.getByRole('button', { name: 'Exercise, today' }));
    await waitFor(() => expect(files.get('Habits/Exercise.md')).toBe('---\nentries:\n  - 2026-11-03\n---\n'));
  });

  it('the Habits panel checks in the new daily note, not yesterday', async () => {
    wrap(<HabitsPanel activePath="Daily/2026-11-03.md" />);
    // Opened in the evening, the next day's note is in the future: the panel checks in today.
    await screen.findByRole('button', { name: /^Exercise, / });
    resumeNextMorning();
    fireEvent.click(screen.getByRole('button', { name: /^Exercise, / }));
    await waitFor(() => expect(files.get('Habits/Exercise.md')).toBe('---\nentries:\n  - 2026-11-03\n---\n'));
  });
});
