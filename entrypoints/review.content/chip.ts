/**
 * stickyfix connection chip — shadow-root UI
 *
 * Responsibilities:
 *  - Query SFX_GET_ROUTE on mount; render routed label or one-time dropdown
 *  - Draggable via pointer events + viewport-clamped (EXT-11)
 *  - Stub Send: §9.1 free-note payload → SFX_SEND_ANNOTATION → inline confirm/error
 *  - Exit (×): unmounts UI + sends SFX_EXIT_REVIEW to SW
 *
 * Security invariants:
 *  - NEVER fetches 127.0.0.1 / localhost directly — ALL HTTP goes through
 *    chrome.runtime.sendMessage to the SW relay (EXT-05 / T-03-04)
 *  - DOM built with createElement/textContent only — no innerHTML with
 *    external strings (XSS surface — Pattern 9)
 *  - sfx-* / stickyfix namespace (clean-room gate)
 */

import { SFX_MSG, SFX_SET_ROUTE, SFX_GET_TAB_ID } from '../../lib/types.js';
import type { HostEntry, AnnotationPayload } from '../../lib/types.js';
import { enterPickMode, exitPickMode } from './picker.js';
import { sfxPrefs } from '../../lib/storage.js';

// ---------------------------------------------------------------------------
// Types (local to this module)
// ---------------------------------------------------------------------------

interface RouteOkResponse {
  ok: true;
  host: HostEntry;
  mapped?: boolean;
}

interface RouteErrResponse {
  ok: false;
  error: string;
  /** WR-03: structured discriminator for the unmapped state */
  reason?: 'unmapped';
  origin?: string;
}

type RouteResponse = RouteOkResponse | RouteErrResponse;

interface AnnotationOkResponse {
  ok: true;
  file: string;
  /** zero-padded string serial from the host (e.g. "0001") */
  serial: string;
}

interface AnnotationErrResponse {
  ok: false;
  error?: string;
  /** D-04: origin has no folder/host mapping — open the OS folder dialog */
  reason?: 'needs-folder';
  origin?: string;
}

type AnnotationResponse = AnnotationOkResponse | AnnotationErrResponse;

/** SW response for SFX_PICK_FOLDER (background.handlePickFolder). */
type PickFolderResponse =
  | { ok: true; folder: string }
  | { ok: false; error: string; cancelled?: boolean };

interface SetRouteOkResponse {
  ok: true;
  host: HostEntry;
}

interface SetRouteErrResponse {
  ok: false;
  error: string;
}

type SetRouteResponse = SetRouteOkResponse | SetRouteErrResponse;

// ---------------------------------------------------------------------------
// Teardown registry — chip.ts exposes teardownChip(container) so index.ts
// can call it from onRemove without coupling to DOM internals.
// ---------------------------------------------------------------------------

const teardownMap = new WeakMap<HTMLElement, () => void>();

// refreshMap — chip.ts exposes refreshChipRoute(container) so index.ts can
// re-resolve the route (e.g. after a card Send established a folder mapping).
const refreshMap = new WeakMap<HTMLElement, () => void>();

// ---------------------------------------------------------------------------
// mountChip — entry point called from index.ts onMount
// ---------------------------------------------------------------------------

/**
 * Mount the connection chip inside the shadow-root container.
 * All DOM is built via createElement/textContent — no innerHTML.
 *
 * @param container      The shadow-root mounting point provided by createShadowRootUi
 * @param unmountFn      Callback to fully remove the shadow-root UI (Exit button)
 * @param onPickerClick  Optional callback invoked when the user clicks a page element
 *                       in pick mode (wired by index.ts in Plan 03; default: no-op).
 *                       Receives the clicked element AND a `reArm` callback that
 *                       re-enters pick mode — the element card calls it after a
 *                       successful Send for sticky-picker UX.
 */
