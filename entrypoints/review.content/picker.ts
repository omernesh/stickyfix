/**
 * stickyfix picker — pick-mode lifecycle + hover-highlight overlay
 *
 * Provides enterPickMode / exitPickMode for element-note mode (ELEM-01).
 * Pure DOM/event module — no chrome.* calls.
 *
 * Security invariants:
 *  - DOM via createElement/textContent only — no innerHTML (INVARIANT C)
 *  - Label text is set via textContent — page-derived tag/id/class strings
 *    are never passed through innerHTML (T-05-05)
 *  - mousemove guard skips sfx-internal targets (T-05-06)
 *  - sfx-* namespace (INVARIANT D)
 */

// ---------------------------------------------------------------------------
// Module-level mutable state (single pick session at a time)
// ---------------------------------------------------------------------------

let hoverOverlay: HTMLDivElement | null = null;
let hoverLabel: HTMLSpanElement | null = null;
let hintsPanel: HTMLDivElement | null = null;
let currentTarget: Element | null = null;
let _cleanupFns: Array<() => void> = [];
let _container: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enter pick mode: build the hover-highlight overlay, register document
 * event listeners, and add the crosshair cursor class to :host.
 *
 * @param container      Shadow-root mounting point (also the guard boundary)
 * @param onElementClick Called with the page element the user clicked
 * @param onEsc          Called after pick mode exits via Escape key
 * @param opts           Optional behavior flags. `showHints` builds a fixed
 *                       on-screen instruction panel (default: off).
 */
