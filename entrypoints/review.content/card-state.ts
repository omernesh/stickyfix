/**
 * Single-active-card state machine — DOM-free.
 *
 * Extracted from card.ts so the FREE-02 single-card guard is unit-testable
 * under node:test without any DOM or chrome API dependencies.
 *
 * Zero document/window/chrome references — pure module-level boolean guard.
 */

/** Module-level active flag — false until a card is opened. */
let active = false;

/**
 * Attempt to open a new card.
 *
 * Returns 'opened' if no card was active (sets the active flag).
 * Returns 'focus-existing' if a card is already active (does NOT change state).
 *
 * FREE-02: only one card may be open at a time.
 */
export function tryOpenCard(): 'opened' | 'focus-existing' {
  if (active) {
    return 'focus-existing';
  }
  active = true;
  return 'opened';
}

/**
 * Clear the active card flag.
 * Call this when the card is dismissed (Cancel or after Send success).
 */
export function closeCardState(): void {
  active = false;
}

/**
 * Returns true if a card is currently active.
 */
export function isCardActive(): boolean {
  return active;
}
