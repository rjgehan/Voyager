// Always loaded (registered as an overlay): mounts the share dialog's lazy chunk only while the
// dialog is open, so sharing adds nothing to the main chunk but this and the dialog's store.
import { lazy, Suspense } from 'react';
import { useShareDialog } from '../../features/shares';

const ShareDialog = lazy(() => import('./ShareDialog'));

export function ShareOverlay() {
  const open = useShareDialog((s) => s.path !== null);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ShareDialog />
    </Suspense>
  );
}
