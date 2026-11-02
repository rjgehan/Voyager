// Where this device last looked at each canvas (DESIGN §6.8.2), so reopening one continues there.
// Per vault: two vaults may each have a `Board.canvas`.
import { vaultKey } from '../../state/vault';
import type { Viewport } from './controller';

const VIEW_KEY = 'notesapp:canvas-view:';

/** The world point at the middle of the stage, and the zoom. */
export interface SavedView {
  cx: number;
  cy: number;
  zoom: number;
}

export function loadViewport(path: string): SavedView | undefined {
  try {
    const raw = localStorage.getItem(vaultKey(VIEW_KEY + path));
    if (!raw) return undefined;
    const v = JSON.parse(raw) as SavedView;
    return Number.isFinite(v.cx) && Number.isFinite(v.cy) && Number.isFinite(v.zoom) && v.zoom > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function saveViewport(path: string, v: Viewport, stage: { width: number; height: number }): void {
  try {
    const saved: SavedView = {
      cx: Math.round((stage.width / 2 - v.x) / v.zoom),
      cy: Math.round((stage.height / 2 - v.y) / v.zoom),
      zoom: Math.round(v.zoom * 1000) / 1000,
    };
    localStorage.setItem(vaultKey(VIEW_KEY + path), JSON.stringify(saved));
  } catch {
    // Storage full or disabled: the viewport is a convenience.
  }
}
