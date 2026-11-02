// Starts the GitHub Pages demo (DESIGN §6.45): the in-memory mock API over the showcase vault, with
// the banner that says what this is. Loaded by main.tsx before anything fetches, in the demo build only.
import { installMockApi } from '../api/mock';
import { GRAPH_KEY } from '../features/graph/options';
import { showDemoBanner } from './banner';
import { demoSeedFiles } from './seed';

/** The graph's color groups for the showcase vault, unless this browser already chose its own. */
export const DEMO_GRAPH_GROUPS = [
  { query: 'path:Daily', color: '#4fb3d9' },
  { query: 'path:Projects', color: '#e8885a' },
  { query: 'path:Meetings', color: '#b07fe8' },
  { query: 'path:Learning', color: '#4cc9b0' },
  { query: 'path:Reading', color: '#e070c0' },
];

export function installDemo(): void {
  // A little latency, so loading states look as they do against a server, without feeling slow.
  installMockApi({ seed: demoSeedFiles(), latency: 25 });
  try {
    if (localStorage.getItem(GRAPH_KEY) === null) localStorage.setItem(GRAPH_KEY, JSON.stringify({ colorGroups: DEMO_GRAPH_GROUPS }));
  } catch {
    // Storage blocked: the graph shows without groups.
  }
  showDemoBanner();
}
