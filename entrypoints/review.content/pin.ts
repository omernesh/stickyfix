/**
 * stickyfix persistent pins — shadow-root UI
 *
 * mountPins / teardownPins: load notes from disk (via SW relay SFX_LIST_ANNOTATIONS)
 * and render one on-page pin per note for the current URL path.
 *
 * PIN-01: element pins anchored to their stored selector (repositioned on scroll/resize).
 * PIN-02: free pins float at stored viewport coords (note_position).
 * PIN-03: orphaned pins (selector misses) rendered greyed/dashed at last-known rect.
 * PIN-04: mode color + unread/read dot + hover text preview.
 * PIN-05/06: click → view card → edit (PUT) / delete (DELETE behind Confirm/Keep).
 *
 * Security invariants:
 *  - DOM via createElement/textContent only — no innerHTML (INVARIANT C / T-06-05)
 *  - SW is the sole HTTP client (INVARIANT B — sendMessage relay only)
 *  - computePinPosition imported from lib/pin-position.ts — no inline math
 *  - Shadow-host excluded from click/hover guards (T-05-06 pattern)
 *  - No window.confirm (D-05 — inline footer confirm)
 *  - sfx-* namespace (INVARIANT D)
 */

import { SFX_LIST_ANNOTATIONS, SFX_EDIT_ANNOTATION, SFX_DELETE_ANNOTATION } from '../../lib/types.js';
import { computePinPosition } from '../../lib/pin-position.js';

// ---------------------------------------------------------------------------
// PinDescriptor — mirrors host GET /annotations response shape
// ---------------------------------------------------------------------------

interface PinDescriptor {
  serial: string;
  mode: 'free' | 'element';
  status: string;
  url: string;
  text: string;
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
  note_position?: { x: number; y: number };
  screenshots: string[];
}

// ---------------------------------------------------------------------------
// Module-level state — one mount session at a time
// ---------------------------------------------------------------------------

interface PinEntry {
  pin: HTMLElement;
  el: Element | null;
  data: PinDescriptor;
}

let _pinEntries: PinEntry[] = [];
let _cleanupFns: Array<() => void> = [];
let _container: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch notes for the current tab via SW relay and render one pin per note.
 * Pins are appended to the shadow-root container.
 *
 * @param container     Shadow-root mounting point from createShadowRootUi
 * @param tabId         Resolved tab ID (passed by index.ts after getTabId)
 * @param showToastFn   Toast adapter: (msg, isError) => void
 */
export async function mountPins(
  container: HTMLElement,
  tabId: number,
  showToastFn: (msg: string, isError: boolean) => void
): Promise<void> {
  // Resolve the sfx shadow host for click/hover exclusion (T-05-06 pattern)
  const rootNode = container.getRootNode();
  const sfxHost: Element | null =
    rootNode instanceof ShadowRoot ? rootNode.host : null;

  _container = container;

  // Fetch pin descriptors from host via SW relay (INVARIANT B — no direct fetch)
  const resp = await new Promise<{ ok: boolean; pins?: PinDescriptor[]; error?: string }>(
    (resolve) => {
      chrome.runtime.sendMessage(
        { type: SFX_LIST_ANNOTATIONS, tabId } as { type: string; tabId: number },
        (r: { ok: boolean; pins?: PinDescriptor[]; error?: string } | undefined) => {
          if (chrome.runtime.lastError || !r) {
            resolve({ ok: false, error: chrome.runtime.lastError?.message ?? 'no response' });
          } else {
            resolve(r);
          }
        }
      );
    }
  );

  if (!resp.ok || !resp.pins) {
    showToastFn(`Could not load pins — ${resp.error ?? 'unknown error'}`, true);
    return;
  }

  const pins = resp.pins;

  // Register ONE shared throttled scroll + resize listener for element pin repositioning
  let _lastRepos = 0;
  const onScrollResize = () => {
    const now = Date.now();
    if (now - _lastRepos < 100) return;
    _lastRepos = now;
    _repositionElementPins();
  };
  window.addEventListener('scroll', onScrollResize, { passive: true });
  window.addEventListener('resize', onScrollResize);
  _cleanupFns.push(
    () => window.removeEventListener('scroll', onScrollResize),
    () => window.removeEventListener('resize', onScrollResize)
  );

  // Render one pin per descriptor
  for (const data of pins) {
    const pinEl = _buildPinElement(data);

    // Determine anchor element (element pins only)
    let anchorEl: Element | null = null;
    if (data.mode === 'element' && data.selector) {
      // Query against the page (document), excluding sfx shadow host
      const found = document.querySelector(data.selector);
      if (found !== null && sfxHost !== null && (found === sfxHost || sfxHost.contains(found))) {
        // Matched sfx-internal element — treat as orphaned
        anchorEl = null;
      } else {
        anchorEl = found;
      }
    }

    // Position the pin
    _positionPin(pinEl, data, anchorEl);

    // Track entry
    const entry: PinEntry = { pin: pinEl, el: anchorEl, data };
    _pinEntries.push(entry);

    // Wire hover preview show/hide
    const preview = pinEl.querySelector<HTMLElement>('.sfx-pin-preview');
    if (preview) {
      pinEl.addEventListener('mouseenter', () => {
        // Flip preview below pin when within 130px of top of viewport
        const rect = pinEl.getBoundingClientRect();
        if (rect.top < 130) {
          preview.style.bottom = '';
          preview.style.top = 'calc(100% + 4px)';
        } else {
          preview.style.top = '';
          preview.style.bottom = 'calc(100% + 4px)';
        }
        preview.style.display = 'block';
      });
      pinEl.addEventListener('mouseleave', () => {
        preview.style.display = 'none';
      });
    }

    // Wire click → open pin card
    pinEl.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      openPinCard(container, tabId, data, showToastFn);
    });

    container.appendChild(pinEl);
  }
}

