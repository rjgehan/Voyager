// The guest page of shares (ROADMAP item 42, DESIGN §6.45): the landing page (`/s`), and one
// share (`/s/<key>`), whose view (the editor and its machinery) is a lazy chunk. Nothing of the
// owner's app runs here.
import { FileText, Folder, Users } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import type { GuestLandingResponse } from '../api/types';
import { Dialogs } from '../components/overlays/Dialogs';
import { Toasts } from '../components/overlays/Toasts';
import { toast } from '../state/toasts';
import { fetchLanding, parseGuestRoute } from './guestApi';
import { setTitle } from './page';
import { LandingLink, Loading, Problem } from './parts';

const ShareView = lazy(() => import('./ShareView'));

// ---------- location ----------

function currentLocation() {
  return { pathname: window.location.pathname, search: window.location.search };
}

/** The page's address, and a navigation that changes it without loading the page again. */
function useGuestLocation(): [{ pathname: string; search: string }, (href: string, replace?: boolean) => void] {
  const [loc, setLoc] = useState(currentLocation);
  useEffect(() => {
    const onPop = () => setLoc(currentLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((href: string, replace = false) => {
    if (replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
    setLoc(currentLocation());
  }, []);
  return [loc, navigate];
}


// ---------- landing ----------

function Landing() {
  const [state, setState] = useState<{ data: GuestLandingResponse | null; error: unknown }>({ data: null, error: null });
  useEffect(() => {
    setTitle('Shared with you');
    fetchLanding().then(
      (data) => setState({ data, error: null }),
      (error: unknown) => setState({ data: null, error }),
    );
  }, []);
  if (state.error) return <Problem title="Can’t show what is shared with you" detail={errorMessage(state.error)} />;
  if (!state.data) return <Loading />;
  const { login, shares } = state.data;
  return (
    <main className="guest-landing">
      <h1 className="guest-landing-title">
        <Users size={22} aria-hidden /> Shared with you
      </h1>
      {shares.length === 0 ? (
        <p className="guest-explain">
          Nothing is shared with <strong>{login}</strong> yet. Ask the person who runs this NotesApp to share a note or folder with that Tailscale login, or
          to send you its link.
        </p>
      ) : (
        <ul className="guest-landing-list">
          {shares.map((s) => (
            <li key={`${s.vault ?? ''}/${s.id}`}>
              <a className="guest-landing-item" href={s.url}>
                {s.kind === 'folder' ? <Folder size={18} aria-hidden /> : <FileText size={18} aria-hidden />}
                <span className="guest-landing-name">{s.title}</span>
                <span className="guest-badge">{s.mode === 'edit' ? 'Can edit' : 'View only'}</span>
                <span className="guest-landing-meta">
                  Shared by {s.sharedBy}
                  {s.vault ? ` · ${s.vault}` : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="guest-signed-in">Signed in as {login} (your Tailscale login)</p>
    </main>
  );
}

export function GuestApp() {
  const [loc, navigate] = useGuestLocation();
  const route = parseGuestRoute(loc.pathname, loc.search);
  useEffect(() => {
    const onOffline = () => toast('Offline: changes are kept on this device and saved when the connection is back.');
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, []);
  let page;
  if (route.kind === 'landing') page = <Landing />;
  else if (route.kind === 'share')
    page = (
      <Suspense fallback={<Loading />}>
        <ShareView key={route.key} shareKey={route.key} path={route.path} navigate={navigate} />
      </Suspense>
    );
  else page = <Problem title="Not a share address" detail="Check the address you were sent." action={<LandingLink />} />;
  return (
    <div className="guest-app">
      {page}
      <Toasts />
      <Dialogs />
    </div>
  );
}
