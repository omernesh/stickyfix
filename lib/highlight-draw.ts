/**
 * Canvas highlight box draw utility for stickyfix.
 *
 * drawHighlightBox — pure, node:test-safe (no DOM/chrome at module level).
 * Takes a canvas element reference (passed in) — no document.createElement calls.
 *
 * INVARIANT: No top-level browser API access — all canvas operations are inside
 * the function body so this module imports cleanly under node:test.
 */

/**
 * Draw a DPR-scaled highlight box on a canvas over the given CSS-space rect.
 *
 * Fill order: fill (rgba(255,107,0,0.15)) THEN stroke (#ff6b00, 2*dpr line).
 * Math.round after DPR multiply is MANDATORY — Windows 125% DPR=1.25 produces
 * fractional pixels without it (RESEARCH.md Pitfall 4).
 *
 * @param canvas  Canvas element to draw on (passed in — no document access)
 * @param rect    CSS-space bounding rect of the target element
 * @param dpr     Device pixel ratio (window.devicePixelRatio in the browser)
 */
export function drawHighlightBox(
  canvas: HTMLCanvasElement,
  rect: { x: number; y: number; width: number; height: number },
  dpr: number
): void {
  // --- get 2D context ---
  const ctx = canvas.getContext('2d');
  if (!ctx) return;  // null ctx safe no-op

  // --- DPR-scale coords (Math.round mandatory) ---
  const x = Math.round(rect.x * dpr);
  const y = Math.round(rect.y * dpr);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);

  // --- zero-dim guard — no draw on collapsed elements ---
  if (w <= 0 || h <= 0) return;

  // --- fill THEN stroke (UI-SPEC §4) ---
  ctx.fillStyle = 'rgba(255, 107, 0, 0.15)';
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = '#ff6b00';
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(x, y, w, h);
}