export function mountChip(
  container: HTMLElement,
  unmountFn: () => void,
  onPickerClick?: (el: Element, reArm: () => void) => void,
  onTogglePanel?: () => void
): void {
  // WR-03: feedbackTimer scoped per-instance (not module-level) so re-injection
  // cannot cancel a detached chip's auto-dismiss timer.
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  /** Show inline feedback on this chip's feedback span. Auto-hides after 1.5s on success. */
  function showFeedback(feedbackEl: HTMLSpanElement, msg: string, isError: boolean): void {
    if (feedbackTimer !== null) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }
    feedbackEl.textContent = msg;
    feedbackEl.className = isError
      ? 'sfx-chip-feedback sfx-feedback-error'
      : 'sfx-chip-feedback';
    feedbackEl.style.display = '';
    if (!isError) {
      feedbackTimer = setTimeout(() => {
        feedbackEl.style.display = 'none';
        feedbackEl.textContent = '';
        feedbackTimer = null;
      }, 1500);
    }
  }

  // Build the outer chip div
  const chip = document.createElement('div');
  chip.id = 'sfx-chip';
  container.appendChild(chip);

  // Status dot
  const dot = document.createElement('span');
  dot.className = 'sfx-status-dot';
  chip.appendChild(dot);

  // Label placeholder (will be replaced after route resolves)
  const label = document.createElement('span');
  label.className = 'sfx-chip-label';
  label.textContent = 'stickyfix…';
  chip.appendChild(label);

  // Feedback span (inline confirm / error — initially hidden)
  const feedback = document.createElement('span');
  feedback.className = 'sfx-chip-feedback';
  feedback.style.display = 'none';
  chip.appendChild(feedback);

  // Send button (stub relay proof)
  const sendBtn = document.createElement('button');
  sendBtn.className = 'sfx-chip-btn sfx-btn-send';
  sendBtn.textContent = 'Send';
  sendBtn.setAttribute('aria-label', 'Send stub annotation (relay proof)');
  chip.appendChild(sendBtn);

  // Picker button — 🎯 element pick mode toggle (ELEM-01 / UI-SPEC §1)
  const pickerBtn = document.createElement('button');
  pickerBtn.className = 'sfx-chip-btn sfx-picker-btn';
  pickerBtn.textContent = '🎯';
  pickerBtn.setAttribute('aria-label', 'Pick element');
  pickerBtn.setAttribute('aria-pressed', 'false');
  chip.appendChild(pickerBtn);

  // Notes panel toggle button (Phase C)
  const panelBtn = document.createElement('button');
  panelBtn.className = 'sfx-chip-btn sfx-panel-btn';
  panelBtn.textContent = '📋';
  panelBtn.setAttribute('aria-label', 'Toggle notes panel');
  panelBtn.setAttribute('aria-pressed', 'false');
  panelBtn.addEventListener('click', () => {
    onTogglePanel?.();
  });
  chip.appendChild(panelBtn);

  // Track picker active state
  let pickerActive = false;

  /** Reset picker button to resting state (aria + visual). */
  function deactivatePicker(): void {
    pickerActive = false;
    pickerBtn.setAttribute('aria-pressed', 'false');
    pickerBtn.setAttribute('aria-label', 'Pick element');
    pickerBtn.classList.remove('sfx-active');
  }

  /** Activate picker button (aria + visual). */
  function activatePicker(): void {
    pickerActive = true;
    pickerBtn.setAttribute('aria-pressed', 'true');
    pickerBtn.setAttribute('aria-label', 'Cancel element pick (Esc)');
    pickerBtn.classList.add('sfx-active');
  }

  /** Enter pick mode with the standard callbacks. Reusable so the element card
   *  can re-arm it after a successful Send / Discard (sticky-picker UX).
   *
   *  Reads the showHints pref first (default ON when missing), then enters pick
   *  mode in the .then. The async read does not break re-arm: activatePicker()
   *  runs synchronously so the button reflects active state immediately, and
   *  enterPickMode is idempotent (exits first if already active). */
  function startPick(): void {
    activatePicker();
    sfxPrefs
      .getValue()
      .then(prefs => ({ showHints: prefs.showHints !== false }))
      .catch(() => ({ showHints: true })) // default ON if the read fails
      .then(opts => {
        enterPickMode(
          container,
          // onElementClick: pick mode already exited inside picker.ts on confirm;
          // reset button visual + invoke injected onPickerClick callback (Plan 03).
          // The 2nd arg re-enters pick mode — the element card calls it after Send/Discard.
          (el: Element) => {
            deactivatePicker();
            onPickerClick?.(el, () => startPick());
          },
          // onEsc: reset button visual + return focus to picker button (UI-SPEC §Focus)
          () => {
            deactivatePicker();
            pickerBtn.focus();
          },
          opts
        );
      });
  }

  pickerBtn.addEventListener('click', () => {
    if (pickerActive) {
      // Toggle off — cancel pick mode
      deactivatePicker();
      exitPickMode();
    } else {
      startPick();
    }
  });

  // Exit button
  const exitBtn = document.createElement('button');
  exitBtn.className = 'sfx-chip-btn sfx-btn-exit';
  exitBtn.textContent = '×';
  exitBtn.setAttribute('aria-label', 'Exit Review Mode');
  chip.appendChild(exitBtn);

  // Make the chip draggable AFTER all structural children are appended so
  // getBoundingClientRect() reflects real content dimensions (CR-03).
  makeDraggable(chip);

  // ---------------------------------------------------------------------------
  // Resolve route on mount
  // ---------------------------------------------------------------------------

  // Get current tab id (content script can ask the SW via an empty message,
  // but chrome.runtime.sendMessage in a content script returns the sender's
  // tabId in the response via the SW). We use a dedicated helper.
  // resolveAndRender — re-runnable route resolution. Called once on mount and
  // again via refreshChipRoute(container) after a folder mapping is established
  // (e.g. a card Send picked a folder). A fresh GET_ROUTE returns the mapped
  // host (background.handleGetRoute is folder-aware), so the chip swaps from the
  // dropdown/needs-folder state to the "→ name · <folder>" routed label.
  function resolveAndRender(): void {
    getTabId().then(tabId => {
      const origin = window.location.origin;

      chrome.runtime.sendMessage({
        type: SFX_MSG.GET_ROUTE,
        tabId,
        origin,
      }, (resp: RouteResponse | undefined) => {
        // WR-02: guard resp against undefined (SW handler returned without sendResponse)
        if (chrome.runtime.lastError || !resp) {
          label.textContent = 'SW error';
          dot.classList.add('sfx-dot-error');
          return;
        }

        if (resp.ok) {
          // Mapped — show routed label + wire D-09 re-map affordance
          renderRoutedLabel(label, dot, resp.host, chip, feedback, sendBtn, tabId, origin, showFeedback);
          wireSendButton(sendBtn, feedback, tabId, resp.host, showFeedback, resolveAndRender);
        } else if (resp.reason === 'unmapped') {
          // Step 4 — one-time dropdown (EXT-07/EXT-08)
          renderDropdown(chip, label, dot, feedback, sendBtn, tabId, origin, showFeedback, resolveAndRender);
        } else {
          label.textContent = resp.error ?? 'Route error';
          dot.classList.add('sfx-dot-error');
        }
      });
    }).catch(() => {
      label.textContent = 'Tab error';
      dot.classList.add('sfx-dot-error');
    });
  }

  resolveAndRender();
  refreshMap.set(container, resolveAndRender);

  // ---------------------------------------------------------------------------
  // Exit button handler
  // ---------------------------------------------------------------------------

  exitBtn.addEventListener('click', () => {
    // Tell SW to clear reviewMode pref — best effort
    getTabId().then(tabId => {
      chrome.runtime.sendMessage({ type: SFX_MSG.EXIT_REVIEW, tabId }, () => {
        // Ignore lastError — we're unmounting regardless
        void chrome.runtime.lastError;
      });
      unmountFn();
    }).catch(() => {
      unmountFn(); // unmount even if tabId lookup fails
    });
  });

  // ---------------------------------------------------------------------------
  // Register teardown (for external teardownChip() call)
  // ---------------------------------------------------------------------------

  teardownMap.set(container, () => {
    // Also exit pick mode if active so it never outlives the UI
    exitPickMode();
    // Drop the refresh closure so a torn-down chip cannot be re-rendered
    refreshMap.delete(container);
    // Remove chip from container — shadow root cleanup
    if (chip.parentElement) {
      chip.parentElement.removeChild(chip);
    }
  });
}

