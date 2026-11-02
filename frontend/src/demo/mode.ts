// The live demo on GitHub Pages (DESIGN §6.46): the app built with `vite build --mode demo`, which
// runs on the in-memory mock API with a showcase vault and no server. VITE_DEMO is replaced at
// build time, so in every other build these are constants and the demo's code is left out.

/** The GitHub Pages demo build. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

/** The in-memory mock replaces the HTTP API: the demo, or the dev server with VITE_MOCK_API=1. */
export const MOCK_API = DEMO || (import.meta.env.DEV && import.meta.env.VITE_MOCK_API === '1');

/** The public repository the demo links to. */
export const REPO_URL = 'https://github.com/rjgehan/notesapp';
