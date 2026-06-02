/**
 * stickyfix + FAB component — shadow-root UI
 *
 * Renders a draggable "Add note" floating action button (FREE-01).
 *
 * Drag implementation: threshold-based pointer-events drag with a 4px deadzone
 * so a real mouse click always fires the native `click` event (FIX 1).
 * interactjs is NOT used here — it consumes the pointer gesture with no
 * click/drag threshold, swallowing clicks before they reach the click listener.
 *
 * Security invariants:
 *  - DOM via createElement/textContent only — no innerHTML (INVARIANT C)
 *  - sfx-* namespace (INVARIANT D)
 *  - Does NOT touch chip's makeDraggable (INVARIANT E)
 */

/**
 * Mount the + FAB inside the shadow-root container.
 * Wire threshold-based pointer-events drag with viewport-clamping + 4px deadzone.
 *
 * @param container  The shadow-root mounting point from createShadowRootUi onMount
 * @param onOpen     Called when FAB is clicked (card open/focus decision is in index.ts)
 * @returns          The fab button element
 */
export function mountFab(
  container: HTMLElement,
  onOpen: () => void
): HTMLButtonElement {
  // Build FAB via createElement/textContent — INVARIANT C
  const fab = document.createElement('button');
  fab.id = 'sfx-fab';
  fab.setAttribute('aria-label', 'Add note');
  fab.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('span');
  icon.className = 'sfx-fab-icon';
  icon.textContent = '+';
  fab.appendChild(icon);

  container.appendChild(fab);

  // -------------------------------------------------------------------------
  // Click handler — delegates open/focus decision to the caller (onOpen).
  // Registered BEFORE the pointer-events drag so the drag suppressor
  // (addEventListener once+capture) fires in the capture phase before this
  // bubble-phase handler when suppression is needed after a drag ends.
  // -------------------------------------------------------------------------
  fab.addEventListener('click', onOpen);

  // -------------------------------------------------------------------------
  // Drag: threshold-based pointer-events (replaces interactjs — FIX 1).
  //
  // Why not interactjs: interactjs binds on pointerdown and consumes the gesture
  // immediately (no threshold), so the synthetic `click` event that the browser
  // emits after a short press is suppressed. Programmatic fab.click() still
  // works because it bypasses the pointer pipeline entirely.
  //
  // This implementation:
  //  - pointerdown: record start position; do NOT preventDefault/setCapture yet.
  //  - pointermove: once movement > DRAG_THRESHOLD px, enter drag mode:
  //      setPointerCapture, set dragging flag, apply translate with viewport clamp.
  //  - pointerup: if dragging, end drag + suppress the one synthetic click that
  //      follows (addEventListener capture+once stopper). If not dragging (tap),
  //      do nothing → native click fires normally → onOpen runs.
  // -------------------------------------------------------------------------
  const DRAG_THRESHOLD = 4; // px — matches UI-SPEC §1

  let dragging = false;
  let startPtrX = 0;
  let startPtrY = 0;
  let startTransX = 0;
  let startTransY = 0;
  // Anchor = element position at drag start minus the translate already applied.
  // Computed on first threshold crossing from the element rect at that moment.
  let anchorLeft = 0;
  let anchorTop  = 0;

  /** Read the current translate from computed style. */
  function readTranslate(el: HTMLElement): { tx: number; ty: number } {
    const transform = window.getComputedStyle(el).transform;
    if (transform && transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(transform);
      return { tx: matrix.m41, ty: matrix.m42 };
    }
    return { tx: 0, ty: 0 };
  }

  fab.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Record start; do NOT preventDefault or capture yet — we must allow the
    // native click to proceed if the user just taps (no drag threshold crossed).
    dragging = false;
    startPtrX = e.clientX;
    startPtrY = e.clientY;
    const { tx, ty } = readTranslate(fab);
    startTransX = tx;
    startTransY = ty;
  });

  fab.addEventListener('pointermove', (e: PointerEvent) => {
    // Ignore unless left button is held (buttons bitmask; hasPointerCapture is
    // false until setPointerCapture is called so we cannot rely on it here).
    if (!(e.buttons & 1)) return;

    const dx = e.clientX - startPtrX;
    const dy = e.clientY - startPtrY;

    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // still within deadzone
      // Threshold crossed → begin drag.
      // Compute the element's anchor position (left/top without translate) once,
      // at the moment drag starts, using the current rect.
      const rect = fab.getBoundingClientRect();
      const w = rect.width  || 44;
      const h = rect.height || 44;
      // rect.left = anchorLeft + currentTransX, and currentTransX = startTransX
      // (we haven't moved the translate yet), so:
      anchorLeft = rect.left - startTransX;
      anchorTop  = rect.top  - startTransY;
      dragging = true;
      fab.setPointerCapture(e.pointerId);
      // Store w/h for clamping; re-read on each move for robustness.
      void w; void h;
    }

    const newX = startTransX + dx;
    const newY = startTransY + dy;

    // Viewport clamping — keep element inside window using fixed anchor + current size.
    const rect2 = fab.getBoundingClientRect();
    const w2 = rect2.width  || 44;
    const h2 = rect2.height || 44;

    const clampedX = Math.max(-anchorLeft, Math.min(window.innerWidth  - anchorLeft - w2, newX));
    const clampedY = Math.max(-anchorTop,  Math.min(window.innerHeight - anchorTop  - h2, newY));

    fab.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
  });

  fab.addEventListener('pointerup', (e: PointerEvent) => {
    if (!dragging) return; // tap — let the native click fire
    dragging = false;
    if (fab.hasPointerCapture(e.pointerId)) {
      fab.releasePointerCapture(e.pointerId);
    }
    // Suppress the synthetic click that the browser emits after pointerup.
    // Capture phase + once: fires before the bubble-phase `click` handler (onOpen)
    // and stops propagation for this one event only.
    fab.addEventListener('click', _suppressOnce, { capture: true, once: true });
  });

  fab.addEventListener('pointercancel', (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try { fab.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // pointercancel does not produce a synthetic click — no suppression needed.
  });

  return fab;
}

/** One-shot click stopper used after a drag ends (capture phase). */
function _suppressOnce(e: Event): void {
  e.stopImmediatePropagation();
}
