// The routes of DESIGN §6.4, rendered once per pane (§6.40): each pane passes the location of its
// shown tab, so an inactive pane renders its own route while the URL shows the active pane's.
import { Suspense, type ComponentType } from 'react';
import { Route, Routes, useLocation, type Location } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { cachedLazy } from './components/lazyCache';
import { HomePage } from './components/pages/HomePage';
import { NotFoundPage } from './components/pages/NotFoundPage';
import { PendingNoteView } from './components/pages/PendingNoteView';
import { SearchPage } from './components/pages/SearchPage';
import { TrashPage } from './components/pages/TrashPage';
import { registeredPages, useExtensionsVersion, type PageDescriptor } from './extensions';
import { usePendingNote } from './state/pendingNote';
import { FileView } from './views/FileView';

const lazyPages = new Map<string, ComponentType>();
/** The cache key of Settings, which no page route can take. */
const SETTINGS = ' settings';
const loadSettings = () => import('./components/pages/SettingsPage');

/** Resolves the page as it mounts, so a remount after a failed chunk ("Reload view") loads it again. */
function PageHost({ id, load }: { id: string; load: PageDescriptor['load'] }) {
  const Page = cachedLazy(lazyPages, id, load);
  // Page comes from a module-level cache keyed by route, so its identity is stable.
  // eslint-disable-next-line react-hooks/static-components
  return <Page />;
}

const pageFallback = <div className="view-loading" aria-busy="true" />;

export function AppRoutes({ location, active = true }: { location?: Location; active?: boolean }) {
  useExtensionsVersion();
  const routerLocation = useLocation();
  // Each page has its own error boundary, cleared when the address changes (another list).
  const pathname = (location ?? routerLocation).pathname;
  const pending = usePendingNote((s) => s.pending);
  const pages = registeredPages();
  // A note being created shows in the active pane, where New note was asked for.
  if (pending && active) return <PendingNoteView key={pending.id} pending={pending} />;
  return (
    <Routes location={location}>
      <Route path="/" element={<HomePage />} />
      <Route path="/n/*" element={<FileView />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/trash" element={<TrashPage />} />
      <Route
        path="/settings/*"
        element={
          <ErrorBoundary key="settings" label="page" resetKeys={[pathname]}>
            <Suspense fallback={pageFallback}>
              <PageHost id={SETTINGS} load={loadSettings} />
            </Suspense>
          </ErrorBoundary>
        }
      />
      {pages.map(({ route, load }) => (
        <Route
          key={route}
          path={`/x/${route}`}
          element={
            <ErrorBoundary key={route} label="page" resetKeys={[pathname]}>
              <Suspense fallback={pageFallback}>
                <PageHost id={route} load={load} />
              </Suspense>
            </ErrorBoundary>
          }
        />
      ))}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