/**
 * Tear down all pins: remove DOM elements, remove scroll/resize listeners, reset state.
 * Idempotent — safe to call when no pins are mounted.
 */
export function teardownPins(): void {
  // Remove all scroll/resize listeners
  for (const fn of _cleanupFns) {
    fn();
  }
  _cleanupFns = [];

  // Remove all pin elements from DOM
  for (const entry of _pinEntries) {
    if (entry.pin.parentElement) {
      entry.pin.parentElement.removeChild(entry.pin);
    }
  }
  _pinEntries = [];
  _container = null;
}

// ---------------------------------------------------------------------------
// openPinCard — VIEW/EDIT/DELETE card for a pin
// ---------------------------------------------------------------------------

/**
 * Open the view/edit/delete card for a pinned note.
 * VIEW mode shows note body text + thumbnails with Edit/Delete/Close.
 * EDIT mode is in-place (no card close/reopen).
 */
export function openPinCard(
  container: HTMLElement,
  tabId: number,
  data: PinDescriptor,
  showToastFn: (msg: string, isError: boolean) => void
): void {
  // Remove any existing pin card to enforce single-card contract
  const existing = container.querySelector<HTMLElement>('#sfx-card');
  if (existing) {
    existing.remove();
  }

  const isElement = data.mode === 'element';

  // Build card via createElement/textContent — INVARIANT C
  const card = document.createElement('div');
  card.id = 'sfx-card';
  card.className = isElement ? 'sfx-card-element sfx-card-pin' : 'sfx-card-pin';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', isElement ? 'Element note' : 'Free note');
  card.setAttribute('aria-modal', 'false');

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'sfx-card-header';

  const headerLabel = document.createElement('span');
  headerLabel.className = 'sfx-card-header-label';
  headerLabel.textContent = isElement ? 'Element note' : 'Free note';
  header.appendChild(headerLabel);
  card.appendChild(header);

  // --- Body (VIEW mode) ---
  const body = document.createElement('div');
  body.className = 'sfx-card-body';

  const bodyText = document.createElement('div');
  bodyText.className = 'sfx-pin-body-text';
  bodyText.textContent = data.text;  // textContent — INVARIANT C / T-06-05
  body.appendChild(bodyText);

  // Thumbnails (read-only in view mode — no × button)
  if (data.screenshots && data.screenshots.length > 0) {
    const strip = document.createElement('div');
    strip.className = 'sfx-thumb-strip';
    strip.style.display = 'flex';
    for (const src of data.screenshots) {
      const wrap = document.createElement('div');
      wrap.className = 'sfx-thumb-wrap';
      const img = document.createElement('img');
      img.className = 'sfx-thumb-img';
      img.src = src;  // data: URI or relative path from host — no XSS risk
      img.alt = 'Screenshot';
      wrap.appendChild(img);
      strip.appendChild(wrap);
    }
    body.appendChild(strip);
  }

  card.appendChild(body);

  // --- Footer (VIEW mode) ---
  const footer = document.createElement('div');
  footer.className = 'sfx-card-footer';

  const editBtn = document.createElement('button');
  editBtn.className = 'sfx-cam-btn';
  editBtn.style.borderRadius = '4px';
  editBtn.style.width = 'auto';
  editBtn.style.height = 'auto';
  editBtn.style.padding = '4px 10px';
  editBtn.style.fontSize = '12px';
  editBtn.style.marginLeft = '0';
  editBtn.textContent = 'Edit note';
  editBtn.setAttribute('aria-label', 'Edit note');

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'sfx-btn-delete';
  deleteBtn.textContent = 'Delete note';
  deleteBtn.setAttribute('aria-label', 'Delete note');

  const closeBtn = document.createElement('button');
  closeBtn.id = 'sfx-card-cancel';
  closeBtn.textContent = 'Close card';
  closeBtn.setAttribute('aria-label', 'Close card');

  footer.appendChild(editBtn);
  footer.appendChild(deleteBtn);
  footer.appendChild(closeBtn);
  card.appendChild(footer);

  container.appendChild(card);

  // --- Keyboard: Esc → close ---
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      card.remove();
      document.removeEventListener('keydown', onKeyDown);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  // --- Close button ---
  closeBtn.addEventListener('click', () => {
    card.remove();
    document.removeEventListener('keydown', onKeyDown);
  });

  // --- Delete button → inline confirm ---
  deleteBtn.addEventListener('click', () => {
    // Replace footer with inline confirm
    footer.replaceChildren();

    const confirmText = document.createElement('span');
    confirmText.className = 'sfx-del-confirm-text';
    confirmText.textContent = 'Delete this note and its screenshots?';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'sfx-btn-delete-confirm';
    confirmBtn.textContent = 'Confirm delete';
    confirmBtn.setAttribute('aria-label', 'Confirm delete');

    const keepBtn = document.createElement('button');
    keepBtn.id = 'sfx-card-cancel';
    keepBtn.textContent = 'Keep';
    keepBtn.setAttribute('aria-label', 'Keep note');

    footer.appendChild(confirmText);
    footer.appendChild(confirmBtn);
    footer.appendChild(keepBtn);

    // Keep → restore original footer
    keepBtn.addEventListener('click', () => {
      footer.replaceChildren();
      footer.appendChild(editBtn);
      footer.appendChild(deleteBtn);
      footer.appendChild(closeBtn);
    });

    // Confirm delete → SW relay DELETE
    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting…';
      keepBtn.disabled = true;

      chrome.runtime.sendMessage(
        { type: SFX_DELETE_ANNOTATION, tabId, serial: data.serial } as { type: string; tabId: number; serial: string },
        (resp: { ok: boolean; error?: string } | undefined) => {
          if (chrome.runtime.lastError || !resp) {
            showToastFn(
              'Extension error: ' + (chrome.runtime.lastError?.message ?? 'no response'),
              true
            );
            // Restore footer
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm delete';
            keepBtn.disabled = false;
            return;
          }
          if (resp.ok) {
            showToastFn('Note deleted', false);
            // Remove the pin for this serial from DOM
            _removePinBySerial(data.serial);
            card.remove();
            document.removeEventListener('keydown', onKeyDown);
          } else {
            showToastFn(resp.error ?? 'Delete failed', true);
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm delete';
            keepBtn.disabled = false;
          }
        }
      );
    });
  });

  // --- Edit button → switch to EDIT mode ---
  editBtn.addEventListener('click', () => {
    // Replace body content with textarea pre-filled with note text
    body.replaceChildren();

    const textarea = document.createElement('textarea');
    textarea.id = 'sfx-card-textarea';
    textarea.setAttribute('placeholder', 'Type your note…');
    textarea.value = data.text;
    body.appendChild(textarea);

    // Replace footer with Save/Discard changes
    footer.replaceChildren();

    const saveBtn = document.createElement('button');
    saveBtn.id = 'sfx-card-send';
    saveBtn.textContent = 'Save';
    saveBtn.setAttribute('aria-label', 'Save note');
    saveBtn.disabled = textarea.value.trim().length === 0;

    const discardBtn = document.createElement('button');
    discardBtn.id = 'sfx-card-cancel';
    discardBtn.textContent = 'Discard changes';
    discardBtn.setAttribute('aria-label', 'Discard changes');

    footer.appendChild(saveBtn);
    footer.appendChild(discardBtn);

    // Focus textarea
    Promise.resolve().then(() => textarea.focus());

    // Enable/disable Save based on content
    textarea.addEventListener('input', () => {
      saveBtn.disabled = textarea.value.trim().length === 0;
    });

    // Ctrl+Enter → save
    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!saveBtn.disabled) {
          saveBtn.click();
        }
      }
    });

    // Discard changes → close card
    discardBtn.addEventListener('click', () => {
      card.remove();
      document.removeEventListener('keydown', onKeyDown);
    });

    // Save → SW relay PUT
    saveBtn.addEventListener('click', () => {
      const newText = textarea.value.trim();
      if (!newText) return;

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      discardBtn.disabled = true;
      textarea.readOnly = true;

      chrome.runtime.sendMessage(
        {
          type: SFX_EDIT_ANNOTATION,
          tabId,
          serial: data.serial,
          comment: newText,
        } as { type: string; tabId: number; serial: string; comment: string },
        (resp: { ok: boolean; error?: string } | undefined) => {
          if (chrome.runtime.lastError || !resp) {
            showToastFn(
              'Extension error: ' + (chrome.runtime.lastError?.message ?? 'no response'),
              true
            );
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
            discardBtn.disabled = false;
            textarea.readOnly = false;
            return;
          }
          if (resp.ok) {
            showToastFn('Note saved', false);
            // Update pin: dot → unread (red), update preview text, update data
            data.text = newText;
            data.status = 'unread';
            _updatePinAfterEdit(data.serial, newText, 'unread');
            card.remove();
            document.removeEventListener('keydown', onKeyDown);
          } else {
            showToastFn(resp.error ?? 'Save failed', true);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
            discardBtn.disabled = false;
            textarea.readOnly = false;
          }
        }
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a pin marker DOM element for the given descriptor.
 * Uses createElement/textContent — INVARIANT C / T-06-05.
 */
function _buildPinElement(data: PinDescriptor): HTMLElement {
  const pin = document.createElement('div');
  pin.className = 'sfx-pin';

  // Mode color class (free = amber, element = blue)
  if (data.mode === 'element') {
    pin.classList.add('sfx-pin-element');
  } else {
    pin.classList.add('sfx-pin-free');
  }

  // Read state class
  if (data.status === 'read') {
    pin.classList.add('sfx-pin-read');
  }

  // Pin glyph
  const glyph = document.createElement('span');
  glyph.textContent = '📌';
  glyph.setAttribute('aria-hidden', 'true');
  pin.appendChild(glyph);

  // Unread/read dot
  const dot = document.createElement('span');
  dot.className = 'sfx-pin-dot';
  pin.appendChild(dot);

  // Hover preview — textContent only, never innerHTML (T-06-05)
  const preview = document.createElement('div');
  preview.className = 'sfx-pin-preview';
  const previewText = (data.status === 'read' ? '[read] ' : '') + data.text.slice(0, 200);
  preview.textContent = previewText;  // textContent — INVARIANT C
  preview.style.display = 'none';
  pin.appendChild(preview);

  return pin;
}

/**
 * Position a pin element using the pure computePinPosition math.
 * Pin.ts supplies anchorRect + scrollX/scrollY — computePinPosition does the math.
 */
function _positionPin(pin: HTMLElement, data: PinDescriptor, anchorEl: Element | null): void {
  let anchorRect: { x: number; y: number; width: number; height: number } | null = null;
  let storedRect: { x: number; y: number; width: number; height: number } | null = null;
  let orphaned = false;

  if (data.mode === 'element') {
    orphaned = anchorEl === null;
    if (anchorEl !== null) {
      const r = anchorEl.getBoundingClientRect();
      anchorRect = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    // storedRect for orphaned fallback (page-absolute coords)
    if (data.rect) {
      storedRect = data.rect;
    }
  } else {
    // Free note: anchorRect = stored viewport coords at Send time
    if (data.note_position) {
      anchorRect = { x: data.note_position.x, y: data.note_position.y, width: 0, height: 0 };
    } else {
      // Fallback: pin at top-left corner
      anchorRect = { x: 16, y: 80, width: 0, height: 0 };
    }
    orphaned = false;
  }

  // Delegate ALL position math to the pure computePinPosition (imported from lib)
  const { left, top, orphaned: isOrphaned } = computePinPosition(
    anchorRect,
    storedRect,
    window.scrollX,
    window.scrollY,
    orphaned
  );

  pin.style.left = `${left}px`;
  pin.style.top = `${top}px`;

  if (isOrphaned) {
    pin.classList.add('sfx-pin-orphaned');
    // Orphaned tooltip via title attr — no innerHTML risk (T-06-05)
    pin.title = 'Element not found on this page — click to view or delete';
  }
}

/**
 * Reposition all element pins using the current DOM state + scroll offsets.
 * Called by the throttled scroll/resize listener.
 */
function _repositionElementPins(): void {
  for (const entry of _pinEntries) {
    if (entry.data.mode === 'element') {
      // Re-query anchor (may have appeared/disappeared)
      const rootNode = _container?.getRootNode();
      const sfxHost: Element | null =
        rootNode instanceof ShadowRoot ? rootNode.host : null;

      let anchorEl: Element | null = null;
      if (entry.data.selector) {
        const found = document.querySelector(entry.data.selector);
        if (found !== null && sfxHost !== null && (found === sfxHost || sfxHost.contains(found))) {
          anchorEl = null;
        } else {
          anchorEl = found;
        }
      }
      entry.el = anchorEl;

      // Re-position using computePinPosition (pure math)
      const orphaned = anchorEl === null;
      let anchorRect: { x: number; y: number; width: number; height: number } | null = null;
      if (anchorEl !== null) {
        const r = anchorEl.getBoundingClientRect();
        anchorRect = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      const storedRect = entry.data.rect ?? null;

      const { left, top, orphaned: isOrphaned } = computePinPosition(
        anchorRect,
        storedRect,
        window.scrollX,
        window.scrollY,
        orphaned
      );

      entry.pin.style.left = `${left}px`;
      entry.pin.style.top = `${top}px`;

      if (isOrphaned && !entry.pin.classList.contains('sfx-pin-orphaned')) {
        entry.pin.classList.add('sfx-pin-orphaned');
        entry.pin.title = 'Element not found on this page — click to view or delete';
      } else if (!isOrphaned && entry.pin.classList.contains('sfx-pin-orphaned')) {
        entry.pin.classList.remove('sfx-pin-orphaned');
        entry.pin.title = '';
      }
    }
  }
}

/**
 * Remove a pin element from the DOM and from _pinEntries by serial.
 */
function _removePinBySerial(serial: string): void {
  const idx = _pinEntries.findIndex(e => e.data.serial === serial);
  if (idx !== -1) {
    const entry = _pinEntries[idx];
    if (entry.pin.parentElement) {
      entry.pin.parentElement.removeChild(entry.pin);
    }
    _pinEntries.splice(idx, 1);
  }
}

/**
 * Update a pin's dot and hover preview after a successful edit.
 */
function _updatePinAfterEdit(serial: string, newText: string, status: string): void {
  const entry = _pinEntries.find(e => e.data.serial === serial);
  if (!entry) return;

  // Update data
  entry.data.text = newText;
  entry.data.status = status;

  // Update dot — unread = red (remove sfx-pin-read), read = green
  if (status === 'unread') {
    entry.pin.classList.remove('sfx-pin-read');
  } else {
    entry.pin.classList.add('sfx-pin-read');
  }

  // Update hover preview text via textContent (INVARIANT C / T-06-05)
  const preview = entry.pin.querySelector<HTMLElement>('.sfx-pin-preview');
  if (preview) {
    const previewText = (status === 'read' ? '[read] ' : '') + newText.slice(0, 200);
    preview.textContent = previewText;
  }
}
