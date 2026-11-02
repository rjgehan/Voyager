// The link store's way into the app (ROADMAP item 42, DESIGN §6.45): the tree (kept current by
// this device's saves and the event stream), the notes query endpoint, the files, the documents
// open on this device, and item 39's engine for notes' tables. One vault per page (DESIGN §6.44):
// everything here is the page's vault, so a formula can never read another vault.
import { api } from '../../api/endpoints';
import { currentTree } from '../../api/hooks';
import { queryClient } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { formulaEngine } from '../../formulas/load';
import { documents } from '../../sync/instance';
import type { LinkHost } from './store';

const TREE = queryKeys.tree()[0];

export function appLinkHost(): LinkHost {
  return {
    tree: currentTree,
    onTreeChange(fn) {
      return queryClient.getQueryCache().subscribe((event) => {
        if (event.type === 'updated' && event.query.queryKey[0] === TREE) fn();
      });
    },
    queryNotes: (filter) => api.queryNotes(filter),
    readFile: async (path) => (await api.readFile(path)).content,
    openDocument(path) {
      // Only a document being edited here: a cached session no view holds may be behind the file.
      const session = documents.get(path);
      if (!session || session.editorCount === 0 || !session.getSnapshot().loaded) return null;
      return { text: () => session.getText(), subscribe: (fn) => session.subscribe(fn) };
    },
    tableComputer: async () => (await formulaEngine()).computeTables,
  };
}
