// Boots the whole app on the in-memory mock with the demo vault (DESIGN §6.46), as the GitHub Pages
// demo does, and opens the screens the README shows: every request must get a successful answer and
// the connection indicator must not turn Offline (an endpoint the mock lacks used to do that).
import { act, waitFor } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { installMockApi } from '../api/mock';
import { startApp } from '../boot';
import { navigateTo } from '../features/navigation';
import { useUi } from '../state/ui';
import { demoSeedFiles } from './seed';

const bodyText = () => document.body.textContent ?? '';

async function shows(route: string, ...texts: string[]): Promise<void> {
  act(() => navigateTo(route));
  await waitFor(() => texts.forEach((t) => expect(bodyText()).toContain(t)), { timeout: 15_000 });
}

describe('the demo on the mock', () => {
  it('boots and opens notes, tasks, the calendar, habits and flashcards without a failed request', async () => {
    const mock = installMockApi({ seed: demoSeedFiles(), latency: 0 });
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | null = null;
    act(() => {
      root = startApp(container, { serviceWorker: false });
    });

    // Home opens the Welcome note.
    await waitFor(() => expect(bodyText()).toContain('This demo runs'), { timeout: 15_000 });
    await shows('/n/Trip%20to%20Lisbon.md', 'Four days in Lisbon', 'travellers');
    await shows('/n/Routines/Weekly%20review.md', 'Donella Meadows', 'Martin Kleppmann');
    await shows('/x/tasks/today', 'Finish the pricing copy', 'Water the plants');
    await shows('/x/tasks/list/01DEMOLIST0000000000WORK00', 'Send wireframes to the team', 'Review');
    await shows('/x/calendar', new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }));
    await shows('/x/habits', 'Exercise', 'Meditate');
    await shows('/x/flashcards', 'spanish', 'engineering');
    // Let the queries those pages started settle (calendar data, flashcard notes, properties).
    await act(() => new Promise((r) => setTimeout(r, 500)));

    expect(mock.requests.length).toBeGreaterThan(10);
    expect(mock.requests.filter((r) => r.status >= 400 || r.status === 0)).toEqual([]);
    const paths = new Set(mock.requests.map((r) => r.path));
    for (const p of ['/api/tasks', '/api/notes/by-date', '/api/habits', '/api/flashcards', '/api/flashcards/notes', '/api/properties/types', '/api/reminders/zone', '/api/notes/query']) {
      expect(paths).toContain(p);
    }
    expect(paths).toContain('getBookmarks');
    expect(useUi.getState().connection).not.toBe('offline');
    act(() => root?.unmount());
  }, 120_000);
});
