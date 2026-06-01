/**
 * Capture utilities for stickyfix.
 *
 * computeCropCoords — pure, node:test-safe (no DOM/chrome at module level).
 * waitTwoRafs, cropToRect, captureTab — browser-only, exercised in 04-03.
 *
 * INVARIANT: No top-level chrome / document / window access — all browser
 * API use is inside function bodies so computeCropCoords imports cleanly
 * under node:test.
 */

import { SFX_CAPTURE_TAB } from './types.js';

// ---------------------------------------------------------------------------
// computeCropCoords — pure, node:test-safe
// ---------------------------------------------------------------------------

/**
 * Convert a CSS-space rect to pixel-space canvas crop coordinates at the
 * given device pixel ratio.
 *
 * Math.round after DPR multiply is MANDATORY — Windows 125% DPR=1.25 produces
 * fractional pixels without it (PRD §7.3 / RESEARCH.md Pitfall 4).
 */
export function computeCropCoords(
  rect: { x: number; y: number; width: number; height: number },
  dpr: number
): { sx: number; sy: number; sw: number; sh: number } {
  return {
    sx: Math.round(rect.x * dpr),
    sy: Math.round(rect.y * dpr),
    sw: Math.round(rect.width * dpr),
    sh: Math.round(rect.height * dpr),
  };
}

// ---------------------------------------------------------------------------
// waitTwoRafs — browser rAF, not node:test-safe
// ---------------------------------------------------------------------------

/**
 * Wait two animation frames — ensures the browser has composited the
 * current frame before a screenshot is taken.
 */
export function waitTwoRafs(): Promise<void> {
  return new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

// ---------------------------------------------------------------------------
// cropToRect — browser canvas, not node:test-safe
// ---------------------------------------------------------------------------

/**
 * Crop a full-page data URL to the element's bounding rect at the given DPR.
 */
export function cropToRect(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  dpr: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { sx, sy, sw, sh } = computeCropCoords(rect, dpr);
    // CR-02: guard zero-dimension rect — toDataURL on a 0×0 canvas returns a
    // blank-but-valid PNG without throwing, violating the no-silent-failure invariant.
    if (sw <= 0 || sh <= 0) {
      reject(new Error(
        `Zero-dimension crop rect: ${sw}x${sh} (CSS: ${rect.width}x${rect.height} @ DPR ${dpr})`
      ));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No 2D context')); return; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// captureTab — chrome.runtime.sendMessage relay, not node:test-safe
// ---------------------------------------------------------------------------

/**
 * Ask the service worker to capture the visible tab and return the data URL.
 * Mirrors the getTabId() callback shape from chip.ts lines 505-520.
 */
export function captureTab(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: SFX_CAPTURE_TAB, tabId },
      (resp: { ok: true; dataUrl: string } | { ok: false; error: string } | undefined) => {
        if (chrome.runtime.lastError || !resp) {
          reject(new Error(chrome.runtime.lastError?.message ?? 'no response'));
          return;
        }
        if (resp.ok) resolve(resp.dataUrl);
        else reject(new Error(resp.error));
      }
    );
  });
}
