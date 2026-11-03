// The application shell and its workspace of panes and tabs (DESIGN §6.4, §6.40).
import { lazy, Suspense, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CapturePage } from './components/capture/CapturePage';
import { AppShell } from './components/layout/AppShell';
import { setNavigator } from './features/navigation';
import { navigateOverOverlays } from './features/overlayHistory';
import { usePendingNoteGuard } from './features/pendingNoteGuard';
import { RouteSync } from './workspace/RouteSync';
import { startedAtHome } from './workspace/store';
import { StartupDailyNote } from './components/pages/HomePage';
import { WorkspaceLayout } from './workspace/WorkspaceLayout';

// The web clipper's page renders Markdown (markdown-it, DOMPurify, YAML): a chunk of its own.
const ClipPage = lazy(() => import('./components/clip/ClipPage').then((m) => ({ default: m.ClipPage })));

/**
 * Lets non-React code (links in the editor, sessions, commands) navigate through the router.
 * On touch devices a navigation first steps back over the history entries of open overlays.
 */
function NavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setNavigator((to, opts) => navigateOverOverlays(() => void navigate(to, opts)));
  }, [navigate]);
  return null;
}

export default function App() {
  usePendingNoteGuard();
  const { pathname } = useLocation();
  // The web clipper's hand-over page (DESIGN §6.27.1), outside the app shell.
  if (pathname === '/clip') {
    return (
      <>
        <NavigationBridge />
        <Suspense fallback={null}>
          <ClipPage />
        </Suspense>
      </>
    );
  }
  // Quick capture (DESIGN §6.27) is a page of its own, outside the app shell: the share target,
  // the home-screen shortcut and the desktop app's capture window open it.
  if (pathname === '/capture') {
    return (
      <>
        <NavigationBridge />
        <CapturePage />
      </>
    );
  }
  return (
    <AppShell>
      <NavigationBridge />
      <RouteSync />
      {startedAtHome() && <StartupDailyNote />}
      <WorkspaceLayout />
    </AppShell>
  );
}
