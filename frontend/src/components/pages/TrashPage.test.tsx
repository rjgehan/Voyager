import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/endpoints';
import { queryClient } from '../../api/queryClient';
import type { TrashEntry } from '../../api/types';
import { confirmAction } from '../../state/dialogs';
import { TrashPage } from './TrashPage';

vi.mock('../../state/dialogs', async (orig) => ({ ...(await orig<typeof import('../../state/dialogs')>()), confirmAction: vi.fn() }));

const entry = (id: string, path: string): TrashEntry => ({
  id,
  originalPath: path,
  type: 'file',
  deletedAt: '2026-11-02T10:00:00.000Z',
  deletedBy: 'alice',
  size: 10,
  fileCount: 1,
});
const A = entry('0123456789AB', 'A.md');
const B = entry('0123456789AC', 'B.md');
const FOREIGN = entry('x-Foreign.md', 'Foreign.md');

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TrashPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TrashPage: Empty trash', () => {
  beforeEach(() => queryClient.clear());
  afterEach(() => vi.restoreAllMocks());

  it('asks again when the trash changed while the first confirmation was open', async () => {
    const list = vi.spyOn(api, 'listTrash').mockResolvedValueOnce({ entries: [A, B] }).mockResolvedValue({ entries: [A, B, FOREIGN] });
    const empty = vi.spyOn(api, 'emptyTrash').mockResolvedValue({ purged: 3 });
    const confirm = vi.mocked(confirmAction);
    confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Empty trash/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm.mock.calls[0][0].message).toMatch(/^2 items/);
    expect(confirm.mock.calls[1][0].message).toMatch(/3 items/);
    expect(confirm.mock.calls[1][0].message).toMatch(/outside Voyager/);
    expect(list).toHaveBeenCalledTimes(2);
    expect(empty).not.toHaveBeenCalled();
  });

  it('empties at once when the trash did not change', async () => {
    vi.spyOn(api, 'listTrash').mockResolvedValue({ entries: [A, B] });
    const empty = vi.spyOn(api, 'emptyTrash').mockResolvedValue({ purged: 2 });
    const confirm = vi.mocked(confirmAction);
    confirm.mockReset();
    confirm.mockResolvedValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Empty trash/ }));
    await waitFor(() => expect(empty).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
