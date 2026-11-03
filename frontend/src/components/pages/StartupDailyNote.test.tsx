// Its own file, so HomePage's once-per-page-load flag starts fresh.
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { queryClient } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { DEFAULT_SETTINGS } from '../../features/settings';
import { StartupDailyNote } from './HomePage';

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

describe('StartupDailyNote (the app reopened at "/" on a restored tab)', () => {
  it('still opens today’s note when the settings ask for it, once', async () => {
    queryClient.setQueryData(queryKeys.tree(), { eventId: 'b.1', folders: [], files: [] });
    queryClient.setQueryData(queryKeys.settings(), {
      settings: { ...DEFAULT_SETTINGS, dailyNotes: { ...DEFAULT_SETTINGS.dailyNotes, openOnStartup: true } },
      version: 'v1',
      readOnly: false,
    });
    const create = vi.spyOn(api, 'createFile').mockRejectedValue(new ApiError({ type: 'urn:notesapp:problem:invalid-name', title: 'invalid', status: 400, code: 'invalid-name' }));
    const ui = (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <StartupDailyNote />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { unmount } = render(ui);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    unmount();
    render(ui);
    await new Promise((r) => setTimeout(r, 20));
    expect(create).toHaveBeenCalledTimes(1);
  });
});
