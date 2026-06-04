/**
 * stickyfix post-it card — shadow-root UI
 *
 * Single free-note card: textarea + Send/Cancel + interactjs drag on header.
 * FREE-01: opens on FAB click.
 * FREE-02: only one card active at a time (delegated to card-state.ts).
 * FREE-03: Send POSTs mode:'free' payload via SFX_SEND_ANNOTATION SW relay.
 * FREE-04 / REL-01: showToastFn is called on every result — never silent.
 *
 * Security invariants:
 *  - DOM via createElement/textContent — no innerHTML (INVARIANT C / T-04-03)
 *  - screenshots: [] ALWAYS empty for openCard/free path — D-06 (free notes are text-only)
 *  - openCard / _doSend (free path) MUST NOT import lib/capture.ts (T-04-04 / D-06);
 *    openElementCard / _doElementSend IS the first capture-trio consumer and does import it.
 *  - All host-derived strings (resp.file, resp.error) go through showToastFn
 *    which calls textContent — never innerHTML
 *  - SW is the sole HTTP client (INVARIANT B — sendMessage relay only)
 *  - sfx-* namespace (INVARIANT D)
 */

import interact from 'interactjs';
import { SFX_MSG } from '../../lib/types.js';
import type { AnnotationPayload } from '../../lib/types.js';
import { tryOpenCard, closeCardState } from './card-state.js';
import { captureTab, waitTwoRafs, cropToRect } from '../../lib/capture.js';
import { drawHighlightBox } from '../../lib/highlight-draw.js';
import { buildContextSummary } from '../../lib/element-context.js';
import type { ElementContext } from '../../lib/types.js';
import { enterMarqueeMode } from './marquee.js';
import { mapSendOutcome } from '../../lib/error-toast.js';
import type { SendOutcome } from '../../lib/error-toast.js';
import { exceedsBodyCap } from '../../lib/payload-size.js';
import { renumberThumbnailKinds, nextThumbnailKind } from '../../lib/thumbnail-number.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnnotationOkResponse {
  ok: true;
  file: string;
  serial: string;
}

interface AnnotationErrResponse {
  ok: false;
  error: string;
}

type AnnotationResponse = AnnotationOkResponse | AnnotationErrResponse;

/** Per-card thumbnail entry (CAM-05) */
interface ThumbnailEntry {
  kind: string;   // '+1', '+2', …
  dataUrl: string;
}

// ---------------------------------------------------------------------------
// renderThumbnails — rebuild thumbnail strip via createElement/textContent
// INVARIANT C: no innerHTML; img.src is a data: URI (no XSS risk)
// CAM-05: × button splices entry, renumbers remaining, re-renders
// ---------------------------------------------------------------------------

function renderThumbnails(container: HTMLElement, items: ThumbnailEntry[], baseOffset = 0): void {
  container.replaceChildren();
  items.forEach((t, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'sfx-thumb-wrap';

    const img = document.createElement('img');
    img.className = 'sfx-thumb-img';
    img.src = t.dataUrl;  // data: URI — no XSS risk; no textContent for src
    img.alt = t.kind;     // textContent equivalent for alt

    const del = document.createElement('button');
    del.className = 'sfx-thumb-del';
    del.textContent = '×';  // × MULTIPLICATION SIGN
    del.setAttribute('aria-label', `Remove screenshot ${i + 1}`);
    del.addEventListener('click', () => {
      items.splice(i, 1);
      // Renumber remaining entries using the path-aware offset:
      // free path (baseOffset=0) → +1, +2, …
      // element path (baseOffset=1) → +2, +3, … (reserves +1 for the element auto-highlight)
      renumberThumbnailKinds(items, baseOffset);
      renderThumbnails(container, items, baseOffset);
    });

    wrap.appendChild(img);
    wrap.appendChild(del);
    container.appendChild(wrap);
  });

  // Hide strip when empty (CAM-05: strip is absent when no thumbnails)
  container.style.display = items.length === 0 ? 'none' : 'flex';
}

// ---------------------------------------------------------------------------
// Module-level active card DOM reference (FREE-02 DOM half)
// The DECISION is in card-state.ts (DOM-free); the DOM ref lives here.
// ---------------------------------------------------------------------------

let activeCard: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// openCard — entry point called from index.ts FAB handler
// ---------------------------------------------------------------------------

