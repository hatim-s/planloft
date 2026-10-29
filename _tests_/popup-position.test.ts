import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionPopup } from '../src/collaboration/ui/popup-position.js';

test('popups prefer space beside a passage, then remain inside the visible viewport', () => {
  const popup = { width: 360, height: 300 };
  const viewport = { left: 0, top: 0, width: 1400, height: 900 };
  assert.deepEqual(positionPopup({ anchor: { left: 300, top: 200, width: 400, height: 20 }, popup, viewport, anchored: true }), { left: 712, top: 200 });
  assert.deepEqual(positionPopup({ anchor: { left: 500, top: 200, width: 700, height: 20 }, popup, viewport, anchored: true }), { left: 128, top: 200 });
  for (const width of [320, 390, 768, 1400]) {
    for (const top of [-1000, 0, 200, 1500]) {
      const visible = { left: 20, top: 100, width, height: 400 };
      const size = { width: Math.min(360, width - 24), height: 300 };
      const result = positionPopup({ anchor: { left: 50, top, width: 600, height: 20 }, popup: size, viewport: visible, anchored: true });
      assert.ok(result.left >= visible.left + 12 && result.left + size.width <= visible.left + width - 12);
      assert.ok(result.top >= visible.top + 12 && result.top + size.height <= visible.top + visible.height - 12);
    }
  }
});
