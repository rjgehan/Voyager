// Where a floating element (a context menu) may go (DESIGN §6.16): the visual viewport, which
// excludes the iOS keyboard, less the status bar and the home indicator. Coordinates are those of
// position: fixed (the layout viewport).

export interface VisibleArea {
  top: number;
  bottom: number;
}

/** The safe-area insets, measured on a probe because env() cannot be read from script. */
function insets(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-top,0px);width:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const out = { top: probe.offsetHeight, bottom: probe.offsetWidth };
  probe.remove();
  return out;
}

/** The vertical span, `margin` px inside the safe areas, where a floating element stays visible. */
export function visibleArea(margin = 8): VisibleArea {
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const height = vv ? vv.height : window.innerHeight;
  const safe = insets();
  // Above the keyboard the home indicator is covered, so its inset does not apply.
  const keyboard = document.documentElement.classList.contains('keyboard-open');
  return {
    top: top + Math.max(margin, top > 0 ? 0 : safe.top),
    bottom: top + height - Math.max(margin, keyboard ? 0 : safe.bottom),
  };
}

/** The top of an element `height` px tall that wants to start at `y`, moved up or down to fit. */
export function fitVertically(y: number, height: number, area: VisibleArea = visibleArea()): number {
  return Math.max(area.top, Math.min(y, area.bottom - height));
}