/**
 * Open the post-it card inside the shadow-root container.
 *
 * FREE-02: if a card is already active, focuses its textarea and returns.
 *
 * @param container    Shadow-root container from createShadowRootUi
 * @param tabId        Current tab ID (resolved once in index.ts)
 * @param onDismiss    Called on Cancel or after Send success
 * @param showToastFn  Adapter: (msg, isError) => void (from index.ts)
 * @param onSent       Optional — called ONLY after a successful Send (not on Cancel/error).
 *                     Used by index.ts to re-fetch pins after a note is written.
 */
export function openCard(
  container: HTMLElement,
  tabId: number,
  onDismiss: () => void,
  showToastFn: (msg: string, isError: boolean) => void,
  onSent?: () => void
): void {
  // FREE-02: single-card guard (DOM-free decision delegated to card-state.ts)
  // WR-04: if card-state says active but activeCard is null (stale flag after
  // CS re-injection without page navigation), reset state and open fresh.
  // This handles the race where onRemove/closeCard ran but the module-level
  // `active` flag was not reset because the module cache was reused.
  const decision = tryOpenCard();
  if (decision === 'focus-existing') {
    if (activeCard === null) {
      // Stale state: state-machine thinks a card is open but DOM says otherwise.
      // Reset and proceed to open a new card.
      closeCardState();
      // tryOpenCard again now that state is clean
      tryOpenCard();
    } else {
      // Genuine existing card — focus its textarea (D-02)
      const existing = activeCard.querySelector<HTMLTextAreaElement>('#sfx-card-textarea');
      existing?.focus();
      return;
    }
  }

  // Card-scoped thumbnails state (CAM-05) — one per open card, not module-level
  const thumbnails: ThumbnailEntry[] = [];

  // Build card via createElement/textContent — INVARIANT C
  const card = document.createElement('div');
  card.id = 'sfx-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Add free note');
  card.setAttribute('aria-modal', 'false');

  // --- Header (drag handle zone) ---
  const header = document.createElement('div');
  header.className = 'sfx-card-header';

  const headerLabel = document.createElement('span');
  headerLabel.className = 'sfx-card-header-label';
  headerLabel.textContent = 'Free note';
  header.appendChild(headerLabel);

  // Camera button — CAM-01 (last child; margin-left:auto pushes it right)
  const camBtn = document.createElement('button');
  camBtn.className = 'sfx-cam-btn';
  camBtn.setAttribute('aria-label', 'Capture region');
  camBtn.textContent = '📷';
  header.appendChild(camBtn);

  card.appendChild(header);

  // --- Body ---
  const body = document.createElement('div');
  body.className = 'sfx-card-body';

  const textarea = document.createElement('textarea');
  textarea.id = 'sfx-card-textarea';
  textarea.setAttribute('placeholder', 'Type your note…');
  body.appendChild(textarea);

  // Thumbnail strip (CAM-05) — hidden until first capture
  const thumbStrip = document.createElement('div');
  thumbStrip.className = 'sfx-thumb-strip';
  thumbStrip.style.display = 'none';
  body.appendChild(thumbStrip);

  card.appendChild(body);

  // --- Footer ---
  const footer = document.createElement('div');
  footer.className = 'sfx-card-footer';

  const sendBtn = document.createElement('button');
  sendBtn.id = 'sfx-card-send';
  sendBtn.textContent = 'Send';
  sendBtn.setAttribute('aria-label', 'Send note (empty)');
  sendBtn.disabled = true; // disabled until textarea has content

  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'sfx-card-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.setAttribute('aria-label', 'Cancel note');

  footer.appendChild(sendBtn);
  footer.appendChild(cancelBtn);
  card.appendChild(footer);

  container.appendChild(card);
  activeCard = card;

  // Focus textarea on next microtask — after DOM insertion
  Promise.resolve().then(() => textarea.focus());

  // -------------------------------------------------------------------------
  // Camera button click — CAM-01/02/03/04 (free-note path)
  // T-06-07 ordering: enterMarqueeMode cleanup() removes scrim FIRST, then
  // the onCapture callback calls setSfxVisibility(false) → waitTwoRafs → captureTab
  // -------------------------------------------------------------------------
  camBtn.addEventListener('click', () => {
    camBtn.disabled = true;  // prevent double-activation while scrim is shown

    enterMarqueeMode(
      container,
      // onCapture — scrim already removed by marquee cleanup() at this point (T-06-07)
      async (rect) => {
        // Build a local setSfxVisibility for the free-note card context
        function setSfxVisibilityFree(visible: boolean): void {
          const display = visible ? '' : 'none';
          if (activeCard) activeCard.style.display = display;
          const chip = container.querySelector<HTMLElement>('#sfx-chip');
          if (chip) chip.style.display = display;
          const fab = container.querySelector<HTMLElement>('#sfx-fab');
          if (fab) fab.style.display = display;
          const hoverOverlay = container.querySelector<HTMLElement>('.sfx-hover-highlight');
          if (hoverOverlay) hoverOverlay.style.display = display;
        }

        setSfxVisibilityFree(false);
        try {
          await waitTwoRafs();
          const dataUrl = await captureTab(tabId);
          const cropped = await cropToRect(dataUrl, rect, window.devicePixelRatio);
          setSfxVisibilityFree(true);
          thumbnails.push({ kind: nextThumbnailKind(thumbnails.length), dataUrl: cropped });
          renderThumbnails(thumbStrip, thumbnails);
        } catch (_capErr) {
          setSfxVisibilityFree(true);
          showToastFn('Screenshot capture failed', true);
        }
        camBtn.disabled = false;
      },
      // onCancel — no capture; just re-enable button
      () => {
        camBtn.disabled = false;
      }
    );
  });

  // -------------------------------------------------------------------------
  // Send disabled rule: disabled when textarea empty (after trim) or in-flight
  // -------------------------------------------------------------------------
  textarea.addEventListener('input', () => {
    const hasText = textarea.value.trim().length > 0;
    sendBtn.disabled = !hasText;
    sendBtn.setAttribute('aria-label', hasText ? 'Send note' : 'Send note (empty)');
  });

  // -------------------------------------------------------------------------
  // Keyboard: Esc → cancel; Ctrl+Enter (or Cmd+Enter) → send if enabled
  // -------------------------------------------------------------------------
  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      _doClose(onDismiss);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!sendBtn.disabled) {
        _doSend(textarea, sendBtn, cancelBtn, tabId, thumbnails, onDismiss, showToastFn, onSent);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Cancel button
  // -------------------------------------------------------------------------
  cancelBtn.addEventListener('click', () => {
    _doClose(onDismiss);
  });

  // -------------------------------------------------------------------------
  // Send button — relay pattern copied from chip.ts wireSendButton (lines 336-373)
  // -------------------------------------------------------------------------
  sendBtn.addEventListener('click', () => {
    _doSend(textarea, sendBtn, cancelBtn, tabId, thumbnails, onDismiss, showToastFn, onSent);
  });

  // -------------------------------------------------------------------------
  // Drag: interactjs on card, allowFrom header only (UI-SPEC §2)
  // Mirrors fab.ts approach — direct element ref, NOT CSS selector (Pitfall 2)
  // -------------------------------------------------------------------------
  let cx = 0;
  let cy = 0;

  try {
    interact(card).draggable({
      inertia: false,
      allowFrom: '.sfx-card-header',
      modifiers: [
        // FIX 4: 'window' is treated as a CSS selector → null → no clamping.
        // Use a function that returns the current viewport rect as the restriction.
        interact.modifiers.restrictRect({
          restriction: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }),
          endOnly: false,
        }),
      ],
      listeners: {
        start(event: Interact.DragEvent) {
          const el = event.target as HTMLElement;
          const style = window.getComputedStyle(el);
          const transform = style.transform;
          if (transform && transform !== 'none') {
            const matrix = new DOMMatrixReadOnly(transform);
            cx = matrix.m41;
            cy = matrix.m42;
          } else {
            cx = 0;
            cy = 0;
          }
        },
        move(event: Interact.DragEvent) {
          cx += event.dx;
          cy += event.dy;
          (event.target as HTMLElement).style.transform = `translate(${cx}px, ${cy}px)`;
        },
      },
    });
  } catch (_e) {
    // Fallback: header-restricted pointer-events drag
    _applyHeaderDrag(card, header);
  }
}

