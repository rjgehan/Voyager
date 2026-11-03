// Which files the page's formulas read (DESIGN §6.47, §6.48). The owner's app provides its vault
// (`appLinkHost`, host.ts, when it starts: boot.tsx); the guest page of shares provides its share
// (share/guestLinks.ts). The link store asks here, so the formula engine's chunk imports neither
// page's singletons: on the guest page, loading it runs none of the owner's app.
import type { LinkHost } from './store';

let factory: (() => LinkHost) | null = null;
let generation = 0;

/** The page's way to its files, or null (nothing to read: references to other files show an error). */
export function provideLinkHost(make: (() => LinkHost) | null): void {
  factory = make;
  generation++;
}

/** The provided host, made afresh, or null when the page provided none. */
export function pageLinkHost(): LinkHost | null {
  return factory ? factory() : null;
}

/** Changes with every `provideLinkHost`: the store starts again over the new host. */
export function linkHostGeneration(): number {
  return generation;
}
