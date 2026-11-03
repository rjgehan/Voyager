import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, TransientError } from '../../api/client';
import { api } from '../../api/endpoints';
import { queryClient } from '../../api/queryClient';
import type { BookmarksUpdateRequest, SearchResponse } from '../../api/types';
import { setNavigator } from '../../features/navigation';
import { hitRoute, pdfViewerUrl } from '../../features/searchLinks';
import { SearchView } from './SearchView';

const navigate = vi.fn();

const buttonWith = (text: string): HTMLElement => screen.getAllByRole('button').find((b) => b.textContent?.includes(text))!;

function Harness({ initial = '' }: { initial?: string }) {
  const [query, setQuery] = useState(initial);
  return <SearchView query={query} onQuery={setQuery} />;
}

function renderView(initial = '') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Harness initial={initial} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const RESPONSE: SearchResponse = {
  query: 'recieve jam',
  total: 2,
  tookMs: 3,
  corrections: [{ term: 'recieve', replacements: ['receive'] }],
  results: [
    {
      path: 'Docs/Manual.pdf',
      basename: 'Manual',
      kind: 'pdf',
      score: 3,
      mtime: '2026-10-16T10:00:00.000Z',
      titleRanges: [],
      matches: [{ line: 4, text: 'Paper jam in tray two', ranges: [{ from: 6, to: 9 }], page: 2 }],
      moreMatches: 0,
    },
    {
      path: 'Notes/Post.md',
      basename: 'Post',
      kind: 'note',
      score: 2,
      mtime: '2026-10-16T10:00:00.000Z',
      titleRanges: [],
      matches: [{ line: 1, text: 'We receive a jam', ranges: [{ from: 3, to: 10 }], page: null }],
      moreMatches: 0,
    },
  ],
};

beforeEach(() => {
  setNavigator(navigate);
  navigate.mockClear();
  vi.spyOn(api, 'getBookmarks').mockResolvedValue({ version: 'v1', items: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

describe('SearchView', () => {
  it('keeps a search only as a search bookmark: the star, and no separate saved searches', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({ ...RESPONSE, results: [], total: 0, corrections: [] });
    const put = vi.spyOn(api, 'putBookmarks').mockImplementation(async (req: BookmarksUpdateRequest) => ({ version: 'v2', items: req.items }));
    renderView();
    expect(screen.queryByText('Saved searches')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: ' tag:#todo -done ' } });
    expect(screen.queryByRole('button', { name: /save search/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark this search' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0].items).toEqual([expect.objectContaining({ type: 'search', query: 'tag:#todo -done' })]);
    expect(await screen.findByRole('button', { name: 'Remove the bookmark for this search' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a task’s related note as its label, not as a raw Markdown link (QA finding F9)', async () => {
    vi.spyOn(api, 'search').mockResolvedValue({
      ...RESPONSE,
      query: 'renovation',
      corrections: [],
      total: 1,
      results: [
        {
          path: 'Tasks/Inbox.tasks',
          basename: 'Inbox',
          kind: 'note',
          score: 1,
          mtime: '2026-10-16T10:00:00.000Z',
          titleRanges: [],
          matches: [{ line: 2, text: '[Home renovation](/Projects/Home%20renovation.md)', ranges: [{ from: 6, to: 16 }], page: null }],
          moreMatches: 0,
        },
      ],
    });
    renderView('renovation');
    const mark = await screen.findByText('renovation', { selector: 'mark' });
    expect(mark.closest('button')!.textContent).toBe('Home renovation');
  });

  it('shows PDF hits with their page, and corrections with a way back to exact words', async () => {
    const search = vi.spyOn(api, 'search').mockResolvedValue(RESPONSE);
    renderView('recieve jam');
    expect(await screen.findByText('p. 2')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Including similar words: recieve → receive');
    fireEvent.click(buttonWith('Paper jam in tray two'));
    expect(navigate).toHaveBeenCalledWith('/n/Docs/Manual.pdf?page=2', undefined);
    fireEvent.click(buttonWith('We receive a jam'));
    expect(navigate).toHaveBeenLastCalledWith('/n/Notes/Post.md?line=1&q=' + encodeURIComponent('recieve jam receive'), undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Exact words only' }));
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('recieve jam', { sort: 'relevance', prefix: true, fuzzy: false }));
  });

  it('shows why a query is invalid', async () => {
    vi.spyOn(api, 'search').mockRejectedValue(
      new ApiError({ type: 'urn:notesapp:problem:bad-request', title: 'Bad request', status: 400, code: 'bad-request', detail: 'Invalid regular expression /a(b/: Unclosed group' }),
    );
    renderView('/a(b/');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid regular expression /a(b/');
  });

  describe('offline', () => {
    afterEach(() => onlineManager.setOnline(true));

    it('does not show the last query’s results under a new query', async () => {
      const search = vi.spyOn(api, 'search').mockResolvedValue({ ...RESPONSE, corrections: [] });
      renderView('jam');
      expect(await screen.findByText('2 results')).toBeInTheDocument();
      act(() => onlineManager.setOnline(false));
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'budget' } });
      expect(await screen.findByRole('alert')).toHaveTextContent('Offline: search needs the server');
      expect(screen.queryByText('2 results')).not.toBeInTheDocument();
      expect(screen.queryByText('Manual')).not.toBeInTheDocument();
      expect(search).toHaveBeenCalledTimes(1);
    });

    it('says so instead of “Searching…” for a first search made offline', async () => {
      const search = vi.spyOn(api, 'search').mockResolvedValue(RESPONSE);
      onlineManager.setOnline(false);
      renderView('budget');
      expect(await screen.findByRole('alert')).toHaveTextContent('Offline: search needs the server');
      expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
      expect(search).not.toHaveBeenCalled();
    });

    it('says search needs the server when the browser is online but the server cannot be reached', async () => {
      queryClient.setDefaultOptions({ queries: { retryDelay: 0 } });
      try {
        vi.spyOn(api, 'search').mockRejectedValue(new TransientError('Failed to fetch'));
        renderView('plan');
        expect(await screen.findByRole('alert')).toHaveTextContent('Offline: search needs the server.');
        expect(screen.getByRole('alert')).not.toHaveTextContent(/kept/);
      } finally {
        queryClient.setDefaultOptions({ queries: { retryDelay: undefined } });
      }
    });

    it('still shows a search it already has', async () => {
      vi.spyOn(api, 'search').mockResolvedValue({ ...RESPONSE, corrections: [] });
      renderView('jam');
      expect(await screen.findByText('2 results')).toBeInTheDocument();
      act(() => onlineManager.setOnline(false));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('Manual')).toBeInTheDocument();
    });
  });
});

describe('search links', () => {
  it('opens notes at the line and PDFs at the page', () => {
    expect(hitRoute({ path: 'A b.md', kind: 'note' }, { line: 3, page: null }, 'x y')).toBe('/n/A%20b.md?line=3&q=x%20y');
    expect(hitRoute({ path: 'A.pdf', kind: 'pdf' }, { line: 3, page: 4 }, 'x')).toBe('/n/A.pdf?page=4');
    expect(hitRoute({ path: 'A.md', kind: 'note' }, null, 'x')).toBe('/n/A.md');
    expect(pdfViewerUrl('/raw', '4')).toBe('/raw#page=4');
    expect(pdfViewerUrl('/raw', 'x')).toBe('/raw');
    expect(pdfViewerUrl('/raw', null)).toBe('/raw');
  });
});
