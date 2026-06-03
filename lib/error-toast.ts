/**
 * Error-toast mapper for stickyfix.
 *
 * mapSendOutcome — pure, node:test-safe (no DOM/chrome at module level).
 *
 * INVARIANT: No top-level chrome / document / window access — all browser
 * API use is inside function bodies so mapSendOutcome imports cleanly
 * under node:test.
 *
 * D-01 / D-01a: single source of truth for Send-failure toast strings.
 * The mapper reproduces the EXACT current card.ts toast strings verbatim —
 * this is a consolidation refactor, not a UX change.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all possible Send outcomes.
 *
 * - 'ok': annotation written successfully; carries the resulting filename.
 * - 'channel-dead': chrome.runtime.lastError fired or no response from SW;
 *   carries the optional lastError message.
 * - 'relay-error': SW responded but resp.ok === false; carries the
 *   host-derived error string passed through from the SW.
 */
export type SendOutcome =
  | { kind: 'ok'; file: string }
  | { kind: 'channel-dead'; lastErrorMessage?: string }
  | { kind: 'relay-error'; error: string };

/**
 * Toast display descriptor returned by mapSendOutcome.
 * The content script calls showToast(container, spec.message, spec.isError).
 */
export interface ToastSpec {
  message: string;
  isError: boolean;
}

// ---------------------------------------------------------------------------
// mapSendOutcome — pure, node:test-safe
// ---------------------------------------------------------------------------

/**
 * Map a SendOutcome to its toast display spec.
 *
 * All string literals reproduce the EXACT strings from card.ts (D-01a).
 * Do NOT alter these strings without updating the verbatim assertions in
 * lib/test/error-toast.test.ts first.
 *
 * card.ts:413-415 / :849-851 (channel-dead):
 *   'Extension error: ' + (chrome.runtime.lastError?.message ?? 'no response')
 * card.ts:433 / :867 (relay-error):
 *   resp.error — passed straight through
 * card.ts:427 / :860 (success):
 *   `wrote notes\\${resp.file}` — single backslash at runtime
 */
export function mapSendOutcome(o: SendOutcome): ToastSpec {
  switch (o.kind) {
    case 'ok':
      return {
        // Template literal with double-backslash in TS source = single backslash at runtime.
        // D-01a: 'wrote notes\<file>' — do NOT normalize to forward slash.
        message: `wrote notes\\${o.file}`,
        isError: false,
      };
    case 'channel-dead':
      return {
        message: 'Extension error: ' + (o.lastErrorMessage ?? 'no response'),
        isError: true,
      };
    case 'relay-error':
      return {
        message: o.error,
        isError: true,
      };
  }
}
