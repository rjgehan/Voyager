import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/endpoints';
import { queryClient } from '../../api/queryClient';
import BacklinksPanel from './BacklinksPanel';

afterEach(() => {
  queryClient.clear();
});

describe('Backlinks of a note related to a task (QA finding F9)', () => {
  it('shows the task list’s mention as the link’s label, not the raw Markdown link', async () => {
    const context = '[Home renovation](/Projects/Home%20renovation.md)';
    vi.spyOn(api, 'getBacklinks').mockResolvedValue({
      path: 'Projects/Home renovation.md',
      linked: [
        {
          source: 'Tasks/Inbox.tasks',
          sourceVersion: 'v1',
          mentions: [{ line: 2, from: 0, to: context.length, matched: context, context, contextRange: { from: 0, to: context.length } }],
        },
      ],
      unlinked: null,
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BacklinksPanel activePath="Projects/Home renovation.md" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const mark = await screen.findByText('Home renovation', { selector: 'mark' });
    const button = mark.closest('button')!;
    expect(button.textContent).toBe('Home renovation');
  });
});
