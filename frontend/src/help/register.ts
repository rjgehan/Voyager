// Help (DESIGN §6.45): the user guide at `/x/help` and `/x/help/<page>`, a lazy chunk with the guide's
// pages in it. The route is hidden from the ribbon's and drawer's page lists; Help has its own
// entries next to Settings (ribbon, phone drawer, the top bar's ⋯, Settings) and these commands.
import { CircleHelp, Keyboard } from 'lucide-react';
import { registerCommand, registerPage } from '../extensions';
import { navigateTo } from '../features/navigation';
import { useUi } from '../state/ui';
import { helpRoute } from './guide';

/** Opens the guide (its contents, or one page and heading) in the active tab. */
export function openHelp(page?: string, anchor?: string): void {
  useUi.getState().setDrawerOpen(false);
  navigateTo(helpRoute(page, anchor));
}

export function registerHelp(): void {
  registerPage({ route: 'help/*', title: 'Help', icon: CircleHelp, hidden: true, load: () => import('./HelpPage') });
  registerCommand({ id: 'help.open', name: 'Open help (user guide)', icon: CircleHelp, run: () => openHelp() });
  registerCommand({ id: 'help.shortcuts', name: 'Open help: keyboard shortcuts', icon: Keyboard, run: () => openHelp('keyboard-shortcuts') });
}
