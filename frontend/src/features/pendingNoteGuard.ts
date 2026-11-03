// Navigating elsewhere while a new note is being created leaves that note where it is (DESIGN §6.15).
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { clearPendingNote } from '../state/pendingNote';

/** Clears the pending new note on every navigation (a new location key). */
export function usePendingNoteGuard(): void {
  const location = useLocation();
  const seen = useRef(location.key);
  useEffect(() => {
    if (seen.current !== location.key) {
      seen.current = location.key;
      clearPendingNote();
    }
  }, [location.key]);
}
