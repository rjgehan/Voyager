// `/` (DESIGN §6.4): today's daily note when `dailyNotes.openOnStartup` or `?open=daily` (a
// daily-note reminder, DESIGN §6.38), once per page load;
// otherwise the last-opened note if it still exists, then Welcome.md, then an empty state.
import { NotebookPen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSettings, useTree } from '../../api/hooks';
import { getCommand, runCommand, useCommandsVersion } from '../../features/commands';
import { openTodaysDailyNote } from '../../features/daily';
import { noteRoute } from '../../features/paths';
import { lastOpenedPath } from '../../features/recent';
import { useOffline } from '../../offline/offlineStore';

/** Once per page load. */
let startupHandled = false;

/** Waits for the settings only while their first request runs and the tree is the server's. */
function useWaitSettings(settings: ReturnType<typeof useSettings>): boolean {
  const fromSnapshot = useOffline((s) => s.treeSnapshotAt) !== null;
  return settings.isPending && settings.failureCount === 0 && settings.fetchStatus !== 'paused' && !fromSnapshot;
}

/**
 * The page started at `/` but the workspace came back on its saved page (workspace/store.ts
 * `startedAtHome`), so HomePage does not show: today's note still opens when
 * `dailyNotes.openOnStartup` asks for it, once per page load (DESIGN §6.4).
 */
export function StartupDailyNote() {
  const settings = useSettings();
  const waitSettings = useWaitSettings(settings);
  const wantsDaily = !!settings.data?.settings.dailyNotes.openOnStartup;
  useEffect(() => {
    if (waitSettings || startupHandled) return;
    startupHandled = true;
    if (wantsDaily) void openTodaysDailyNote();
  }, [waitSettings, wantsDaily]);
  return null;
}

export function HomePage() {
  useCommandsVersion();
  const tree = useTree();
  const settings = useSettings();
  const askedForDaily = new URLSearchParams(useLocation().search).get('open') === 'daily';
  const wantsDaily = askedForDaily || !!settings.data?.settings.dailyNotes.openOnStartup;
  // React state, so that a startup daily note that could not be opened re-renders this page.
  const [handled, setHandled] = useState(startupHandled);
  // Settings are waited for only while their first request runs and the tree is the server's: at
  // an offline start (the tree is the device's snapshot) or once a request failed, the retries
  // can take minutes (and a request paused offline waits for the network), and the last note opens
  // without them (DESIGN §6.26).
  const waitSettings = useWaitSettings(settings);
  const settingsPending = waitSettings && !handled;

  useEffect(() => {
    if (waitSettings || startupHandled) return;
    startupHandled = true;
    if (!wantsDaily) return;
    // On success the route changes; on failure (a toast says why) the usual home page shows.
    void openTodaysDailyNote().then((opened) => {
      if (!opened) setHandled(true);
    });
  }, [waitSettings, wantsDaily]);

  if (tree.isPending || settingsPending) return <div className="view-loading" aria-busy="true" />;
  // A failed refresh keeps the snapshot as data: the error page is only for no tree at all.
  if (!tree.data) {
    return (
      <div className="empty-state">
        <h2>Cannot reach the server</h2>
        <p>The vault could not be loaded. It will retry automatically.</p>
      </div>
    );
  }
  // The effect opens today's note once the settings ask for it.
  if (!handled && wantsDaily) return <div className="view-loading" aria-busy="true" />;
  const last = lastOpenedPath();
  const target = (last && tree.data.byPath.has(last) ? last : null) ?? (tree.data.byPath.has('Welcome.md') ? 'Welcome.md' : null);
  if (target) return <Navigate to={noteRoute(target)} replace />;
  return (
    <div className="empty-state">
      <NotebookPen size={44} aria-hidden />
      <h2>No note is open</h2>
      <div className="empty-state-actions">
        {getCommand('file.newNote') && (
          <button type="button" className="button button-primary" onClick={() => runCommand('file.newNote', { activePath: null })}>
            New note
          </button>
        )}
        {getCommand('daily.today') && (
          <button type="button" className="button" onClick={() => runCommand('daily.today', { activePath: null })}>
            Today
          </button>
        )}
        {getCommand('help.open') && (
          <button type="button" className="button" onClick={() => runCommand('help.open', { activePath: null })}>
            Help
          </button>
        )}
      </div>
    </div>
  );
}
