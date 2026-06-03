/**
 * node:test unit tests for lib/payload-size.ts
 *
 * Asserts boundary behaviour of exceedsBodyCap against the host 12 MB cap.
 * Uses 'x'.repeat(n) for ASCII strings where encoded length === string length.
 * Zero chrome/DOM surface — pure transform, no mocks required.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BODY_BYTES, encodedBodyBytes, exceedsBodyCap } from '../payload-size.js';

// ---------------------------------------------------------------------------
// MAX_BODY_BYTES constant
// ---------------------------------------------------------------------------

describe('MAX_BODY_BYTES', () => {
  test('equals 12582912 (12 * 1024 * 1024 — mirroring host/src/security.ts:12)', () => {
    assert.strictEqual(MAX_BODY_BYTES, 12 * 1024 * 1024);
    assert.strictEqual(MAX_BODY_BYTES, 12582912);
  });
});

// ---------------------------------------------------------------------------
// encodedBodyBytes — UTF-8 byte count via TextEncoder
// ---------------------------------------------------------------------------

describe('encodedBodyBytes', () => {
  test('"abc" encodes to 3 bytes (ASCII single-byte)', () => {
    assert.strictEqual(encodedBodyBytes('abc'), 3);
  });

  test('empty string encodes to 0 bytes', () => {
    assert.strictEqual(encodedBodyBytes(''), 0);
  });
});

// ---------------------------------------------------------------------------
// exceedsBodyCap — boundary assertions (host rejects on strict > MAX_BODY_BYTES)
// ---------------------------------------------------------------------------

describe('exceedsBodyCap', () => {
  test('11.9 MB body (ASCII) -> false (well under cap)', () => {
    // ~11.9 MB = 12,479,488 bytes < 12,582,912
    const body = 'x'.repeat(Math.floor(11.9 * 1024 * 1024));
    assert.strictEqual(exceedsBodyCap(body), false);
  });

  test('exact boundary: length === MAX_BODY_BYTES -> false (host accepts; strict > rejects OVER)', () => {
    // Host rejects on > MAX_BODY_BYTES, so the exact boundary value must be accepted.
    const body = 'x'.repeat(MAX_BODY_BYTES);
    assert.strictEqual(exceedsBodyCap(body), false);
  });

  test('MAX_BODY_BYTES + 1 bytes -> true (one byte over cap)', () => {
    const body = 'x'.repeat(MAX_BODY_BYTES + 1);
    assert.strictEqual(exceedsBodyCap(body), true);
  });
});
