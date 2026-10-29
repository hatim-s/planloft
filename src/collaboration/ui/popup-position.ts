type Rect = { left: number; top: number; width: number; height: number };

/** Position is derived from live text geometry; it is never a saved comment anchor. */
export function positionPopup({ anchor, popup, viewport, anchored }: {
  anchor: Rect;
  popup: { width: number; height: number };
  viewport: Rect;
  anchored: boolean;
}): { left: number; top: number } {
  const gap = 12;
  const right = viewport.left + viewport.width - gap;
  const bottom = viewport.top + viewport.height - gap;
  let left = anchor.left + anchor.width - popup.width;
  let top = anchor.top - popup.height - gap;
  if (anchored) {
    if (anchor.left + anchor.width + gap + popup.width <= right) {
      left = anchor.left + anchor.width + gap;
      top = anchor.top;
    } else if (anchor.left - gap - popup.width >= viewport.left + gap) {
      left = anchor.left - gap - popup.width;
      top = anchor.top;
    } else if (anchor.top + anchor.height + gap + popup.height <= bottom) {
      top = anchor.top + anchor.height + gap;
    }
  }
  return {
    left: Math.max(viewport.left + gap, Math.min(left, right - popup.width)),
    top: Math.max(viewport.top + gap, Math.min(top, bottom - popup.height)),
  };
}