export function enterPickMode(
  container: HTMLElement,
  onElementClick: (el: Element) => void,
  onEsc: () => void,
  opts?: { showHints?: boolean }
): void {
  // Idempotent — if already active, exit first then re-enter
  if (hoverOverlay !== null) {
    exitPickMode();
  }

  _container = container;

  // Resolve the stickyfix shadow HOST element (the <sfx-review-ui> custom element
  // in the PAGE tree). Shadow-DOM event retargeting reports `e.target` as this host
  // for ANY hover/click on our own UI (chip, FAB, card, overlay) — and the host is
  // NOT inside `container` (container lives inside the host's shadow root), so the
  // `container.contains(target)` guard alone misses it. Exclude the host explicitly
  // so the picker never highlights/picks stickyfix's own UI (T-05-06).
  const rootNode = container.getRootNode();
  const sfxHost: Element | null =
    rootNode instanceof ShadowRoot ? rootNode.host : null;

  // -------------------------------------------------------------------------
  // Build hover-highlight overlay via createElement/textContent — INVARIANT C
  // -------------------------------------------------------------------------
  const overlay = container.ownerDocument.createElement('div');
  overlay.className = 'sfx-hover-highlight';
  hoverOverlay = overlay;

  const label = container.ownerDocument.createElement('span');
  label.className = 'sfx-hover-label';
  overlay.appendChild(label);
  hoverLabel = label;

  container.appendChild(overlay);

  // Apply crosshair cursor to :host by toggling a class on the shadow host
  // (:host(.sfx-pick-mode) { cursor: crosshair } in styles.css)
  container.classList.add('sfx-pick-mode');

  // -------------------------------------------------------------------------
  // Optional on-screen hints panel — created via createElement/textContent only
  // (INVARIANT C). pointer-events:none (CSS) so it never blocks picking; removed
  // in exitPickMode. Anchored top-left so it never collides with the chip
  // (top:16 right:16) or FAB (bottom:32 right:32).
  // -------------------------------------------------------------------------
  if (opts?.showHints) {
    const panel = container.ownerDocument.createElement('div');
    panel.className = 'sfx-pick-hints';

    const title = container.ownerDocument.createElement('div');
    title.className = 'sfx-pick-hints-title';
    title.textContent = 'Pick an element — drag to move';
    panel.appendChild(title);

    // Close (×) — dismisses the hints for this pick session (re-appears next time
    // unless turned off in the popup). pointerdown stopPropagation so clicking it
    // never starts a panel drag.
    const closeBtn = container.ownerDocument.createElement('button');
    closeBtn.className = 'sfx-pick-hints-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close hints');
    closeBtn.addEventListener('pointerdown', (e: PointerEvent) => e.stopPropagation());
    closeBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      if (hintsPanel !== null) {
        hintsPanel.remove();
        hintsPanel = null;
      }
    });
    panel.appendChild(closeBtn);

    const list = container.ownerDocument.createElement('ol');
    list.className = 'sfx-pick-hints-list';
    const steps = [
      '1. Hover an item — it highlights orange. Click to select (turns blue).',
      '2. Click again or press Enter to open the note.',
      '3. Use ↑ / ↓ to select the parent or child element. Esc to cancel.',
    ];
    for (const step of steps) {
      const item = container.ownerDocument.createElement('li');
      item.textContent = step;
      list.appendChild(item);
    }
    panel.appendChild(list);

    container.appendChild(panel);
    hintsPanel = panel;

    // Draggable so the user can pull the panel off any element they want to pick
    // (or out from under the free-note card). The panel is our own shadow UI, so
    // isPageTarget() excludes it — dragging never triggers a pick, and the
    // picker's document-level click/mousedown suppression ignores it.
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    panel.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      panel.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    panel.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - offsetX));
      const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - offsetY));
      panel.style.left = `${x}px`;
      panel.style.top = `${y}px`;
      panel.style.right = 'auto';
      e.preventDefault();
      e.stopPropagation();
    });
    const endHintsDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (panel.hasPointerCapture(e.pointerId)) panel.releasePointerCapture(e.pointerId);
    };
    panel.addEventListener('pointerup', endHintsDrag);
    panel.addEventListener('pointercancel', endHintsDrag);
  }

  // -------------------------------------------------------------------------
  // mousemove — rAF-throttled; evaluates BOTH guards SYNCHRONOUSLY before rAF
  // -------------------------------------------------------------------------
  let rafPending = false;
  // Two-step selection: the FIRST click (or ↑/↓ traversal) marks the highlight
  // as "selected" — it turns blue (.sfx-pick-locked) and "sticks" to the element
  // so small cursor jitter (e.g. while clicking again to confirm) does not snap
  // it back to the element under the pointer. A deliberate move (> UNLOCK_DIST px)
  // clears the selection and resumes live (orange) hover-highlighting.
  let selected = false;
  let lastX = 0;
  let lastY = 0;
  let lockX = 0;
  let lockY = 0;
  const UNLOCK_DIST = 12;

  const onMouseMove = (e: MouseEvent) => {
    lastX = e.clientX;
    lastY = e.clientY;

    const target = e.target as Element | null;
    if (!target) return;

    if (selected) {
      if (Math.hypot(e.clientX - lockX, e.clientY - lockY) < UNLOCK_DIST) return;
      selected = false;
      hoverOverlay?.classList.remove('sfx-pick-locked');
    }

    // Guard 1 (synchronous): shadow-host guard — skip sfx-internal targets (T-05-06 / Pitfall 5).
    // Covers both the inner mount container AND the page-tree shadow host element
    // (retargeting reports the host for anything inside our shadow root).
    if (target === container || container.contains(target)) return;
    if (sfxHost !== null && (target === sfxHost || sfxHost.contains(target))) return;

    // Guard 2 (synchronous): identity guard — skip if same element already shown
    if (target === currentTarget) return;

    // Both guards passed — queue rAF (single pending flag throttle)
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        // updateOverlay FIRST, then assign currentTarget (so next mousemove
        // for the same element is short-circuited only after overlay reflects it)
        updateOverlay(target);
        currentTarget = target;
      });
    }
  };

  // -------------------------------------------------------------------------
  // isPageTarget — true when the event target is a real page element (not our
  // own shadow UI). Mirrors the mousemove guards (container + shadow host).
  // -------------------------------------------------------------------------
  const isPageTarget = (target: Element | null): target is Element => {
    if (!target) return false;
    if (target === container || container.contains(target)) return false;
    if (sfxHost !== null && (target === sfxHost || sfxHost.contains(target))) return false;
    return true;
  };

  // -------------------------------------------------------------------------
  // click — TWO-STEP selection. Registered in the CAPTURE phase (3rd arg true)
  // so the picker sees the click before any page/framework handler.
  // preventDefault + stopImmediatePropagation ALWAYS fire on a page target so
  // the page never navigates/activates: picking a link must not navigate away
  // before a note can be written (reliable capture is the product's core value;
  // supersedes the original T-05-08 "let the page handle its click" decision).
  //   1st click  → SELECT the target (turns blue); does NOT open the note.
  //   2nd click  → CONFIRM the selection and open the note.
  // -------------------------------------------------------------------------
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!isPageTarget(target)) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    if (!selected) {
      // FIRST click — select the clicked element (blue), do not open the note.
      currentTarget = target;
      updateOverlay(target);
      selected = true;
      lockX = lastX;
      lockY = lastY;
      hoverOverlay?.classList.add('sfx-pick-locked');
      return;
    }

    // SECOND click — confirm the current selection and open the note.
    const picked = isPageTarget(currentTarget) ? currentTarget : target;
    exitPickMode();
    onElementClick(picked);
  };

  // -------------------------------------------------------------------------
  // mousedown / auxclick — suppressed in pick mode so the page never reacts
  // (focus, text selection, mousedown-initiated navigation, middle-click
  // open-in-new-tab) before the click pick fires. Suppressing mousedown does
  // NOT cancel the subsequent click event, so onClick still runs.
  // -------------------------------------------------------------------------
  const onSuppress = (e: MouseEvent) => {
    if (!isPageTarget(e.target as Element | null)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  // -------------------------------------------------------------------------
  // DOM traversal — move the highlight to a related element without hovering it.
  // Lets the user escape overlay traps (e.g. Bootstrap .stretched-link covering
  // a whole card) by walking the tree: ArrowUp = parent, ArrowDown = first child.
  // A subsequent mousemove re-syncs the highlight to the cursor (devtools-style).
  // -------------------------------------------------------------------------
  const traverse = (toParent: boolean): void => {
    if (currentTarget === null) return;
    const next = toParent
      ? currentTarget.parentElement
      : currentTarget.firstElementChild;
    if (!isPageTarget(next)) return;
    updateOverlay(next);
    currentTarget = next;
    // Select (blue) the traversed element until the cursor deliberately moves away.
    selected = true;
    lockX = lastX;
    lockY = lastY;
    hoverOverlay?.classList.add('sfx-pick-locked');
  };

  // Confirm the currently-highlighted element (cursor target or traversed).
  const pickCurrent = (): void => {
    if (!isPageTarget(currentTarget)) return;
    const picked = currentTarget;
    exitPickMode();
    onElementClick(picked);
  };

  // -------------------------------------------------------------------------
  // keydown — Esc exits; Arrow keys traverse; Enter confirms the highlight.
  // Capture phase + preventDefault so arrows don't scroll the page or trigger
  // page keyboard shortcuts while picking.
  // -------------------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      exitPickMode();
      onEsc();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      traverse(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      traverse(false);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      pickCurrent();
    }
  };

  // Register listeners + store cleanup refs. click/mousedown/auxclick use the
  // CAPTURE phase so suppression beats page (and framework) handlers.
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onSuppress, true);
  document.addEventListener('auxclick', onSuppress, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  _cleanupFns = [
    () => document.removeEventListener('mousemove', onMouseMove),
    () => document.removeEventListener('mousedown', onSuppress, true),
    () => document.removeEventListener('auxclick', onSuppress, true),
    () => document.removeEventListener('click', onClick, true),
    () => document.removeEventListener('keydown', onKeyDown, true),
  ];
}

