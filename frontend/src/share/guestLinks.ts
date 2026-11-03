// What formulas in a shared note read from other files (DESIGN §6.47, §6.48): the share's own
// files, through the guest endpoints, resolved against the share's tree, as links are. Never the
// owner's API: notes' properties and queries (NOTEPROP, NOTECOUNT, NOTEQUERY) need the vault's note
// index, which a guest cannot ask, so they show an error saying so.
import { queryKeys } from '../api/queryKeys';
import { formulaEngine } from '../formulas/load';
import type { LinkHost } from '../sheets/links/store';
import type { GuestSync } from './guestSync';

const TREE = queryKeys.tree()[0];

export const NOT_IN_SHARES = 'Not available in a shared note.';

export function guestLinkHost(sync: GuestSync): LinkHost {
  return {
    tree: () => sync.tree(),
    onTreeChange(fn) {
      return sync.qc.getQueryCache().subscribe((event) => {
        if (event.type === 'updated' && event.query.queryKey[0] === TREE) fn();
      });
    },
    queryNotes: () => Promise.reject(new Error(NOT_IN_SHARES)),
    readFile: async (path) => (await sync.api.readFile(path)).content,
    openDocument(path) {
      // Only a note being edited on this page: a cached session no editor holds may be behind the file.
      const session = sync.session(path);
      if (!session || session.editorCount === 0 || !session.getSnapshot().loaded) return null;
      return { text: () => session.getText(), subscribe: (fn) => session.subscribe(fn) };
    },
    tableComputer: async () => (await formulaEngine()).computeTables,
  };
}