// ---------------------------------------------------------------------------
// refreshChipRoute — called from index.ts after a card Send that may have
// established a folder mapping. Re-resolves the route so the chip self-updates
// from the dropdown/needs-folder state to the "→ name · <folder>" label.
// No-op if the chip was torn down (closure removed from refreshMap).
// ---------------------------------------------------------------------------

export function refreshChipRoute(container: HTMLElement): void {
  const fn = refreshMap.get(container);
  if (fn) fn();
}

// ---------------------------------------------------------------------------
// teardownChip — called from index.ts onRemove
// ---------------------------------------------------------------------------

export function teardownChip(container: HTMLElement): void {
  const fn = teardownMap.get(container);
  if (fn) fn();
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/**
 * Render the "→ name · notesDir" label for a mapped host.
 *
 * D-09 re-map affordance: sets label.onclick = () => renderDropdown(...)
 * using .onclick assignment (NOT addEventListener) to prevent listener
 * stacking on re-renders (Shared Pattern 4 / UI-SPEC §4).
 */
function renderRoutedLabel(
  label: HTMLSpanElement,
  dot: HTMLSpanElement,
  host: HostEntry,
  chip: HTMLDivElement,
  feedback: HTMLSpanElement,
  sendBtn: HTMLButtonElement,
  tabId: number,
  origin: string,
  showFeedbackFn: (el: HTMLSpanElement, msg: string, isError: boolean) => void
): void {
  // Remove any leftover one-time dropdown. resolveAndRender() (the refresh path
  // after a folder pick) lands here without going through renderDropdown's change
  // handler, so the <select> injected while unmapped would otherwise persist —
  // the chip would show the routed label AND the stale "select project" dropdown,
  // reading to the user as "nothing changed after I picked a folder."
  const staleSelect = chip.querySelector('.sfx-chip-dropdown');
  if (staleSelect) staleSelect.remove();

  // textContent only — no innerHTML (Pattern 9)
  label.textContent = `→ ${host.name} · ${host.notesDir}`;
  dot.classList.remove('sfx-dot-error');

  // D-09: .onclick = assignment (idempotent — prevents stacking on re-renders)
  label.onclick = () => {
    renderDropdown(chip, label, dot, feedback, sendBtn, tabId, origin, showFeedbackFn);
  };
  // UI-SPEC §4: cursor + tooltip signal clickability
  label.style.cursor = 'pointer';
  label.title = 'Change project';
  label.classList.add('sfx-label-routed');
}

/**
 * Render the one-time host selection dropdown when the origin is unmapped.
 * After selection: persists via SFX_SET_ROUTE, then swaps to the label view.
 * The origin is never re-asked after this (EXT-07/EXT-08).
 */
function renderDropdown(
  chip: HTMLDivElement,
  label: HTMLSpanElement,
  dot: HTMLSpanElement,
  feedback: HTMLSpanElement,
  sendBtn: HTMLButtonElement,
  tabId: number,
  origin: string,
  showFeedbackFn: (el: HTMLSpanElement, msg: string, isError: boolean) => void,
  onRouteMaybeChanged?: () => void
): void {
  // Update label to explain what's needed. D-04: Send is ALSO live here — the
  // first Send on an unmapped origin opens the OS folder dialog (needs-folder),
  // while the dropdown remains the alternative (route to an existing host).
  label.textContent = 'Pick project / Send to choose a folder:';

  // Create the select dropdown
  const select = document.createElement('select');
  select.className = 'sfx-chip-dropdown';
  select.setAttribute('aria-label', 'Select project for this origin');

  // Default option
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '— select project —';
  select.appendChild(defaultOpt);

  // Insert the select immediately; populate after the SW responds.
  chip.insertBefore(select, sendBtn);

  // Ask the SW (the owner of the registry) for the current host names. The SW
  // refreshes discovery, reconciles, and returns the full list of known host
  // names — the content script never reads chrome.storage directly (the SW owns
  // all state, and the raw storage key may differ from WXT's typed wrapper).
  chrome.runtime.sendMessage(
    { type: SFX_MSG.REFRESH_HOSTS },
    (refreshResp: { ok: boolean; count: number; hosts?: string[] } | undefined) => {
      if (chrome.runtime.lastError || !refreshResp?.ok) {
        const errOpt = document.createElement('option');
        errOpt.value = '';
        errOpt.textContent = 'No hosts found — start one first';
        select.appendChild(errOpt);
        return;
      }

      const hostNames = refreshResp.hosts ?? [];
      if (hostNames.length === 0) {
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = 'No hosts found — start one first';
        select.appendChild(emptyOpt);
        return;
      }

      for (const name of hostNames) {
        const opt = document.createElement('option');
        opt.value = name; // safe — host name is controlled by our app
        opt.textContent = name; // textContent, not innerHTML
        select.appendChild(opt);
      }
    }
  );

  // Handle selection
  select.addEventListener('change', () => {
    const hostName = select.value;
    if (!hostName) return;

    // Persist origin → hostName via SW (EXT-07/EXT-08)
    chrome.runtime.sendMessage(
      { type: SFX_SET_ROUTE, tabId, hostName },
      (resp: SetRouteResponse | undefined) => {
        // WR-02: guard resp against undefined
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          showFeedbackFn(feedback, `Set route failed: ${resp && !resp.ok ? resp.error : 'unknown'}`, true);
          return;
        }

        // Remove dropdown
        if (select.parentElement) {
          select.parentElement.removeChild(select);
        }

        // Render the mapped label + wire D-09 re-map affordance
        renderRoutedLabel(label, dot, resp.host, chip, feedback, sendBtn, tabId, origin, showFeedbackFn);

        // Wire the Send button now that we have a host
        wireSendButton(sendBtn, feedback, tabId, resp.host, showFeedbackFn, onRouteMaybeChanged);
      }
    );
  });

  // D-04: keep Send LIVE while unmapped. wireSendButton ignores the host arg
  // (the SW resolves routing from the origin), so a click drives SEND_ANNOTATION
  // → needs-folder → OS folder dialog → auto-retry. A cancelled dialog surfaces
  // a visible toast (REL-01). The dropdown above stays available for the
  // existing origin→host path.
  wireSendButton(
    sendBtn,
    feedback,
    tabId,
    { name: '', port: 0, origins: [], notesDir: '', token: null },
    showFeedbackFn,
    onRouteMaybeChanged
  );
  sendBtn.setAttribute('title', 'Send to choose a folder for this site');

  void origin; // consumed via closure (tabId/origin used in SET_ROUTE above)
}