/**
 * Exit pick mode: remove overlay from DOM, remove event listeners,
 * remove crosshair cursor class from :host, reset all state.
 * Idempotent — safe to call when not active.
 */
export function exitPickMode(): void {
  // Run all cleanup functions (removeEventListener)
  for (const fn of _cleanupFns) {
    fn();
  }
  _cleanupFns = [];

  // Remove overlay from DOM
  if (hoverOverlay !== null && hoverOverlay.parentElement) {
    hoverOverlay.parentElement.removeChild(hoverOverlay);
  }

  // Remove hints panel from DOM (only present when showHints was set)
  if (hintsPanel !== null && hintsPanel.parentElement) {
    hintsPanel.parentElement.removeChild(hintsPanel);
  }

  // Remove crosshair cursor class from :host
  if (_container !== null) {
    _container.classList.remove('sfx-pick-mode');
  }

  // Reset module state
  hoverOverlay = null;
  hoverLabel = null;
  hintsPanel = null;
  currentTarget = null;
  _container = null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Update the hover-highlight overlay to cover the given element.
 * Position is fixed (follows viewport coords from getBoundingClientRect).
 * Label text is set via textContent only — INVARIANT C (T-05-05).
 */
function updateOverlay(target: Element): void {
  if (hoverOverlay === null || hoverLabel === null) return;

  const rect = target.getBoundingClientRect();

  // Position overlay at element's viewport-relative rect
  hoverOverlay.style.left = `${rect.left}px`;
  hoverOverlay.style.top = `${rect.top}px`;
  hoverOverlay.style.width = `${rect.width}px`;
  hoverOverlay.style.height = `${rect.height}px`;
  hoverOverlay.style.display = 'block';

  // Build label text: prefix (tag / tag#id / tag.class, ≤20 chars) + ' · WxH'
  // All via textContent — INVARIANT C (no innerHTML with page-derived strings)
  const prefix = buildLabelPrefix(target);
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  hoverLabel.textContent = `${prefix} · ${w}×${h}`;

  // Flip label above/below: default is above (bottom: calc(100% + 4px));
  // when element is within 24px of the bottom viewport edge, flip to below.
  const nearBottom = rect.bottom > window.innerHeight - 24;
  if (nearBottom) {
    hoverLabel.style.bottom = '';
    hoverLabel.style.top = 'calc(100% + 4px)';
  } else {
    hoverLabel.style.top = '';
    hoverLabel.style.bottom = 'calc(100% + 4px)';
  }
}

/**
 * Build the label prefix from an element: tag / tag#id / tag.class
 * Capped at ≤ 20 chars. All strings come from the element's own properties
 * (tagName, id, classList) — used only as textContent, never innerHTML.
 */
function buildLabelPrefix(el: Element): string {
  const MAX = 20;
  const tag = el.tagName.toLowerCase();

  // Prefer id if present
  if (el.id) {
    const candidate = `${tag}#${el.id}`;
    return candidate.length <= MAX ? candidate : candidate.slice(0, MAX);
  }

  // Prefer first class (skip empty or hashed utility class names)
  if (el.classList.length > 0) {
    const cls = el.classList[0];
    // Skip Tailwind/CSS-module style class names (very short or contain dash-digits)
    if (cls && cls.length > 1 && !/^[a-z]+-[0-9]/.test(cls)) {
      const candidate = `${tag}.${cls}`;
      return candidate.length <= MAX ? candidate : candidate.slice(0, MAX);
    }
  }

  // Fallback: just the tag name
  return tag.length <= MAX ? tag : tag.slice(0, MAX);
}