// ---------------------------------------------------------------------------
// closeCard — exported so index.ts can tear down on onRemove
// ---------------------------------------------------------------------------

/**
 * Remove the active card from the DOM and reset card-state.
 * Safe to call when no card is active.
 */
export function closeCard(): void {
  if (activeCard) {
    activeCard.remove();
    activeCard = null;
  }
  closeCardState();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _doClose(onDismiss: () => void): void {
  closeCard();
  onDismiss();
}

/**
 * Execute the Send relay — copied from chip.ts wireSendButton (lines 336-373),
 * replacing the stub comment with textarea.value.trim().
 *
 * CAM-06: thumbnails (region captures) are mapped into screenshots[].
 * Free notes with no captures: thumbnails = [] → screenshots = [].
 *
 * @param onSent  Optional — called ONLY on successful Send (not cancel/error).
 *                Used by index.ts to re-fetch pins after a note is written (Phase 6).
 */
function _doSend(
  textarea: HTMLTextAreaElement,
  sendBtn: HTMLButtonElement,
  cancelBtn: HTMLButtonElement,
  tabId: number,
  thumbnails: ThumbnailEntry[],
  onDismiss: () => void,
  showToastFn: (msg: string, isError: boolean) => void,
  onSent?: () => void
): void {
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  cancelBtn.disabled = true;
  textarea.readOnly = true;

  // §9.1 free-note payload — CAM-06: map thumbnails into screenshots
  const payload: AnnotationPayload = {
    mode: 'free',
    comment: textarea.value.trim(),
    page: {
      url: window.location.href,
      title: document.title,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    screenshots: thumbnails.map(t => ({ kind: t.kind, mime: 'image/png' as const, dataUrl: t.dataUrl })),
  };

  // D-04: pre-flight encoded-size guard — block oversize payloads before SW round-trip
  if (exceedsBodyCap(JSON.stringify(payload))) {
    showToastFn('Screenshot too large to send (over 12 MB) — remove a capture and retry', true);
    sendBtn.textContent = 'Send';
    cancelBtn.disabled = false;
    textarea.readOnly = false;
    const hasText = textarea.value.trim().length > 0;
    sendBtn.disabled = !hasText;
    return;
  }

  // SW relay — mirrors chip.ts wireSendButton exactly (INVARIANT B: no direct fetch)
  // REL-01: sendMessage can throw synchronously if the extension is disabled mid-flight — never silent
  try {
    chrome.runtime.sendMessage(
      { type: SFX_MSG.SEND_ANNOTATION, tabId, payload },
      (resp: AnnotationResponse | undefined) => {
        // WR-02: guard both lastError AND resp — never silent (REL-01)
        if (chrome.runtime.lastError || !resp) {
          const outcome: SendOutcome = { kind: 'channel-dead', lastErrorMessage: chrome.runtime.lastError?.message };
          const spec = mapSendOutcome(outcome);
          showToastFn(spec.message, spec.isError);
          // Restore controls so user can retry
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send';
          cancelBtn.disabled = false;
          textarea.readOnly = false;
          return;
        }

        if (resp.ok) {
          // resp.file is the exact host-returned filename — never client-reconstructed
          const outcome: SendOutcome = { kind: 'ok', file: resp.file };
          const spec = mapSendOutcome(outcome);
          showToastFn(spec.message, spec.isError);
          _doClose(onDismiss);
          // Phase 6: notify after-Send hook (pin re-fetch) — called AFTER dismiss
          onSent?.();
        } else {
          // Error: card stays open; restore controls (user can retry)
          const outcome: SendOutcome = { kind: 'relay-error', error: resp.error };
          const spec = mapSendOutcome(outcome);
          showToastFn(spec.message, spec.isError);
          sendBtn.textContent = 'Send';
          cancelBtn.disabled = false;
          textarea.readOnly = false;
          // Re-apply disabled rule based on current textarea content (WR-02: removed
          // the preceding sendBtn.disabled=false which was immediately overwritten here)
          const hasText = textarea.value.trim().length > 0;
          sendBtn.disabled = !hasText;
        }
      }
    );
  } catch (e) {
    // Synchronous throw (extension disabled) — reproduce the channel-dead branch (REL-01)
    const outcome: SendOutcome = { kind: 'channel-dead', lastErrorMessage: e instanceof Error ? e.message : String(e) };
    const spec = mapSendOutcome(outcome);
    showToastFn(spec.message, spec.isError);
    // Restore controls so user can retry
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    cancelBtn.disabled = false;
    textarea.readOnly = false;
  }
}

// ---------------------------------------------------------------------------
// openElementCard — parallel to openCard; element-note path (ELEM-07/08/09)
// ---------------------------------------------------------------------------

/**
 * Open the element-note post-it card inside the shadow-root container.
 *
 * Mirrors openCard but adds:
 *  - .sfx-card-element modifier on #sfx-card root
 *  - Header label "Element note" (not "Free note")
 *  - Read-only .sfx-ctx-header strip (role=note) above .sfx-card-body
 *  - Secondary button label "Discard note" (not "Cancel")
 *  - Element Send: hide-all → waitTwoRafs → captureTab → drawHighlightBox → restore → POST
 *
 * @param container    Shadow-root container from createShadowRootUi
 * @param tabId        Current tab ID (resolved once in index.ts)
 * @param elementCtx   Frozen ElementContext captured at picker click time
 * @param onDismiss    Called on Discard or after Send success
 * @param showToastFn  Adapter: (msg, isError) => void (from index.ts)
 * @param onSent       Optional — called ONLY after a successful Send (not on
 *                     Discard/error). Used to re-arm pick mode so the user can
 *                     immediately pick the next element (sticky-picker UX).
 * @param onDiscard    Optional — called ONLY when the card is dismissed WITHOUT
 *                     sending (Discard button or Esc). Mirrors onSent's re-arm so
 *                     cancelling an element note re-arms pick mode too (does NOT
 *                     fire on successful Send — onSent owns that path; avoids
 *                     double-arming).
 */
export function openElementCard(
  container: HTMLElement,
  tabId: number,
  elementCtx: ElementContext,
  onDismiss: () => void,
  showToastFn: (msg: string, isError: boolean) => void,
  onSent?: () => void,
  onDiscard?: () => void
): void {
  // FREE-02 compatible: single-card guard (shared with openCard via card-state.ts)
  const decision = tryOpenCard();
  if (decision === 'focus-existing') {
    if (activeCard === null) {
      closeCardState();
      tryOpenCard();
    } else {
      const existing = activeCard.querySelector<HTMLTextAreaElement>('#sfx-card-textarea');
      existing?.focus();
      return;
    }
  }

  // Card-scoped thumbnails state (CAM-05) — element path
  // Note: element auto-highlight (+1) is added AFTER send in _doElementSend;
  // region thumbnails from the camera tool start at +2 if the element +1 exists.
  // The thumbnails array here tracks ONLY region captures; element +1 is handled
  // inline in _doElementSend and renumbered relative to the full screenshots array.
  const thumbnails: ThumbnailEntry[] = [];

  // Build card via createElement/textContent — INVARIANT C
  const card = document.createElement('div');
  card.id = 'sfx-card';
  card.className = 'sfx-card-element';   // element-mode modifier
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Add element note');
  card.setAttribute('aria-modal', 'false');

  // --- Header (drag handle zone) ---
  const header = document.createElement('div');
  header.className = 'sfx-card-header';

  const headerLabel = document.createElement('span');
  headerLabel.className = 'sfx-card-header-label';
  headerLabel.textContent = 'Element note';   // differs from free-note card
  header.appendChild(headerLabel);

  // Camera button — CAM-01 (last child; margin-left:auto pushes it right)
  const camBtn = document.createElement('button');
  camBtn.className = 'sfx-cam-btn';
  camBtn.setAttribute('aria-label', 'Capture region');
  camBtn.textContent = '📷';
  header.appendChild(camBtn);

  card.appendChild(header);

  // --- Context header (read-only strip — D-03 / ELEM-07) ---
  // textContent ONLY — page-derived strings; NEVER innerHTML (T-05-09)
  const ctxHeader = document.createElement('div');
  ctxHeader.className = 'sfx-ctx-header';
  ctxHeader.setAttribute('role', 'note');
  ctxHeader.setAttribute('aria-label', 'Element context');

  const ctxText = document.createElement('span');
  ctxText.className = 'sfx-ctx-header-text';
  ctxText.textContent = buildContextSummary(elementCtx);   // textContent — INVARIANT C
  ctxHeader.appendChild(ctxText);

  card.appendChild(ctxHeader);

  // --- Body ---
  const body = document.createElement('div');
  body.className = 'sfx-card-body';

  const textarea = document.createElement('textarea');
  textarea.id = 'sfx-card-textarea';
  textarea.setAttribute('placeholder', 'Type your note…');
  body.appendChild(textarea);

  // Thumbnail strip (CAM-05) — hidden until first region capture
  const thumbStrip = document.createElement('div');
  thumbStrip.className = 'sfx-thumb-strip';
  thumbStrip.style.display = 'none';
  body.appendChild(thumbStrip);

  card.appendChild(body);

  // --- Footer ---
  const footer = document.createElement('div');
  footer.className = 'sfx-card-footer';

  const sendBtn = document.createElement('button');
  sendBtn.id = 'sfx-card-send';
  sendBtn.textContent = 'Send';
  sendBtn.setAttribute('aria-label', 'Send note (empty)');
  sendBtn.disabled = true;   // disabled until textarea has content

  const discardBtn = document.createElement('button');
  discardBtn.id = 'sfx-card-cancel';
  discardBtn.textContent = 'Discard note';   // differs from free-note "Cancel"
  discardBtn.setAttribute('aria-label', 'Discard element note');

  footer.appendChild(sendBtn);
  footer.appendChild(discardBtn);
  card.appendChild(footer);

  container.appendChild(card);
  activeCard = card;

  // Focus textarea on next microtask — after DOM insertion
  Promise.resolve().then(() => textarea.focus());

  // -------------------------------------------------------------------------
  // Camera button click — CAM-01/02/03/04 (element-note path)
  // T-06-07 ordering: enterMarqueeMode cleanup() removes scrim FIRST, then
  // onCapture calls setSfxVisibility → waitTwoRafs → captureTab → cropToRect
  // -------------------------------------------------------------------------
  camBtn.addEventListener('click', () => {
    camBtn.disabled = true;

    enterMarqueeMode(
      container,
      // onCapture — scrim already removed by marquee cleanup() at this point (T-06-07)
      async (rect) => {
        // setSfxVisibility scoped to element card context
        function setSfxVisibilityElem(visible: boolean): void {
          const display = visible ? '' : 'none';
          if (activeCard) activeCard.style.display = display;
          const chip = container.querySelector<HTMLElement>('#sfx-chip');
          if (chip) chip.style.display = display;
          const fab = container.querySelector<HTMLElement>('#sfx-fab');
          if (fab) fab.style.display = display;
          const hoverOverlay = container.querySelector<HTMLElement>('.sfx-hover-highlight');
          if (hoverOverlay) hoverOverlay.style.display = display;
        }

        setSfxVisibilityElem(false);
        try {
          await waitTwoRafs();
          const dataUrl = await captureTab(tabId);
          const cropped = await cropToRect(dataUrl, rect, window.devicePixelRatio);
          setSfxVisibilityElem(true);
          // For element notes: +1 is the element auto-highlight (added in _doElementSend).
          // Region thumbnails from the camera are numbered starting after +1.
          // We offset by 1 to reserve slot +1 for the element highlight.
          thumbnails.push({ kind: nextThumbnailKind(thumbnails.length, 1), dataUrl: cropped });
          renderThumbnails(thumbStrip, thumbnails, 1);
        } catch (_capErr) {
          setSfxVisibilityElem(true);
          showToastFn('Screenshot capture failed', true);
        }
        camBtn.disabled = false;
      },
      () => {
        camBtn.disabled = false;
      }
    );
  });

  // -------------------------------------------------------------------------
  // Send disabled rule: disabled when textarea empty (after trim) or in-flight
  // Context header does NOT affect Send enablement (D-03)
  // -------------------------------------------------------------------------
  textarea.addEventListener('input', () => {
    const hasText = textarea.value.trim().length > 0;
    sendBtn.disabled = !hasText;
    sendBtn.setAttribute('aria-label', hasText ? 'Send note' : 'Send note (empty)');
  });

  // -------------------------------------------------------------------------
  // Keyboard: Esc → discard; Ctrl+Enter / Cmd+Enter → send if enabled
  // -------------------------------------------------------------------------
  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      _doClose(onDismiss);
      // Discard path (Esc) — re-arm pick mode (onSent owns the Send path)
      onDiscard?.();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!sendBtn.disabled) {
        _doElementSend(textarea, sendBtn, discardBtn, tabId, elementCtx, container, thumbnails, onDismiss, showToastFn, onSent);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Discard button
  // -------------------------------------------------------------------------
  discardBtn.addEventListener('click', () => {
    _doClose(onDismiss);
    // Discard path — re-arm pick mode (onSent owns the Send path)
    onDiscard?.();
  });

  // -------------------------------------------------------------------------
  // Send button
  // -------------------------------------------------------------------------
  sendBtn.addEventListener('click', () => {
    _doElementSend(textarea, sendBtn, discardBtn, tabId, elementCtx, container, thumbnails, onDismiss, showToastFn, onSent);
  });

  // -------------------------------------------------------------------------
  // Drag: interactjs on card, allowFrom header only (UI-SPEC §2)
  // Mirrors openCard drag block exactly — only element refs differ
  // -------------------------------------------------------------------------
  let cx = 0;
  let cy = 0;

  try {
    interact(card).draggable({
      inertia: false,
      allowFrom: '.sfx-card-header',
      modifiers: [
        interact.modifiers.restrictRect({
          restriction: () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }),
          endOnly: false,
        }),
      ],
      listeners: {
        start(event: Interact.DragEvent) {
          const el = event.target as HTMLElement;
          const style = window.getComputedStyle(el);
          const transform = style.transform;
          if (transform && transform !== 'none') {
            const matrix = new DOMMatrixReadOnly(transform);
            cx = matrix.m41;
            cy = matrix.m42;
          } else {
            cx = 0;
            cy = 0;
          }
        },
        move(event: Interact.DragEvent) {
          cx += event.dx;
          cy += event.dy;
          (event.target as HTMLElement).style.transform = `translate(${cx}px, ${cy}px)`;
        },
      },
    });
  } catch (_e) {
    // Fallback: header-restricted pointer-events drag
    _applyHeaderDrag(card, header);
  }
}

