// Scripts in notes (ROADMAP items 40 and 17): `GET /api/notes/query` (API.md §40.1), the metadata
// of many notes at once from the server's index. Tags and properties repeat as parameters.
import { api, notesQueryUrl, type NotesQueryFilter } from '../api/endpoints';
import type { NotesQueryResponse } from '../api/types';

export type NotesFilter = NotesQueryFilter;
export { notesQueryUrl };

export function queryNotes(f: NotesFilter): Promise<NotesQueryResponse> {
  return api.queryNotes(f);
}
