// Detects a deploy while this tab runs an older bundle (DESIGN §6.18). The server build arrives
// through the X-Notes-Build header and SSE hello.buildSha; a mismatch reloads a clean page and
// otherwise raises the "new version" banner (which also blocks settings writes until the reload).
//
// With the service worker (DESIGN §6.26) a reload first lets the new worker take over (see
// pwa/serviceWorker.ts). A page that comes back on the same old bundle anyway (the network was too
// slow and the cached shell answered) does not reload again for the same server build within a
// minute: it shows the banner instead, so a reload can never loop. A lazy chunk that fails to load
// counts as a deploy only when a fresh request confirms the server runs another build.
import { MOCK_API } from '../demo/mode';
import { useUi } from './ui';
import { apiUrl } from './vault';

export const pageBuild: string = import.meta.env.VITE_BUILD_SHA ?? 'dev';

/** sessionStorage key of the last automatic reload: `{build, at}`. */
const GUARD_KEY = 'notesapp:buildReload';
const GUARD_MS = 60_000;

let anyUnsaved: () => boolean = () => false;
let prepare: (() => Promise<void>) | null = null;
let reloadPage: () => void = () => window.location.reload();
let reloading = false;

/** The document registry tells the check whether a reload would interrupt a save. */
export function setUnsavedProbe(probe: () => boolean): void {
  anyUnsaved = probe;
}

/** Runs before every build reload (the service worker's hand-over); it must not reject. */
export function setReloadPreparer(fn: (() => Promise<void>) | null): void {
  prepare = fn;
}

/** Tests replace the reload; production uses `location.reload()`. Also forgets the loop guard. */
export function setReloader(reload: () => void): void {
  reloadPage = reload;
  reloading = false;
  try {
    sessionStorage.removeItem(GUARD_KEY);
  } catch {
    // Storage blocked: the guard was never written either.
  }
}

function reloadedRecentlyFor(build: string, now: number): boolean {
  try {
    const raw = sessionStorage.getItem(GUARD_KEY);
    const last = raw ? (JSON.parse(raw) as { build?: unknown; at?: unknown }) : null;
    return !!last && last.build === build && typeof last.at === 'number' && now - last.at < GUARD_MS;
  } catch {
    return false;
  }
}

function rememberReload(build: string, now: number): void {
  try {
    sessionStorage.setItem(GUARD_KEY, JSON.stringify({ build, at: now }));
  } catch {
    // Without storage there is no guard; the banner path still works.
  }
}

/** The reload into the new build (also the banner's Reload button). */
export function reloadForNewBuild(): void {
  if (reloading) return;
  reloading = true;
  if (!prepare) {
    reloadPage();
    return;
  }
  void prepare()
    .catch(() => undefined)
    .then(() => reloadPage());
}

export function reportServerBuild(serverBuild: string | null | undefined, ownBuild: string = pageBuild): void {
  if (!serverBuild || serverBuild === ownBuild || reloading) return;
  handleNewBuild(serverBuild);
}

/** `serverBuild` is the build the server reported; unknown for a vanished lazy chunk. */
export function handleNewBuild(serverBuild = 'unknown'): void {
  if (reloading) return;
  const now = Date.now();
  if (!anyUnsaved() && !reloadedRecentlyFor(serverBuild, now)) {
    rememberReload(serverBuild, now);
    reloadForNewBuild();
    return;
  }
  useUi.getState().setNewBuildAvailable(true);
}

let preloadHandlerInstalled = false;
let checkingChunk = false;

/** The build the server runs now, from a fresh request; rejects when the server cannot be reached. */
async function serverBuildNow(): Promise<string | null> {
  // The demo (and the dev server's mock API) has no server to ask: a missing chunk there means a new deploy.
  if (MOCK_API) return 'unknown';
  const res = await fetch(apiUrl('/api/status'), { cache: 'no-store', credentials: 'same-origin' });
  return res.headers.get('X-Notes-Build');
}

/**
 * Called once at startup: a lazy chunk could not be loaded. That is a deploy that removed the old
 * build's chunks only when the server now runs another build; offline, or with the same build, it is
 * a connection problem. The import is never default-prevented, so it rejects and its caller (or the
 * view's error boundary) handles that; only a confirmed new build takes the reload path.
 */
export function installPreloadErrorHandler(): void {
  if (preloadHandlerInstalled) return;
  preloadHandlerInstalled = true;
  window.addEventListener('vite:preloadError', () => {
    if (navigator.onLine === false || checkingChunk || reloading) return;
    checkingChunk = true;
    void serverBuildNow()
      .then((build) => reportServerBuild(build), () => undefined)
      .finally(() => {
        checkingChunk = false;
      });
  });
}
