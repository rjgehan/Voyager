// Where editor code finds the session of the note it shows, without importing a page's registry:
// the owner's app (sync/instance.ts) and the guest page of shares (share/guestSync.ts) each
// provide their own, so the editor's modules stay free of either page's singletons (DESIGN §6.45).
import type { DocumentSession } from './DocumentSession';

let lookup: (path: string) => DocumentSession | undefined = () => undefined;

export function provideSessionLookup(fn: (path: string) => DocumentSession | undefined): void {
  lookup = fn;
}

/** The open session of `path` on this page, if any. */
export function sessionAt(path: string): DocumentSession | undefined {
  return lookup(path);
}
