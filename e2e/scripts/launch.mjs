// How reset.mjs starts the server and Vite, as functions of the options, so they can be tested.
import { isIP } from 'node:net';

/** A comma-separated environment variable as a list ("a:1, b:2" → ["a:1", "b:2"]). */
export function listOf(value) {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** host:port as the browser sends it in Host (an IPv6 address in brackets). */
export const hostPort = (host, port) => (isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`);

/**
 * The server's settings on its command line (they outrank NOTES_* environment variables).
 * `webHost` and `extraHosts` (host:port) are admitted besides localhost, for the hallway test.
 */
export function serverArgs({ platform, apiPort, webPort, run, login, join, webHost, extraHosts = [] }) {
  // The hosts the browser and the suite use. Vite's proxy keeps the browser's Host, so the Vite
  // origin must be allowed too.
  const allowedHosts = [`localhost:${webPort}`, `127.0.0.1:${webPort}`, `localhost:${apiPort}`, `127.0.0.1:${apiPort}`];
  if (webHost) allowedHosts.push(hostPort(webHost, webPort));
  allowedHosts.push(...extraHosts);
  return [
    '--spring.profiles.active=dev',
    `--server.port=${apiPort}`,
    '--server.address=127.0.0.1',
    `--notes.vault-dir=${join(run, 'vault')}`,
    `--notes.vaults.dir=${join(run, 'vaults')}`,
    `--notes.publish.dir=${join(run, 'publish')}`,
    `--notes.allowed-hosts=${allowedHosts.join(',')}`,
    '--notes.identity.allow-default=true',
    `--notes.identity.allowed-logins=${login}`,
    '--notes.security.require-tailscale-interface=false',
    '--notes.git.commit-quiet-period=2s',
    '--logging.level.com.rjgehan.notes=INFO',
    // The dev profile turns the vault watcher off for Windows (JDK-6972833, DESIGN §5.9). Elsewhere it
    // runs, as in the Docker image, so the suite exercises it alongside the app's own writes.
    ...(platform === 'win32' ? [] : ['--notes.watcher.enabled=true']),
  ];
}

/**
 * Vite's arguments and environment. By default it listens on loopback only; `webHost` binds it to
 * that one address instead (the PC's tailnet address, for the hallway test), and the DNS names among
 * `extraHosts` are added to the hosts Vite answers (it answers any IP address by itself).
 */
export function viteLaunch({ vite, webPort, apiUrl, webHost, extraHosts = [] }) {
  if (webHost && /^(0\.0\.0\.0|::|\[::\])$/.test(webHost)) {
    throw new Error(
      'E2E_WEB_HOST must be one address (the PC’s tailnet address from `tailscale ip -4`), never 0.0.0.0 or ::, ' +
        'which would open the unauthenticated dev backend to every network the PC joins.',
    );
  }
  const args = [vite, '--port', String(webPort), '--strictPort', ...(webHost ? ['--host', webHost] : [])];
  const env = { NOTES_DEV_BACKEND: apiUrl };
  const names = extraHosts.map((h) => h.replace(/:\d+$/, '')).filter((h) => !h.startsWith('[') && isIP(h) === 0);
  if (names.length > 0) env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = names.join(',');
  return { args, env };
}
