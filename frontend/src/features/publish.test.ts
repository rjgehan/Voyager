import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { api, httpEndpoints, installEndpoints } from '../api/endpoints';
import { createMockEndpoints } from '../api/mock';
import { MockVault } from '../api/mock/vault';
import { queryClient } from '../api/queryClient';
import { documents } from '../sync/instance';
import { publishNote } from './publish';

afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
});

afterAll(() => installEndpoints(httpEndpoints));

describe('publishNote', () => {
  it('saves the note first, so the snapshot has what was just typed', async () => {
    const vault = new MockVault(false);
    vault.createFile({ path: 'Blog/Hello.md', content: 'Hello' }, 'other-device-1');
    installEndpoints(createMockEndpoints(vault, { latency: 0, failures: [] }));
    const session = documents.acquire('Blog/Hello.md', 'publish-test');
    await session.ready;
    // Typed less than a second ago: autosave has not run yet.
    session.applyEdit({ from: session.getText().length, insert: ', world' });
    let published: string | null = null;
    vi.spyOn(api, 'publishNote').mockImplementation(async (req) => {
      // The server renders the note's saved text.
      published = vault.readFile(req.path).content;
      return { path: req.path, slug: 'hello', title: 'Hello', url: 'https://notes.example/p/hello', publishedAt: '2026-11-02T10:00:00.000Z', state: 'current' };
    });
    await publishNote({ path: 'Blog/Hello.md' });
    expect(published).toBe('Hello, world');
    documents.release(session, 'publish-test');
  });
});
