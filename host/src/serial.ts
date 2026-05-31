/**
 * Serial assignment + in-process promise-queue mutex.
 * D-03: All writes serialize through withSerialLock; no file-system locking needed.
 */

import { readdirSync } from 'node:fs';

// Module-level queue — forces all locked operations to execute sequentially.
let queue: Promise<void> = Promise.resolve();

/**
 * Execute `fn` exclusively — all concurrent callers queue behind the previous call.
 * A throwing `fn` does not poison the queue (errors are swallowed on the tail).
 */
export function withSerialLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  // Swallow errors on the queue tail so a failed write does not block future writes.
  queue = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * Scan `notesDir` for files matching /^\d{4}-/ (both *.md and *.read.md),
 * return max(serial) + 1. Returns 1 for an empty directory.
 * Must be called inside withSerialLock to avoid concurrent scan race (Pitfall 3).
 */
export function getNextSerial(notesDir: string): number {
  const files = readdirSync(notesDir);
  const serials = files
    .map(f => f.match(/^(\d{4})-/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => parseInt(m[1], 10));
  // IN-02: use reduce instead of spread to avoid call-stack limit on large dirs
  const max = serials.length > 0 ? serials.reduce((a, b) => Math.max(a, b), 0) : 0;
  return max + 1;
}
