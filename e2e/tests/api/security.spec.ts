import { expect, test } from '@playwright/test';
import { ALLOWED_LOGIN, API_URL, MODE, WEB_URL, rawRequest, unique } from '../../lib/api.ts';

/**
 * Admission and CSRF (API.md §2, DESIGN §5.13–5.14). In production the tailnet, the Host
 * allowlist and the identity allowlist are the only security boundary, so they are tested over
 * raw HTTP with every header under the test's control.
 *
 * The scratch server runs with `notes.identity.allowed-logins=e2e-owner@example.test` and the dev
 * profile's default identity (no login header → "Owner"), as scripts/reset.mjs starts it.
 */
const host = new URL(API_URL).host;
const json = { 'content-type': 'application/json' };
const createBody = () => JSON.stringify({ path: `${unique('Sec')}.md`, content: '' });

test('mutating requests need a well-formed X-Client-Id', async () => {
  const none = await rawRequest('POST', '/api/files', { host, ...json }, createBody());
  expect(none.status).toBe(403);
  expect(none.json).toMatchObject({ code: 'client-id-required' });
  for (const bad of ['short', 'has space in it', 'x'.repeat(65), 'semi;colon1']) {
    const r = await rawRequest('POST', '/api/files', { host, ...json, 'x-client-id': bad }, createBody());
    expect(r.json?.code, bad).toBe('client-id-required');
  }
  const ok = await rawRequest('POST', '/api/files', { host, ...json, 'x-client-id': 'e2e-client-0001' }, createBody());
  expect(ok.status).toBe(201);
  // Reads need nothing: <img src> and EventSource send no custom headers.
  expect((await rawRequest('GET', '/api/tree', { host })).status).toBe(200);
});

test('a cross-site page cannot write: Origin and Sec-Fetch-Site are checked', async () => {
  const base = { host, ...json, 'x-client-id': 'e2e-client-0002' };
  const cases: [Record<string, string>, number, string | undefined][] = [
    [{ origin: 'https://evil.example' }, 403, 'cross-origin'],
    [{ origin: 'null' }, 403, 'cross-origin'],
    [{ origin: `http://${host}`, 'sec-fetch-site': 'cross-site' }, 403, 'cross-origin'],
    [{ 'sec-fetch-site': 'same-site' }, 403, 'cross-origin'],
    [{ origin: `http://${host}`, 'sec-fetch-site': 'same-origin' }, 201, undefined],
    [{ 'sec-fetch-site': 'none' }, 201, undefined],
  ];
  for (const [headers, status, code] of cases) {
    const r = await rawRequest('POST', '/api/files', { ...base, ...headers }, createBody());
    expect(r.status, JSON.stringify(headers)).toBe(status);
    if (code) expect(r.json.code).toBe(code);
  }
});

test('only allowed host names are answered (DNS rebinding), health excepted', async () => {
  for (const h of ['evil.example', 'evil.example:18570', '127.0.0.2:18570', 'localhost:9999']) {
    const r = await rawRequest('GET', '/api/tree', { host: h });
    expect(r.status, h).toBe(421);
    expect(r.json).toMatchObject({ code: 'unknown-host' });
  }
  // The same for the app itself and for writes.
  expect((await rawRequest('GET', '/', { host: 'evil.example' })).status).toBe(421);
  expect((await rawRequest('POST', '/api/files', { host: 'evil.example', ...json, 'x-client-id': 'e2e-client-0003' }, createBody())).status).toBe(421);
  // Case does not matter; health checks pass whatever the Host.
  expect((await rawRequest('GET', '/api/tree', { host: host.toUpperCase() })).status).toBe(200);
  for (const p of ['/actuator/health', '/livez', '/readyz']) {
    expect((await rawRequest('GET', p, { host: 'evil.example' })).status, p).toBe(200);
  }
});

test('identity: an allowed Tailscale login is used, any other is refused', async () => {
  const me = await rawRequest('GET', '/api/me', {
    host,
    'tailscale-user-login': ALLOWED_LOGIN,
    // RFC 2047, as tailscale serve sends names with non-ASCII letters.
    'tailscale-user-name': '=?utf-8?q?Ren=C3=A9e_Owner?=',
    'tailscale-user-profile-pic': '',
  });
  expect(me.status).toBe(200);
  expect(me.json).toEqual({ login: ALLOWED_LOGIN, name: 'Renée Owner', profilePicUrl: null, source: 'tailscale' });

  const stranger = await rawRequest('GET', '/api/me', { host, 'tailscale-user-login': 'stranger@example.test' });
  expect(stranger.status).toBe(403);
  expect(stranger.json).toMatchObject({ code: 'identity-not-allowed' });
  const strangerWrite = await rawRequest('POST', '/api/files', { host, ...json, 'x-client-id': 'e2e-client-0004', 'tailscale-user-login': 'stranger@example.test' }, createBody());
  expect(strangerWrite.status).toBe(403);
  // Logins compare without regard to case.
  expect((await rawRequest('GET', '/api/me', { host, 'tailscale-user-login': ALLOWED_LOGIN.toUpperCase() })).status).toBe(200);

  // Without a login, only the dev profile's default identity gets in (production refuses it).
  const anon = await rawRequest('GET', '/api/me', { host });
  expect(anon.json).toMatchObject({ login: 'owner@notes', source: 'default' });
});

test('a commit is authored by the identity that made the change', async () => {
  const path = `${unique('Author')}.md`;
  const headers = { host, ...json, 'x-client-id': 'e2e-client-0005', 'tailscale-user-login': ALLOWED_LOGIN, 'tailscale-user-name': 'E2E Owner' };
  expect((await rawRequest('POST', '/api/files', headers, JSON.stringify({ path, content: 'x\n' }))).status).toBe(201);
  expect((await rawRequest('POST', '/api/history/commit', headers)).status).toBe(200);
  const h = await rawRequest('GET', `/api/history?path=${encodeURIComponent(path)}`, { host });
  expect(h.json.entries[0]).toMatchObject({ authorLogin: ALLOWED_LOGIN, authorName: 'E2E Owner' });
});

test('requests that came through Tailscale Funnel are refused everywhere', async () => {
  for (const p of ['/api/tree', '/', '/actuator/health']) {
    const r = await rawRequest('GET', p, { host, 'tailscale-funnel-request': '?1' });
    expect(r.status, p).toBe(403);
    expect(r.json).toMatchObject({ code: 'funnel-request' });
  }
});

test('responses carry the security headers; API responses are never cached', async () => {
  const r = await rawRequest('GET', '/api/tree', { host });
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.headers['x-content-type-options']).toBe('nosniff');
  expect(r.headers['x-frame-options']).toBe('DENY');
  expect(r.headers['referrer-policy']).toBe('no-referrer');
  expect(String(r.headers['content-security-policy'])).toContain("default-src 'self'");
  expect(r.headers['x-notes-build']).toBeTruthy();
  const problem = await rawRequest('GET', '/api/files?path=..%2Fx.md', { host });
  expect(problem.headers['content-type']).toContain('application/problem+json');
});

test('the app page itself is served with a CSP and without caching', async () => {
  test.skip(MODE !== 'prod', 'Vite serves the page in dev mode; run `npm run reset -- --prod` to test the built app');
  const r = await rawRequest('GET', '/', { host: new URL(WEB_URL).host });
  expect(r.status).toBe(200);
  expect(r.headers['cache-control']).toBe('no-cache');
  expect(String(r.headers['content-security-policy'])).toContain("script-src 'self'");
});
