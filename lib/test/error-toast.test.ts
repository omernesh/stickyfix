/**
 * node:test unit tests for lib/error-toast.ts
 *
 * Asserts verbatim D-01a toast strings for every SendOutcome kind.
 * Zero chrome/DOM surface — pure transform, no mocks required.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mapSendOutcome } from '../error-toast.js';

// ---------------------------------------------------------------------------
// channel-dead outcome
// ---------------------------------------------------------------------------

describe('mapSendOutcome — channel-dead', () => {
  test('with lastErrorMessage "boom" -> Extension error: boom', () => {
    const spec = mapSendOutcome({ kind: 'channel-dead', lastErrorMessage: 'boom' });
    assert.strictEqual(spec.message, 'Extension error: boom');
    assert.strictEqual(spec.isError, true);
  });

  test('without lastErrorMessage -> Extension error: no response (verbatim D-01a)', () => {
    const spec = mapSendOutcome({ kind: 'channel-dead' });
    assert.strictEqual(spec.message, 'Extension error: no response');
    assert.strictEqual(spec.isError, true);
  });

  test('with undefined lastErrorMessage -> Extension error: no response', () => {
    const spec = mapSendOutcome({ kind: 'channel-dead', lastErrorMessage: undefined });
    assert.strictEqual(spec.message, 'Extension error: no response');
    assert.strictEqual(spec.isError, true);
  });
});

// ---------------------------------------------------------------------------
// relay-error outcome
// ---------------------------------------------------------------------------

describe('mapSendOutcome — relay-error', () => {
  test('passes error string through unchanged: "unauthorized"', () => {
    const spec = mapSendOutcome({ kind: 'relay-error', error: 'unauthorized' });
    assert.strictEqual(spec.message, 'unauthorized');
    assert.strictEqual(spec.isError, true);
  });

  test('passes long error string verbatim: "Host unreachable: TypeError: fetch failed"', () => {
    const spec = mapSendOutcome({ kind: 'relay-error', error: 'Host unreachable: TypeError: fetch failed' });
    assert.strictEqual(spec.message, 'Host unreachable: TypeError: fetch failed');
    assert.strictEqual(spec.isError, true);
  });
});

// ---------------------------------------------------------------------------
// ok outcome — single backslash at runtime (CRITICAL: do NOT normalize to /)
// ---------------------------------------------------------------------------

describe('mapSendOutcome — ok', () => {
  test('success: wrote notes\\<file> with SINGLE backslash at runtime (D-01a)', () => {
    const spec = mapSendOutcome({ kind: 'ok', file: '0001-20260603-101010.md' });
    // TS literal 'wrote notes\\...' == runtime string 'wrote notes\...' (one backslash)
    assert.strictEqual(spec.message, 'wrote notes\\0001-20260603-101010.md');
    assert.strictEqual(spec.isError, false);
  });

  test('ok isError is false', () => {
    const spec = mapSendOutcome({ kind: 'ok', file: 'test.md' });
    assert.strictEqual(spec.isError, false);
  });
});
