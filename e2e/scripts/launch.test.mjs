// What reset starts (launch.mjs). `npm run test:scripts`.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { serverArgs } from './launch.mjs';

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
