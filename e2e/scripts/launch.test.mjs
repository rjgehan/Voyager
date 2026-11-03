// What reset starts (launch.mjs). `npm run test:scripts`.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { listOf, serverArgs, viteLaunch } from './launch.mjs';

const base = { apiPort: 18570, webPort: 5153, run: '/x/e2e/.run', login: 'e2e-owner@example.test', join };

test('on Linux and macOS the server watches the vault, as the Docker image does', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.ok(serverArgs({ ...base, platform }).includes('--notes.watcher.enabled=true'), platform);
  }
});

test('on Windows the watcher stays off, as in the dev profile (JDK-6972833: watched folders cannot be renamed)', () => {
  const args = serverArgs({ ...base, platform: 'win32' });
  assert.equal(args.filter((a) => a.startsWith('--notes.watcher.')).length, 0);
});

const hosts = (args) => args.find((a) => a.startsWith('--notes.allowed-hosts=')).split('=')[1].split(',');

test('by default the stack admits only localhost, and Vite listens on loopback', () => {
  assert.deepEqual(hosts(serverArgs({ ...base, platform: 'linux' })), ['localhost:5153', '127.0.0.1:5153', 'localhost:18570', '127.0.0.1:18570']);
  const vite = viteLaunch({ vite: 'vite.js', webPort: 5153, apiUrl: 'http://127.0.0.1:18570' });
  assert.deepEqual(vite.args, ['vite.js', '--port', '5153', '--strictPort']);
  assert.deepEqual(vite.env, { NOTES_DEV_BACKEND: 'http://127.0.0.1:18570' });
});

test('the hallway test: Vite on the PC tailnet address, admitted by the server and by Vite, by address or by name', () => {
  const opts = { webHost: '100.64.0.7', extraHosts: ['pc.example.ts.net:5153'] };
  assert.deepEqual(hosts(serverArgs({ ...base, platform: 'win32', ...opts })).slice(4), ['100.64.0.7:5153', 'pc.example.ts.net:5153']);
  const vite = viteLaunch({ vite: 'vite.js', webPort: 5153, apiUrl: 'http://127.0.0.1:18570', ...opts });
  assert.deepEqual(vite.args, ['vite.js', '--port', '5153', '--strictPort', '--host', '100.64.0.7']);
  // Vite admits any IP address, but a DNS name only when listed.
  assert.equal(vite.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, 'pc.example.ts.net');
});

test('Vite is never bound to every interface', () => {
  for (const webHost of ['0.0.0.0', '::', '[::]']) {
    assert.throws(() => viteLaunch({ vite: 'vite.js', webPort: 5153, apiUrl: 'http://127.0.0.1:18570', webHost }), /never/);
  }
});

test('the extra hosts come from a comma-separated list', () => {
  assert.deepEqual(listOf(' pc.example.ts.net:5153, 100.64.0.7:5153 ,'), ['pc.example.ts.net:5153', '100.64.0.7:5153']);
  assert.deepEqual(listOf(undefined), []);
});
