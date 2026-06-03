/**
 * node:test unit tests for lib/pin-position.ts
 *
 * Covers:
 *   - matchesUrlPath: exact path match, query string ignored (D-02),
 *     subpath not matched, malformed URL returns false, empty strings return false
 *   - computePinPosition: element-anchored, free-floating, orphaned-fallback
 *     (pure DOM-free function — scroll offsets passed as params, never reads window)
 *
 * Zero chrome/DOM surface — pure functions tested with raw numbers.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchesUrlPath, computePinPosition } from '../pin-position.js';

// ---------------------------------------------------------------------------
// matchesUrlPath (D-02: exact path match, query ignored)
// ---------------------------------------------------------------------------

describe('matchesUrlPath', () => {
  test('same path, no query → true', () => {
    assert.strictEqual(
      matchesUrlPath('https://x.com/admin/users', 'https://x.com/admin/users'),
      true
    );
  });

  test('same path, different query → true (D-02 query ignored)', () => {
    assert.strictEqual(
      matchesUrlPath('https://x.com/admin/users', 'https://x.com/admin/users?tab=2'),
      true
    );
  });

  test('same path, note has query, page has different query → true', () => {
    assert.strictEqual(
      matchesUrlPath('https://x.com/admin/users?tab=1', 'https://x.com/admin/users?tab=2'),
      true
    );
  });

  test('different path (subpath) → false', () => {
    assert.strictEqual(
      matchesUrlPath('https://x.com/admin', 'https://x.com/admin/users'),
      false
    );
  });

  test('parent vs child → false (subpath not matched)', () => {
    assert.strictEqual(
      matchesUrlPath('https://x.com/admin/users', 'https://x.com/admin'),
      false
    );
  });

  test('completely different paths → false', () => {
    assert.strictEqual(
      matchesUrlPath('https://x.com/foo', 'https://x.com/bar'),
      false
    );
  });

  test('malformed URL (noteUrl) returns false, no throw', () => {
    assert.strictEqual(matchesUrlPath('not a url', 'https://x.com/foo'), false);
  });

  test('malformed URL (pageUrl) returns false, no throw', () => {
    assert.strictEqual(matchesUrlPath('https://x.com/foo', 'also not'), false);
  });

  test('both malformed → false (spec: matchesUrlPath("not a url","also not") → false)', () => {
    assert.strictEqual(matchesUrlPath('not a url', 'also not'), false);
  });

  test('empty strings return false', () => {
    assert.strictEqual(matchesUrlPath('', ''), false);
  });

  test('root path "/" matches "/" with different query', () => {
    assert.strictEqual(
      matchesUrlPath('https://x.com/', 'https://x.com/?sort=asc'),
      true
    );
  });
});

// ---------------------------------------------------------------------------
// computePinPosition (PIN-02/03 — pure DOM-free function)
// ---------------------------------------------------------------------------

describe('computePinPosition', () => {
  test('element-anchored: anchorRect non-null, !orphaned → uses anchorRect x/y directly', () => {
    // spec: computePinPosition({x:100,y:200,width:50,height:20}, null, 0, 0, false)
    //       → {left:100, top:200, orphaned:false}
    const result = computePinPosition(
      { x: 100, y: 200, width: 50, height: 20 },
      null,
      0,
      0,
      false
    );
    assert.deepStrictEqual(result, { left: 100, top: 200, orphaned: false });
  });

  test('free-floating: anchorRect with width/height=0, !orphaned → uses anchorRect x/y', () => {
    // spec: computePinPosition({x:32,y:88,width:0,height:0}, null, 0, 0, false)
    //       → {left:32, top:88, orphaned:false}
    const result = computePinPosition(
      { x: 32, y: 88, width: 0, height: 0 },
      null,
      0,
      0,
      false
    );
    assert.deepStrictEqual(result, { left: 32, top: 88, orphaned: false });
  });

  test('orphaned-fallback: anchorRect null, storedRect provided, scrollY=300 → left=400, top=900', () => {
    // spec: computePinPosition(null, {x:400,y:1200,width:60,height:30}, 0, 300, true)
    //       → {left:400, top:900, orphaned:true}
    const result = computePinPosition(
      null,
      { x: 400, y: 1200, width: 60, height: 30 },
      0,
      300,
      true
    );
    assert.deepStrictEqual(result, { left: 400, top: 900, orphaned: true });
  });

  test('orphaned: anchorRect null, no storedRect → fallback to {left:0,top:0,orphaned:true}', () => {
    const result = computePinPosition(null, null, 0, 0, true);
    assert.deepStrictEqual(result, { left: 0, top: 0, orphaned: true });
  });

  test('orphaned forced: anchorRect non-null but orphaned=true → storedRect path used', () => {
    // orphaned=true should use stored rect path even if anchorRect supplied
    const result = computePinPosition(
      { x: 100, y: 200, width: 50, height: 20 },
      { x: 300, y: 500, width: 50, height: 20 },
      0,
      100,
      true
    );
    assert.deepStrictEqual(result, { left: 300, top: 400, orphaned: true });
  });

  test('element-anchored with scroll: scroll offsets do NOT affect result (fixed-coord rect)', () => {
    // anchorRect is already fixed/viewport coords from getBoundingClientRect()
    // scrollX/scrollY are irrelevant for element-anchored non-orphaned pins
    const result = computePinPosition(
      { x: 50, y: 75, width: 100, height: 30 },
      null,
      500,
      300,
      false
    );
    assert.deepStrictEqual(result, { left: 50, top: 75, orphaned: false });
  });

  test('orphaned with scrollX offset: left = storedRect.x - scrollX', () => {
    const result = computePinPosition(
      null,
      { x: 800, y: 600, width: 40, height: 20 },
      200,
      150,
      true
    );
    assert.deepStrictEqual(result, { left: 600, top: 450, orphaned: true });
  });
});
