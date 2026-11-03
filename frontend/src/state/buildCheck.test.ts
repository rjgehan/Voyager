import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleNewBuild,
  installPreloadErrorHandler,
  pageBuild,
  reloadForNewBuild,
  reportServerBuild,
  setReloader,
  setReloadPreparer,
  setUnsavedProbe,
} from './buildCheck';
import { useUi } from './ui';

describe('build check with the service worker', () => {
  beforeEach(() => {
    useUi.getState().setNewBuildAvailable(false);
    setUnsavedProbe(() => false);
  });

  afterEach(() => {
    setReloadPreparer(null);
  });

  it('lets the new worker take over before reloading', async () => {
    const order: string[] = [];
    let release!: () => void;
    setReloadPreparer(() => {
      order.push('prepare');
      return new Promise<void>((r) => (release = r));
    });
    setReloader(() => order.push('reload'));
    reportServerBuild('build-2', 'build-1');
    expect(order).toEqual(['prepare']);
    release();
    await vi.waitFor(() => expect(order).toEqual(['prepare', 'reload']));
  });

  it('reloads even when preparing fails', async () => {
    const reload = vi.fn();
    setReloadPreparer(() => Promise.reject(new Error('offline')));
    setReloader(reload);
    reportServerBuild('build-2', 'build-1');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('does not reload twice in a row for the same server build: the banner shows instead', () => {
    const reload = vi.fn();
    setReloader(reload);
    reportServerBuild('build-2', 'build-1');
    expect(reload).toHaveBeenCalledTimes(1);
    // The page came back on the old bundle (the cached shell answered a slow navigation).
    setReloaderKeepingGuard(reload);
    reportServerBuild('build-2', 'build-1');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(useUi.getState().newBuildAvailable).toBe(true);
    // The banner's Reload still works.
    reloadForNewBuild();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('a newer server build reloads again', () => {
    const reload = vi.fn();
    setReloader(reload);
    reportServerBuild('build-2', 'build-1');
    setReloaderKeepingGuard(reload);
    handleNewBuild('build-3');
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('a reload that did not happen (cancelled by the unsaved-changes prompt)', () => {
  beforeEach(() => {
    useUi.getState().setNewBuildAvailable(false);
    setReloadPreparer(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('an automatic reload that was cancelled shows the banner, and its Reload works', () => {
    setUnsavedProbe(() => false);
    const reload = vi.fn();
    setReloader(reload);
    reportServerBuild('build-2', 'build-1');
    expect(reload).toHaveBeenCalledTimes(1);
    // The page is still here: "Reload site?" was answered Cancel (or the desktop app cancelled it).
    vi.advanceTimersByTime(5000);
    expect(useUi.getState().newBuildAvailable).toBe(true);
    reloadForNewBuild();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('the banner’s Reload works again after a cancelled reload, once the note has saved', () => {
    let unsaved = true;
    setUnsavedProbe(() => unsaved);
    const reload = vi.fn();
    setReloader(reload);
    reportServerBuild('build-2', 'build-1');
    expect(useUi.getState().newBuildAvailable).toBe(true);
    reloadForNewBuild();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    unsaved = false;
    reloadForNewBuild();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('a later report of the new build still raises the banner', () => {
    setUnsavedProbe(() => false);
    const reload = vi.fn();
    setReloader(reload);
    reportServerBuild('build-2', 'build-1');
    vi.advanceTimersByTime(5000);
    useUi.getState().setNewBuildAvailable(false);
    reportServerBuild('build-2', 'build-1');
    expect(useUi.getState().newBuildAvailable).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('a lazy chunk that cannot load (vite:preloadError)', () => {
  let reload: ReturnType<typeof vi.fn<() => void>>;

  beforeAll(() => installPreloadErrorHandler());

  beforeEach(() => {
    useUi.getState().setNewBuildAvailable(false);
    setUnsavedProbe(() => false);
    setReloadPreparer(null);
    reload = vi.fn<() => void>();
    setReloader(reload);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function chunkFails(): Event {
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  function serverAnswers(build: string | null) {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200, headers: build ? { 'X-Notes-Build': build } : {} })));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('offline: no reload, no banner, and the import rejects as usual', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetchMock = serverAnswers('build-2');
    const event = chunkFails();
    expect(event.defaultPrevented).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(useUi.getState().newBuildAvailable).toBe(false);
  });

  it('online with the same server build (a passing network failure): nothing happens', async () => {
    const fetchMock = serverAnswers(pageBuild);
    const event = chunkFails();
    expect(event.defaultPrevented).toBe(false);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(reload).not.toHaveBeenCalled();
    expect(useUi.getState().newBuildAvailable).toBe(false);
  });

  it('the server cannot be reached: nothing happens', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    chunkFails();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(reload).not.toHaveBeenCalled();
    expect(useUi.getState().newBuildAvailable).toBe(false);
  });

  it('the server runs a new build: a clean page reloads', async () => {
    serverAnswers('build-2');
    chunkFails();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('the server runs a new build with unsaved work: the banner shows', async () => {
    setUnsavedProbe(() => true);
    serverAnswers('build-2');
    chunkFails();
    await vi.waitFor(() => expect(useUi.getState().newBuildAvailable).toBe(true));
    expect(reload).not.toHaveBeenCalled();
  });

  it('asks the server once for a burst of failed chunks', async () => {
    const fetchMock = serverAnswers(pageBuild);
    chunkFails();
    chunkFails();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/** A fresh page load: the module state resets, sessionStorage (the guard) survives. */
function setReloaderKeepingGuard(reload: () => void): void {
  const saved = sessionStorage.getItem('notesapp:buildReload');
  setReloader(reload);
  if (saved !== null) sessionStorage.setItem('notesapp:buildReload', saved);
}
