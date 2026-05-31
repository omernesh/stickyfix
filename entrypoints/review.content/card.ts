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
 *  - screenshots: [] ALWAYS empty — D-06 (free notes are text-only)
 *  - card.ts MUST NOT import lib/capture.ts (T-04-04)
 *  - All host-derived strings (resp.file, resp.error) go through showToastFn
 *    which calls textContent — never innerHTML
 *  - SW is the sole HTTP client (INVARIANT B — sendMessage relay only)
 *  - sfx-* namespace (INVARIANT D)
 */

import interact from 'interactjs';
import { SFX_MSG } from '../../lib/types.js';
import type { AnnotationPayload } from '../../lib/types.js';
import { tryOpenCard, closeCardState } from './card-state.js';

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
 */
export function openCard(
  container: HTMLElement,
  tabId: number,
  onDismiss: () => void,
  showToastFn: (msg: string, isError: boolean) => void
): void {
  // FREE-02: single-card guard (DOM-free decision delegated to card-state.ts)
  const decision = tryOpenCard();
  if (decision === 'focus-existing') {
    // Focus the existing textarea — do NOT spawn a second card (D-02)
    const existing = activeCard?.querySelector<HTMLTextAreaElement>('#sfx-card-textarea');
    existing?.focus();
    return;
  }

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

  card.appendChild(header);

  // --- Body ---
  const body = document.createElement('div');
  body.className = 'sfx-card-body';

  const textarea = document.createElement('textarea');
  textarea.id = 'sfx-card-textarea';
  textarea.setAttribute('placeholder', 'Type your note…');
  body.appendChild(textarea);

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
        _doSend(textarea, sendBtn, cancelBtn, tabId, onDismiss, showToastFn);
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
    _doSend(textarea, sendBtn, cancelBtn, tabId, onDismiss, showToastFn);
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
        interact.modifiers.restrictRect({ restriction: 'window', endOnly: false }),
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
 * screenshots: [] — D-06: ALWAYS empty for free notes.
 * card.ts MUST NOT import lib/capture.ts (T-04-04 / D-06).
 */
function _doSend(
  textarea: HTMLTextAreaElement,
  sendBtn: HTMLButtonElement,
  cancelBtn: HTMLButtonElement,
  tabId: number,
  onDismiss: () => void,
  showToastFn: (msg: string, isError: boolean) => void
): void {
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  cancelBtn.disabled = true;
  textarea.readOnly = true;

  // §9.1 free-note payload (D-06 enforced: screenshots ALWAYS [])
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
    screenshots: [],  // D-06: ALWAYS empty for free notes — never add capture here
  };

  // SW relay — mirrors chip.ts wireSendButton exactly (INVARIANT B: no direct fetch)
  chrome.runtime.sendMessage(
    { type: SFX_MSG.SEND_ANNOTATION, tabId, payload },
    (resp: AnnotationResponse | undefined) => {
      // WR-02: guard both lastError AND resp — never silent (REL-01)
      if (chrome.runtime.lastError || !resp) {
        showToastFn(
          'Extension error: ' + (chrome.runtime.lastError?.message ?? 'no response'),
          true
        );
        // Restore controls so user can retry
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
        cancelBtn.disabled = false;
        textarea.readOnly = false;
        return;
      }

      if (resp.ok) {
        // resp.file is the exact host-returned filename — never client-reconstructed
        showToastFn(`wrote notes\\${resp.file}`, false);
        _doClose(onDismiss);
      } else {
        // Error: card stays open; restore controls (user can retry)
        showToastFn(resp.error, true);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
        cancelBtn.disabled = false;
        textarea.readOnly = false;
        // Re-apply disabled rule based on current textarea content
        const hasText = textarea.value.trim().length > 0;
        sendBtn.disabled = !hasText;
      }
    }
  );
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
