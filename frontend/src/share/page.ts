// The guest page's title and landing address (DESIGN §6.45).
import { vaultBasename } from '../state/vault';

export function setTitle(title: string): void {
  document.title = `${title} · Shared · Notes`;
}

/** The landing page of this vault's guest page. */
export function landingHref(): string {
  return `${vaultBasename()}/s`;
}
