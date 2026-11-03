// How reset.mjs starts the server and Vite, as functions of the options, so they can be tested.

/** The server's settings on its command line (they outrank NOTES_* environment variables). */
export function serverArgs({ platform, apiPort, webPort, run, login, join }) {
  // The hosts the browser and the suite use. Vite's proxy keeps the browser's Host, so the Vite
  // origin must be allowed too.
  const allowedHosts = [`localhost:${webPort}`, `127.0.0.1:${webPort}`, `localhost:${apiPort}`, `127.0.0.1:${apiPort}`];
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
