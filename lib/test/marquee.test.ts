/**
 * node:test unit tests for lib/marquee.ts
 *
 * Covers CAM-03: buildMarqueeRect normalizes any drag direction;
 * isBelowThreshold cancels sub-6px drags (both dims must be < MARQUEE_MIN_PX).
 *
 * Zero chrome/DOM surface — pure math functions, no mocks required.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarqueeRect, isBelowThreshold, MARQUEE_MIN_PX } from '../marquee.js';

// ---------------------------------------------------------------------------
// MARQUEE_MIN_PX constant
// ---------------------------------------------------------------------------

describe('MARQUEE_MIN_PX', () => {
  test('is 6 (CAM-03 threshold)', () => {
    assert.strictEqual(MARQUEE_MIN_PX, 6);
  });
});

// ---------------------------------------------------------------------------
// buildMarqueeRect
// ---------------------------------------------------------------------------

describe('buildMarqueeRect', () => {
  test('bottom-right drag direction: start(10,10) → end(20,20)', () => {
    assert.deepStrictEqual(
      buildMarqueeRect(10, 10, 20, 20),
      { x: 10, y: 10, width: 10, height: 10 }
    );
  });

  test('top-left drag direction: start(20,20) → end(4,4) normalizes', () => {
    assert.deepStrictEqual(
      buildMarqueeRect(20, 20, 4, 4),
      { x: 4, y: 4, width: 16, height: 16 }
    );
  });

  test('explicit test case: (10,10,4,4) → {x:4,y:4,width:6,height:6}', () => {
    assert.deepStrictEqual(
      buildMarqueeRect(10, 10, 4, 4),
      { x: 4, y: 4, width: 6, height: 6 }
    );
  });

  test('explicit test case: (4,4,10,10) → {x:4,y:4,width:6,height:6}', () => {
    assert.deepStrictEqual(
      buildMarqueeRect(4, 4, 10, 10),
      { x: 4, y: 4, width: 6, height: 6 }
    );
  });

  test('zero-size drag: (5,5,5,5) → {x:5,y:5,width:0,height:0}', () => {
    assert.deepStrictEqual(
      buildMarqueeRect(5, 5, 5, 5),
      { x: 5, y: 5, width: 0, height: 0 }
    );
  });

  test('fractional coords preserved: (1.5,2.5,4.5,6.5)', () => {
    assert.deepStrictEqual(
      buildMarqueeRect(1.5, 2.5, 4.5, 6.5),
      { x: 1.5, y: 2.5, width: 3, height: 4 }
    );
  });

  test('mixed directions: x forward, y backward', () => {
    assert.deepStrictEqual(
      buildMarqueeRect(10, 30, 20, 10),
      { x: 10, y: 10, width: 10, height: 20 }
    );
  });
});

// ---------------------------------------------------------------------------
// isBelowThreshold
// ---------------------------------------------------------------------------

describe('isBelowThreshold', () => {
  test('returns true when both dims < MARQUEE_MIN_PX (5 < 6)', () => {
    assert.strictEqual(isBelowThreshold({ width: 5, height: 5 }), true);
  });

  test('returns false when width >= MARQUEE_MIN_PX (spec: {width:6,height:1} → false)', () => {
    assert.strictEqual(isBelowThreshold({ width: 6, height: 1 }), false);
  });

  test('returns false when height >= MARQUEE_MIN_PX (spec: {width:1,height:6} → false)', () => {
    assert.strictEqual(isBelowThreshold({ width: 1, height: 6 }), false);
  });

  test('returns true when both dims are 0', () => {
    assert.strictEqual(isBelowThreshold({ width: 0, height: 0 }), true);
  });

  test('returns false when both dims == MARQUEE_MIN_PX (6,6) — boundary inclusive means not below', () => {
    assert.strictEqual(isBelowThreshold({ width: 6, height: 6 }), false);
  });

  test('returns true when width=5,height=0 (both < 6)', () => {
    assert.strictEqual(isBelowThreshold({ width: 5, height: 0 }), true);
  });

  test('returns true when width=0,height=5 (both < 6)', () => {
    assert.strictEqual(isBelowThreshold({ width: 0, height: 5 }), true);
  });
});
