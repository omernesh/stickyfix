/**
 * URL-path matching and pin position computation for stickyfix persistent pins.
 *
 * matchesUrlPath + computePinPosition — pure, node:test-safe (no DOM/chrome at module level).
 * Scroll offsets and anchor rects are PASSED AS PARAMETERS by the caller (pin.ts in Plan 04),
 * which supplies window.scrollX/scrollY and el.getBoundingClientRect() at render time.
 *
 * INVARIANT: No top-level browser API access — no window/document/chrome references.
 * This module imports cleanly under node:test.
 */

/**
 * Compare two URLs by pathname only, ignoring query string and fragment (D-02).
 * Returns false (not throws) on any malformed URL input.
 *
 * @param noteUrl  The URL stored in the note's YAML frontmatter
 * @param pageUrl  The current page URL from chrome.tabs.get
 */
export function matchesUrlPath(noteUrl: string, pageUrl: string): boolean {
  try {
    const notePath = new URL(noteUrl).pathname;
    const pagePath = new URL(pageUrl).pathname;
    return notePath === pagePath;
  } catch {
    return false;
  }
}

/**
 * Compute the CSS viewport position for an on-page pin — pure, DOM-free.
 *
 * Branch logic:
 *   - orphaned || anchorRect === null: orphaned-fallback at last-known page-absolute
 *     rect minus scroll offsets → { left: storedRect.x - scrollX, top: storedRect.y - scrollY, orphaned: true }
 *   - !orphaned && anchorRect !== null: use anchorRect x/y directly (already in
 *     fixed/viewport coords from getBoundingClientRect or stored viewport coords
 *     for free notes) → { left: anchorRect.x, top: anchorRect.y, orphaned: false }
 *
 * The caller (pin.ts) passes:
 *   - anchorRect: el.getBoundingClientRect() for element pins, stored viewport
 *     coords {x,y,width:0,height:0} for free pins, or null when selector misses.
 *   - storedRect: page-absolute rect from frontmatter (for orphaned-fallback).
 *   - scrollX/scrollY: window.scrollX / window.scrollY at call time.
 *   - orphaned: true when the selector re-query returned null.
 *
 * NEVER reads window.scrollX or window.scrollY internally — caller supplies them.
 *
 * @param anchorRect  Live fixed-coord rect from getBoundingClientRect, or null
 * @param storedRect  Page-absolute rect from frontmatter (orphaned fallback), or null
 * @param scrollX     window.scrollX at call time (passed by caller)
 * @param scrollY     window.scrollY at call time (passed by caller)
 * @param orphaned    true when selector matched nothing on the current page
 */
export function computePinPosition(
  anchorRect: { x: number; y: number; width: number; height: number } | null,
  storedRect: { x: number; y: number; width: number; height: number } | null | undefined,
  scrollX: number,
  scrollY: number,
  orphaned: boolean,
): { left: number; top: number; orphaned: boolean } {
  if (orphaned || anchorRect === null) {
    // Orphaned fallback: last-known page-absolute rect → convert to viewport via scroll
    return {
      left: (storedRect?.x ?? 0) - scrollX,
      top: (storedRect?.y ?? 0) - scrollY,
      orphaned: true,
    };
  }
  // Element-anchored (live getBoundingClientRect in fixed/viewport coords)
  // OR free-floating (stored viewport coords already in anchorRect x/y)
  return {
    left: anchorRect.x,
    top: anchorRect.y,
    orphaned: false,
  };
}