/**
 * Execute the element-note Send with capture pipeline (ELEM-08 / D-02a):
 *  1. Disable controls (Sending…)
 *  2. Hide all sfx surfaces synchronously (display:none)
 *  3. waitTwoRafs()
 *  4. captureTab(tabId) → full viewport dataUrl
 *  5. Build canvas, draw image, drawHighlightBox at frozenRect×dpr
 *  6. Restore sfx visibility
 *  7. Assemble mode:'element' AnnotationPayload
 *  8. chrome.runtime.sendMessage(SFX_SEND_ANNOTATION)
 *  9. Toast on success/failure; re-enable controls on failure
 *
 * frozenRect = elementCtx.rect — captured at click time, NEVER re-measured (Pitfall 2).
 * Own-UI is absent from the captured image (Pitfall 3 / T-05-13).
 */
function _doElementSend(
  textarea: HTMLTextAreaElement,
  sendBtn: HTMLButtonElement,
  discardBtn: HTMLButtonElement,
  tabId: number,
  elementCtx: ElementContext,
  container: HTMLElement,
  thumbnails: ThumbnailEntry[],
  onDismiss: () => void,
  showToastFn: (msg: string, isError: boolean) => void,
  onSent?: () => void
): void {
  // Step 1: disable controls
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  discardBtn.disabled = true;
  textarea.readOnly = true;

  // Freeze rect at click time — never re-measure (Pitfall 2)
  const frozenRect = elementCtx.rect ?? { x: 0, y: 0, width: 0, height: 0 };

  // Helper: restore controls on failure
  function restoreControls(): void {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    discardBtn.disabled = false;
    textarea.readOnly = false;
  }

  // Helper: hide/show all sfx surfaces (card, chip, fab, hover overlay)
  function setSfxVisibility(visible: boolean): void {
    const display = visible ? '' : 'none';
    // card (activeCard — the element card itself)
    if (activeCard) activeCard.style.display = display;
    // chip
    const chip = container.querySelector<HTMLElement>('#sfx-chip');
    if (chip) chip.style.display = display;
    // FAB
    const fab = container.querySelector<HTMLElement>('#sfx-fab');
    if (fab) fab.style.display = display;
    // hover-highlight overlay (may be absent if pick mode exited)
    const hoverOverlay = container.querySelector<HTMLElement>('.sfx-hover-highlight');
    if (hoverOverlay) hoverOverlay.style.display = display;
  }

  // Step 2: hide all sfx surfaces synchronously (own-UI must be absent from capture)
  setSfxVisibility(false);

  // Steps 3-6: async capture sequence
  (async () => {
    let plus1DataUrl: string;
    try {
      // Step 3: wait two rAFs — ensures repaint before capture (Pitfall 3)
      await waitTwoRafs();

      // Step 4: capture full viewport via SW relay (SFX_CAPTURE_TAB)
      const dataUrl = await captureTab(tabId);

      // Step 5: draw highlight box onto canvas at frozen element rect
      const img = new Image();
      const canvas = await new Promise<HTMLCanvasElement>((resolve, reject) => {
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx2d = c.getContext('2d');
          if (!ctx2d) { reject(new Error('No 2D context')); return; }
          ctx2d.drawImage(img, 0, 0);
          drawHighlightBox(c, frozenRect, window.devicePixelRatio);
          resolve(c);
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = dataUrl;
      });

      plus1DataUrl = canvas.toDataURL('image/png');
    } catch (_capErr) {
      // Step 6 (capture fail path): restore UI visibility first, then controls
      setSfxVisibility(true);
      restoreControls();
      showToastFn('Screenshot capture failed — note not sent', true);
      return;
    }

    // Step 6 (success path): restore sfx UI visibility
    setSfxVisibility(true);

    // Step 7: assemble mode:'element' payload
    const payload: AnnotationPayload = {
      mode: 'element',
      comment: textarea.value.trim(),
      page: {
        url: window.location.href,
        title: document.title,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      element: elementCtx,
      // CAM-06: +1 is the element auto-highlight; region thumbnails follow as +2, +3, …
      // thumbnails[].kind is already set as '+2', '+3', … (offset by 1 in camera handler)
      screenshots: [
        {
          kind: '+1',
          mime: 'image/png' as const,
          dataUrl: plus1DataUrl,
          rect: {
            x: frozenRect.x,
            y: frozenRect.y,
            width: frozenRect.width,
            height: frozenRect.height,
          },
        },
        ...thumbnails.map(t => ({ kind: t.kind, mime: 'image/png' as const, dataUrl: t.dataUrl })),
      ],
    };

    // D-04: pre-flight encoded-size guard — block oversize payloads before SW round-trip
    if (exceedsBodyCap(JSON.stringify(payload))) {
      showToastFn('Screenshot too large to send (over 12 MB) — remove a capture and retry', true);
      restoreControls();
      sendBtn.disabled = textarea.value.trim().length === 0;
      return;
    }

    // Step 8: SW relay (INVARIANT B — no direct fetch)
    // REL-01: sendMessage can throw synchronously if the extension is disabled mid-flight — never silent
    try {
      chrome.runtime.sendMessage(
        { type: SFX_MSG.SEND_ANNOTATION, tabId, payload },
        (resp: AnnotationResponse | undefined) => {
          // Step 9: guard both lastError AND resp — never silent (REL-01)
          if (chrome.runtime.lastError || !resp) {
            const outcome: SendOutcome = { kind: 'channel-dead', lastErrorMessage: chrome.runtime.lastError?.message };
            const spec = mapSendOutcome(outcome);
            showToastFn(spec.message, spec.isError);
            restoreControls();
            // Re-apply disabled rule (mirrors _doSend pattern)
            sendBtn.disabled = textarea.value.trim().length === 0;
            return;
          }

          if (resp.ok) {
            const outcome: SendOutcome = { kind: 'ok', file: resp.file };
            const spec = mapSendOutcome(outcome);
            showToastFn(spec.message, spec.isError);
            _doClose(onDismiss);
            // Sticky-picker UX: re-arm pick mode after a successful element Send
            // so the user can immediately pick the next element (success only —
            // never on Discard/error).
            onSent?.();
          } else {
            const outcome: SendOutcome = { kind: 'relay-error', error: resp.error };
            const spec = mapSendOutcome(outcome);
            showToastFn(spec.message, spec.isError);
            restoreControls();
            // Re-apply disabled rule (mirrors _doSend pattern)
            sendBtn.disabled = textarea.value.trim().length === 0;
          }
        }
      );
    } catch (e) {
      // Synchronous throw (extension disabled) — reproduce the channel-dead branch (REL-01)
      const outcome: SendOutcome = { kind: 'channel-dead', lastErrorMessage: e instanceof Error ? e.message : String(e) };
      const spec = mapSendOutcome(outcome);
      showToastFn(spec.message, spec.isError);
      restoreControls();
      // Re-apply disabled rule (mirrors _doSend pattern)
      sendBtn.disabled = textarea.value.trim().length === 0;
    }
  })();
}

/**
 * Fallback drag for card via pointer events (header-restricted).
 * Only used if interactjs throws during initialization.
 * Mirrors chip.ts makeDraggable approach adapted for header-only initiation.
 */
function _applyHeaderDrag(card: HTMLElement, header: HTMLElement): void {
  let isDragging = false;
  let startPtrX = 0;
  let startPtrY = 0;
  let startTransX = 0;
  let startTransY = 0;

  header.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    card.setPointerCapture(e.pointerId);
    isDragging = true;
    startPtrX = e.clientX;
    startPtrY = e.clientY;

    const style = window.getComputedStyle(card);
    const transform = style.transform;
    if (transform && transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(transform);
      startTransX = matrix.m41;
      startTransY = matrix.m42;
    } else {
      startTransX = 0;
      startTransY = 0;
    }
    e.preventDefault();
  });

  card.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDragging || !card.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startPtrX;
    const dy = e.clientY - startPtrY;
    card.style.transform = `translate(${startTransX + dx}px, ${startTransY + dy}px)`;
  });

  card.addEventListener('pointerup', (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    card.releasePointerCapture(e.pointerId);
  });

  card.addEventListener('pointercancel', (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    try { card.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  });
}
