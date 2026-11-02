import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCurrentVaultForTests } from '../state/vault';
import { guestApi, guestHref, isShareKey, parseGuestRoute } from './guestApi';

const ID = 'k2v8q4m1x7ab';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

afterEach(() => setCurrentVaultForTests(null));

describe('guest page addresses', () => {
  it('tells share ids and links from anything else', () => {
    expect(TOKEN).toHaveLength(43);
    expect(isShareKey(ID)).toBe(true);
    expect(isShareKey(TOKEN)).toBe(true);
    for (const bad of ['', 'ABCDEFGHIJKL', 'short', ID + 'x', TOKEN.slice(1), '../../api/tree', 'k2v8q4m1x7a%']) {
      expect(isShareKey(bad), bad).toBe(false);
    }
  });

  it('parses the landing page, a share and a note of a folder share', () => {
    expect(parseGuestRoute('/s', '')).toEqual({ kind: 'landing' });
    expect(parseGuestRoute('/s/', '')).toEqual({ kind: 'landing' });
    expect(parseGuestRoute(`/s/${ID}`, '')).toEqual({ kind: 'share', key: ID, path: null });
    expect(parseGuestRoute(`/s/${TOKEN}`, '?path=Family%2FRecipes%2FPie.md')).toEqual({ kind: 'share', key: TOKEN, path: 'Family/Recipes/Pie.md' });
    expect(parseGuestRoute(`/s/${ID}/extra`, '')).toEqual({ kind: 'unknown' });
    expect(parseGuestRoute('/s/not-a-key', '')).toEqual({ kind: 'unknown' });
    expect(parseGuestRoute('/n/Note.md', '')).toEqual({ kind: 'unknown' });
  });

  it('works under an extra vault’s prefix', () => {
    setCurrentVaultForTests('work');
    expect(parseGuestRoute(`/v/work/s/${ID}`, '')).toEqual({ kind: 'share', key: ID, path: null });
    expect(parseGuestRoute('/v/work/s', '')).toEqual({ kind: 'landing' });
    expect(guestHref('/v/work', ID, 'Plan.md')).toBe(`/v/work/s/${ID}?path=Plan.md`);
  });

  it('builds page addresses', () => {
    expect(guestHref('', ID, null)).toBe(`/s/${ID}`);
    expect(guestHref('', TOKEN, 'Family/A & B.md')).toBe(`/s/${TOKEN}?path=Family%2FA%20%26%20B.md`);
  });
});

describe('the guest API', () => {
  it('names the share in every request, and its vault', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const api = guestApi(TOKEN);
      await api.share();
      await api.readFile('Family/Groceries.md');
      await api.saveFile('Family/Groceries.md', { content: 'x', baseVersion: 'v1' });
      await api.createFile({ path: 'Family/New.md', content: '' }, { idempotencyKey: 'create-key-0001' });
      setCurrentVaultForTests('work');
      await guestApi(ID).share();
      const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
      expect(calls.map(([url]) => url)).toEqual([
        `/api/s/${TOKEN}`,
        `/api/s/${TOKEN}/files?path=Family%2FGroceries.md`,
        `/api/s/${TOKEN}/files?path=Family%2FGroceries.md`,
        `/api/s/${TOKEN}/files`,
        `/api/v/work/s/${ID}`,
      ]);
      expect(calls[2][1].method).toBe('PUT');
      expect(calls[3][1].method).toBe('POST');
      expect((calls[3][1].headers as Record<string, string>)['Idempotency-Key']).toBe('create-key-0001');
      // Every request carries the page's client id (the CSRF guard, API.md §2).
      expect((calls[2][1].headers as Record<string, string>)['X-Client-Id']).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('makes content-addressed raw URLs like the owner’s', () => {
    const url = guestApi(ID).rawUrl({ path: 'Attachments/photo.png', size: 12, mtime: '2026-11-02T10:00:00.000Z' });
    expect(url).toBe(`/api/s/${ID}/files/raw?path=Attachments%2Fphoto.png&v=12-${Date.parse('2026-11-02T10:00:00.000Z')}`);
    expect(guestApi(ID).rawUrl({ path: 'a.pdf', size: 1, mtime: '2026-11-02T10:00:00.000Z' }, { download: true })).toContain('&download=true');
  });
});