// ---------------------------------------------------------------------------
// Send button
// ---------------------------------------------------------------------------

/**
 * Wire the stub Send button to the SFX_SEND_ANNOTATION relay.
 * Builds a minimal valid §9.1 free-note payload (Pattern 10 / D-09).
 * Shows inline "sent ✓ <file>" (~1.5s) or inline error — NEVER silent (REL-01).
 */
function wireSendButton(
  sendBtn: HTMLButtonElement,
  feedback: HTMLSpanElement,
  tabId: number,
  _host: HostEntry,
  showFeedbackFn: (el: HTMLSpanElement, msg: string, isError: boolean) => void,
  onRouteMaybeChanged?: () => void
): void {
  sendBtn.disabled = false;
  sendBtn.removeAttribute('title');

  /**
   * Send the annotation once. `allowRetry` gates the single D-04 auto-retry:
   * the FIRST send passes true; the retry (after a folder pick) passes false so
   * a still-unmapped origin cannot loop the dialog forever.
   *
   * REL-01: every terminal path surfaces a visible toast — a note is NEVER
   * silently dropped (the cancel path included).
   */
  function sendOnce(payload: AnnotationPayload, allowRetry: boolean): void {
    sendBtn.disabled = true;

    // REL-01: sendMessage can throw synchronously if the extension is disabled mid-flight — never silent
    try {
      chrome.runtime.sendMessage(
        { type: SFX_MSG.SEND_ANNOTATION, tabId, payload },
        (resp: AnnotationResponse | undefined) => {
          // WR-02: guard resp against undefined
          if (chrome.runtime.lastError || !resp) {
            sendBtn.disabled = false;
            showFeedbackFn(feedback, 'SW error: ' + (chrome.runtime.lastError?.message ?? 'no response'), true);
            return;
          }
          if (resp.ok) {
            sendBtn.disabled = false;
            showFeedbackFn(feedback, `sent ✓ ${resp.file}`, false);
            // D-04: a Send from the dropdown/needs-folder state may have just
            // established a folder mapping — re-resolve the route so the chip
            // self-updates from dropdown → "→ name · <folder>" label.
            onRouteMaybeChanged?.();
            return;
          }
          // D-04: origin has no mapping — open the OS folder dialog, then retry once.
          if (resp.reason === 'needs-folder' && allowRetry) {
            showFeedbackFn(feedback, 'Choose a folder for this site…', false);
            try {
              chrome.runtime.sendMessage(
                { type: SFX_MSG.PICK_FOLDER, tabId },
                (pick: PickFolderResponse | undefined) => {
                  if (chrome.runtime.lastError || !pick) {
                    sendBtn.disabled = false;
                    // REL-01: never silent — surface the dialog/SW failure
                    showFeedbackFn(feedback, 'No folder chosen — note not saved. Drop again to pick one.', true);
                    return;
                  }
                  if (pick.ok) {
                    // Brief confirmation, then auto-retry the SAME payload ONCE.
                    showFeedbackFn(feedback, `Saving notes to ${pick.folder}`, false);
                    sendOnce(payload, false);
                  } else if (pick.cancelled) {
                    // User cancelled / invalid pick — visible toast, no silent drop (REL-01).
                    sendBtn.disabled = false;
                    showFeedbackFn(feedback, 'No folder chosen — note not saved. Drop again to pick one.', true);
                  } else {
                    // Real host/native error — surface it (host not running, etc.) (REL-01).
                    sendBtn.disabled = false;
                    showFeedbackFn(feedback, pick.error || 'Folder picker failed — note not saved.', true);
                  }
                }
              );
            } catch (e) {
              sendBtn.disabled = false;
              showFeedbackFn(feedback, 'Extension error: ' + (e instanceof Error ? e.message : String(e)), true);
            }
            return;
          }
          // Any other error (or retry exhausted) — show it inline (REL-01).
          sendBtn.disabled = false;
          showFeedbackFn(feedback, resp.error ?? 'Send failed', true);
        }
      );
    } catch (e) {
      sendBtn.disabled = false;
      showFeedbackFn(feedback, 'Extension error: ' + (e instanceof Error ? e.message : String(e)), true);
    }
  }

  // .onclick = assignment (idempotent — prevents listener stacking on D-09 re-map; CR-01)
  sendBtn.onclick = () => {
    // §9.1 minimal valid free-note payload (D-09)
    const payload: AnnotationPayload = {
      mode: 'free',
      comment: 'stickyfix relay proof',
      page: {
        url: window.location.href,
        title: document.title,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      screenshots: [],
    };

    sendOnce(payload, true);
  };
}

// ---------------------------------------------------------------------------
// Drag + viewport clamp (Pattern 9 — EXT-11)
// ---------------------------------------------------------------------------

/**
 * Make an element draggable anywhere with pointer events.
 * Position is clamped to [0, innerWidth-offsetWidth] × [0, innerHeight-offsetHeight].
 * Position is ephemeral — not persisted (UI-SPEC).
 */
function makeDraggable(el: HTMLElement): void {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  // Initial position via CSS (top:16px right:16px set in styles.css)
  // We switch to left+top coordinates on first drag.
  el.style.position = 'fixed';

  el.addEventListener('pointerdown', (e: PointerEvent) => {
    // Only primary button (left click) starts drag
    if (e.button !== 0) return;

    // Yield to interactive controls: if the gesture starts on a button, the
    // project <select>, or an input, do NOT start a drag. Capturing the pointer
    // and calling preventDefault() here would suppress the control's native
    // action (a <select> would never open; buttons could be swallowed). Only
    // the chip's own chrome (dot/label/background) initiates a drag.
    const target = e.target as HTMLElement | null;
    // FIX 2: also yield to the routed label (D-09 re-map click) and the project
    // dropdown so their own click/change handlers are not suppressed by drag capture.
    if (target && target.closest('button, select, input, option, a, textarea, .sfx-label-routed, .sfx-chip-dropdown')) {
      return;
    }

    el.setPointerCapture(e.pointerId);
    isDragging = true;

    const rect = el.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;

    // Switch to left+top positioning (remove right which conflicts)
    el.style.right = 'auto';
    el.style.left = `${origLeft}px`;
    el.style.top = `${origTop}px`;

    e.preventDefault();
  });

  el.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging || !el.hasPointerCapture(e.pointerId)) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    // CR-03: recompute element dimensions at every move — chip width/height can
    // grow after label text and dropdown are injected into the chip post-mount.
    // Guard against 0 (not-yet-laid-out) by falling back to getBoundingClientRect.
    const w = el.offsetWidth || el.getBoundingClientRect().width || 0;
    const h = el.offsetHeight || el.getBoundingClientRect().height || 0;

    // Clamp to viewport boundaries (EXT-11)
    const newLeft = Math.max(
      0,
      Math.min(Math.max(0, window.innerWidth - w), origLeft + dx)
    );
    const newTop = Math.max(
      0,
      Math.min(Math.max(0, window.innerHeight - h), origTop + dy)
    );

    el.style.left = `${newLeft}px`;
    el.style.top = `${newTop}px`;
  });

  el.addEventListener('pointerup', (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    el.releasePointerCapture(e.pointerId);
  });

  el.addEventListener('pointercancel', (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
// Tab ID helper
// ---------------------------------------------------------------------------

/**
 * Get the current tab's ID by sending SFX_GET_TAB_ID to the SW.
 * Content scripts cannot call chrome.tabs.getCurrent(); this is the standard
 * workaround — the SW reads sender.tab.id from the message and echoes it.
 *
 * Exported so index.ts can resolve the tabId once and share it with
 * mountFab / openCard without duplicating this implementation (04-02 / Task 3).
 */
export async function getTabId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: SFX_GET_TAB_ID }, (resp: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const r = resp as { tabId?: number } | null;
      if (r && typeof r.tabId === 'number') {
        resolve(r.tabId);
      } else {
        reject(new Error('SW did not return tabId'));
      }
    });
  });
}
