/**
 * poll.ts — live disk→UI sync for stickyfix review UI.
 *
 * Polls GET /annotations (via SW relay) every ~4 s while the tab is visible.
 * Calls `onChange` only when the note set actually changed (stable signature
 * comparison), so re-renders never fire on a clean tick.
 */

import { SFX_LIST_ANNOTATIONS } from '../../lib/types.js';

// ---------------------------------------------------------------------------
// Module state — fully reset in stopPinPolling()
// ---------------------------------------------------------------------------

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _tabId: number | null = null;
let _onChange: (() => void) | null = null;
let _lastSig: string | null = null;            // null = no baseline yet
let _visibilityListener: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

interface PinSig {
  serial: string;
  status: string;
  text: string;
  reply?: string;
}

function sig(pins: PinSig[]): string {
  return [...pins]
    .sort((a, b) => a.serial.localeCompare(b.serial))
    .map(p => `${p.serial}|${p.status}|${p.text}|${p.reply ?? ''}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Core poll tick (shared by interval + visibilitychange)
// ---------------------------------------------------------------------------

function _tick(): void {
  if (document.visibilityState !== 'visible') return;
  if (_tabId === null || _onChange === null) return;
  const tabId = _tabId;
  const onChange = _onChange;

  chrome.runtime.sendMessage(
    { type: SFX_LIST_ANNOTATIONS, tabId },
    (resp: unknown) => {
      // Guard: extension context gone or no response
      if (chrome.runtime.lastError) return;
      if (
        resp == null ||
        typeof resp !== 'object' ||
        !(resp as Record<string, unknown>).ok
      ) return;

      const r = resp as { ok: true; pins: PinSig[] };
      const pins: PinSig[] = Array.isArray(r.pins) ? r.pins : [];
      const current = sig(pins);

      if (_lastSig === null) {
        // First successful fetch — establish baseline, do NOT call onChange.
        _lastSig = current;
        return;
      }

      if (current !== _lastSig) {
        _lastSig = current;
        onChange();
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Begin polling for changes on the current page's notes.
 * Idempotent — calling again stops any prior poll and restarts cleanly.
 */
export function startPinPolling(
  tabId: number,
  onChange: () => void,
  intervalMs = 4000
): void {
  stopPinPolling(); // idempotent: clear any prior state first

  _tabId = tabId;
  _onChange = onChange;
  _lastSig = null;  // reset baseline — first successful tick sets it

  _intervalId = setInterval(_tick, intervalMs);

  // Immediately run a tick when the tab becomes visible again.
  const onVisibility = () => {
    if (document.visibilityState === 'visible') _tick();
  };
  _visibilityListener = onVisibility;
  document.addEventListener('visibilitychange', onVisibility);
}

/**
 * Stop polling and remove all listeners. Idempotent.
 */
export function stopPinPolling(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  if (_visibilityListener !== null) {
    document.removeEventListener('visibilitychange', _visibilityListener);
    _visibilityListener = null;
  }
  _tabId = null;
  _onChange = null;
  _lastSig = null;
}
