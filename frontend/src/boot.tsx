// Starts the app on a page (main.tsx; the boot test, src/demo/boot.test.tsx): installs the global
// listeners, live sync and reminders, then renders the router into `root`. The API must be ready
// first: main.tsx installs the in-memory mock before calling this when the build asks for it.
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { queryClient } from './api/queryClient';
import { currentBreakpoint } from './components/layout/useBreakpoint';
import { installViewportVars } from './editor/mobileViewport';
import { registerBuiltins } from './extensions/builtins';
import { installInputModality } from './features/focus';
import { clearStaleOverlayEntry } from './features/overlayHistory';
import { installDesktopBridge } from './desktop/bridge';
import { installCaptureSync } from './features/captureSync';
import { startReminders } from './features/reminders/register';
import { installHotkeys } from './features/hotkeys';
import { prepareReload, registerServiceWorker, setOfflineMedia } from './pwa/serviceWorker';
import { installPreloadErrorHandler, setReloadPreparer } from './state/buildCheck';
import { installOnlineListener } from './state/connection';
import { applyTheme, installThemeListener, usePrefs } from './state/prefs';
import { documents } from './sync/instance';
import { startLiveSync } from './sync/liveSync';
import { vaultBasename } from './state/vault';

export interface StartOptions {
  /** Register the service worker (DESIGN §6.26); the demo has no server to cache for. */
  serviceWorker: boolean;
}

export function startApp(root: HTMLElement, options: StartOptions): Root {
  clearStaleOverlayEntry();
  applyTheme();
  installThemeListener();
  registerBuiltins();
  installViewportVars();
  installHotkeys();
  installInputModality();
  installPreloadErrorHandler();
  // The installable app (DESIGN §6.26): a build reload first lets the new service worker take over.
  setReloadPreparer(() => prepareReload());
  if (options.serviceWorker) registerServiceWorker();
  setOfflineMedia(usePrefs.getState().offlineNotes);
  installOnlineListener();
  documents.installLifecycle(() => currentBreakpoint() === 'desktop');
  void startLiveSync();
  installCaptureSync();
  startReminders();
  // Inside the desktop app (ROADMAP item 41): tray commands, resume, and the title's connection state.
  installDesktopBridge();

  // Navigations render synchronously (no transitions), so an input shown by a tap or key handler
  // can take focus within the same user gesture, which iOS needs to open the keyboard (§6.13).
  const reactRoot = createRoot(root);
  reactRoot.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={vaultBasename() || undefined} useTransitions={false}>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
  return reactRoot;
}
