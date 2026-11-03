import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransientError } from '../../api/client';
import { OFFLINE_ACTION_MESSAGE } from '../../features/errors';
import { useToasts } from '../../state/toasts';
import { flashcardApi } from '../api';
import { CONFIG } from '../testing';
import { SettingsView } from './SettingsView';

vi.mock('../api', () => ({
  flashcardApi: { config: vi.fn() },
}));

afterEach(() => {
  useToasts.setState({ toasts: [] });
  vi.clearAllMocks();
});

describe('flashcard settings', () => {
  it('a save that cannot reach the server is a neutral notice that nothing was saved, not an error that changes were kept', async () => {
    vi.mocked(flashcardApi.config).mockRejectedValue(new TransientError('Failed to fetch'));
    const onDone = vi.fn();
    render(<SettingsView config={CONFIG} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('New cards a day'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(useToasts.getState().toasts).toHaveLength(1));
    const toast = useToasts.getState().toasts[0];
    expect(toast.kind).not.toBe('error');
    expect(toast.message).toBe(OFFLINE_ACTION_MESSAGE);
    expect(onDone).not.toHaveBeenCalled();
  });
});
