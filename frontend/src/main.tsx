import { startApp } from './boot';
import './styles/tokens.css';
import './styles/app.css';
import './styles/editor.css';
import './styles/reading.css';
import './styles/features.css';
import './styles/bookmarks.css';
import './styles/hotkeys.css';
import './workspace/workspace.css';
import './styles/mobile.css';

async function boot(): Promise<void> {
  // The in-memory mock replaces the HTTP endpoints before anything fetches: in the GitHub Pages demo
  // (DESIGN §6.46), with its showcase vault, and on the dev server with VITE_MOCK_API=1. Both tests are
  // build-time constants (src/demo/mode.ts), so neither chunk is part of the server's build.
  if (import.meta.env.VITE_DEMO === '1') {
    const { installDemo } = await import('./demo/install');
    installDemo();
  } else if (import.meta.env.DEV && import.meta.env.VITE_MOCK_API === '1') {
    const { installMockApi } = await import('./api/mock');
    installMockApi();
  }
  // The demo has no server to cache for, and a worker at its base path would outlive it.
  startApp(document.getElementById('root')!, { serviceWorker: import.meta.env.VITE_DEMO !== '1' });
}

void boot();
