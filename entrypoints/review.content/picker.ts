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
 */
export function enterPickMode(
  container: HTMLElement,
  onElementClick: (el: Element) => void,
  onEsc: () => void
): void {
  // Idempotent — if already active, exit first then re-enter
  if (hoverOverlay !== null) {
    exitPickMode();
  }

  _container = container;

  // -------------------------------------------------------------------------
  // Build hover-highlight overlay via createElement/textContent — INVARIANT C
  // -------------------------------------------------------------------------
  const overlay = document.createElement('div');
  overlay.className = 'sfx-hover-highlight';
  hoverOverlay = overlay;

  const label = document.createElement('span');
  label.className = 'sfx-hover-label';
  overlay.appendChild(label);
  hoverLabel = label;

  container.appendChild(overlay);

  // Apply crosshair cursor to :host by toggling a class on the shadow host
  // (:host(.sfx-pick-mode) { cursor: crosshair } in styles.css)
  container.classList.add('sfx-pick-mode');

  // -------------------------------------------------------------------------
  // mousemove — rAF-throttled; evaluates BOTH guards SYNCHRONOUSLY before rAF
  // -------------------------------------------------------------------------
  let rafPending = false;

  const onMouseMove = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;

    // Guard 1 (synchronous): shadow-host guard — skip sfx-internal targets (T-05-06 / Pitfall 5)
    if (target === container || container.contains(target)) return;

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
  // click — capture target, exit pick mode, invoke callback
  // -------------------------------------------------------------------------
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;

    // Skip sfx-internal targets (guard mirrors mousemove)
    if (target === container || container.contains(target)) return;

    // UI-SPEC: do NOT call preventDefault/stopPropagation — page handles its own click (T-05-08)
    exitPickMode();
    onElementClick(target);
  };

  // -------------------------------------------------------------------------
  // keydown — Esc exits pick mode
  // -------------------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      exitPickMode();
      onEsc();
    }
  };

  // Register listeners + store cleanup refs
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeyDown);

  _cleanupFns = [
    () => document.removeEventListener('mousemove', onMouseMove),
    () => document.removeEventListener('click', onClick),
    () => document.removeEventListener('keydown', onKeyDown),
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

  // Remove crosshair cursor class from :host
  if (_container !== null) {
    _container.classList.remove('sfx-pick-mode');
  }

  // Reset module state
  hoverOverlay = null;
  hoverLabel = null;
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
