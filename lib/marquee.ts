/**
 * Marquee rect utilities for stickyfix region capture.
 *
 * buildMarqueeRect + isBelowThreshold + MARQUEE_MIN_PX — pure, node:test-safe.
 * Takes raw coordinate numbers (CSS viewport coords from interact.js events).
 *
 * INVARIANT: No top-level browser API access — all operations are inside
 * the function body so this module imports cleanly under node:test.
 */

/**
 * Minimum drag extent (pixels) in EACH dimension for a marquee region
 * to be accepted. If BOTH width AND height are below this threshold,
 * the capture is cancelled (CAM-03).
 */
export const MARQUEE_MIN_PX = 6;

/**
 * Normalize a two-corner marquee drag into a top-left origin rect.
 * Handles all four drag directions (top-left, top-right, bottom-left, bottom-right).
 *
 * Works in CSS viewport coords — no DPR scaling (cropToRect applies DPR separately).
 *
 * @param startX  X coordinate where drag began (clientX at dragstart)
 * @param startY  Y coordinate where drag began (clientY at dragstart)
 * @param endX    X coordinate where drag ended (clientX at dragend)
 * @param endY    Y coordinate where drag ended (clientY at dragend)
 */
export function buildMarqueeRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

/**
 * Return true when the rect is too small to be an intentional region capture.
 * BOTH width AND height must be strictly below MARQUEE_MIN_PX (6px) to cancel;
 * a wide-but-short or narrow-but-tall marquee is NOT cancelled.
 *
 * @param rect  Rect with width/height in CSS pixels
 */
export function isBelowThreshold(rect: { width: number; height: number }): boolean {
  return rect.width < MARQUEE_MIN_PX && rect.height < MARQUEE_MIN_PX;
}
