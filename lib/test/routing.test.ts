/**
 * node:test unit tests for lib/routing.ts
 *
 * Covers EXT-06 (advertised-origin step 1 beats originMap step 2),
 * EXT-07 (originMap entry routes when nothing advertises),
 * EXT-08 (null return for unmapped origin — triggers dropdown),
 * EXT-10 (reconcileRegistry: port update + token preservation,
 *          new-host add, stale-host retention).
 *
 * Zero chrome API surface — runs with plain node:test.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoute, reconcileRegistry } from '../routing.js';
import type { HostEntry, StorageState } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(override: Partial<HostEntry> & { name: string; port: number }): HostEntry {
  return {
    origins: [],
    notesDir: '/notes',
    token: null,
    ...override,
  };
}

function makeState(
  registry: Record<string, HostEntry>,
  tokens: Record<string, string> = {},
  originMap: Record<string, string> = {}
): StorageState {
  return {
    registry,
    tokens,
    originMap,
    prefs: { reviewMode: {}, showHints: true },
  };
}

// ---------------------------------------------------------------------------
// resolveRoute — EXT-06: advertised origin (step 1) beats originMap (step 2)
// ---------------------------------------------------------------------------

describe('resolveRoute', () => {
  test('step 1: returns host that advertises the origin (EXT-06)', () => {
    const host = makeEntry({
      name: 'proj-a',
      port: 39240,
      origins: ['https://example.com'],
    });
    const state = makeState({ 'proj-a': host });
    const result = resolveRoute('https://example.com', state);
    assert.ok(result, 'expected a HostEntry, got null');
    assert.strictEqual(result.name, 'proj-a');
  });

  test('step 1 wins over step 2 when both could match (EXT-06)', () => {
    // Two hosts: "proj-a" advertises the origin; "proj-b" is mapped via originMap.
    // Step 1 must win.
    const hostA = makeEntry({
      name: 'proj-a',
      port: 39240,
      origins: ['https://example.com'],
    });
    const hostB = makeEntry({ name: 'proj-b', port: 39241 });
    const state = makeState(
      { 'proj-a': hostA, 'proj-b': hostB },
      {},
      { 'https://example.com': 'proj-b' } // conflicting originMap entry
    );
    const result = resolveRoute('https://example.com', state);
    assert.ok(result);
    assert.strictEqual(result.name, 'proj-a', 'step 1 (advertised) must beat step 2 (originMap)');
  });

  // -------------------------------------------------------------------------
  // resolveRoute — EXT-07: originMap routes when nothing advertises
  // -------------------------------------------------------------------------

  test('step 2: routes via originMap when no host advertises origin (EXT-07)', () => {
    const host = makeEntry({ name: 'proj-b', port: 39241 });
    const state = makeState(
      { 'proj-b': host },
      {},
      { 'https://other.com': 'proj-b' }
    );
    const result = resolveRoute('https://other.com', state);
    assert.ok(result);
    assert.strictEqual(result.name, 'proj-b');
  });

  test('step 2: returns null if originMap name does not match any registry entry', () => {
    const state = makeState(
      {},
      {},
      { 'https://other.com': 'ghost-project' }
    );
    const result = resolveRoute('https://other.com', state);
    assert.strictEqual(result, null, 'ghost name in originMap should not match');
  });

  // -------------------------------------------------------------------------
  // resolveRoute — EXT-08: returns null for fully unmapped origin
  // -------------------------------------------------------------------------

  test('returns null for unmapped origin with 2+ hosts (EXT-08 dropdown trigger)', () => {
    // Dropdown only triggers when the choice is AMBIGUOUS (2+ known hosts and
    // none advertise/map the origin). With a single host, step 2.5 auto-selects.
    const hostA = makeEntry({ name: 'proj-a', port: 39240, origins: ['https://advertised.com'] });
    const hostB = makeEntry({ name: 'proj-b', port: 39241 });
    const state = makeState({ 'proj-a': hostA, 'proj-b': hostB });
    const result = resolveRoute('https://completely-unknown.com', state);
    assert.strictEqual(result, null, '2+ hosts, no match → null (dropdown), not throw');
  });

  test('step 2.5: single known host auto-selects for an unmapped origin', () => {
    const host = makeEntry({ name: 'only-proj', port: 39240 });
    const state = makeState({ 'only-proj': host }, { 'only-proj': 'tok-1' });
    const result = resolveRoute('https://brand-new-origin.com', state);
    assert.ok(result, 'single host should auto-select, not return null');
    assert.strictEqual(result.name, 'only-proj');
    assert.strictEqual(result.token, 'tok-1', 'auto-selected host carries its token');
  });

  test('returns null for empty registry + empty originMap', () => {
    const state = makeState({});
    assert.strictEqual(resolveRoute('https://anything.com', state), null);
  });

  // -------------------------------------------------------------------------
  // Token resolution
  // -------------------------------------------------------------------------

  test('returned entry carries token from tokens map (not stale registry token)', () => {
    const host = makeEntry({
      name: 'proj-a',
      port: 39240,
      origins: ['https://example.com'],
      token: 'stale-token',
    });
    const state = makeState(
      { 'proj-a': host },
      { 'proj-a': 'live-token' }
    );
    const result = resolveRoute('https://example.com', state);
    assert.ok(result);
    assert.strictEqual(result.token, 'live-token');
  });

  test('returned entry carries null token when tokens map is empty', () => {
    const host = makeEntry({ name: 'proj-a', port: 39240, origins: ['https://example.com'] });
    const state = makeState({ 'proj-a': host });
    const result = resolveRoute('https://example.com', state);
    assert.ok(result);
    assert.strictEqual(result.token, null);
  });
});

// ---------------------------------------------------------------------------
// reconcileRegistry — EXT-10
// ---------------------------------------------------------------------------

describe('reconcileRegistry', () => {
  test('updates port for same-name host but preserves token (EXT-10)', () => {
    const persisted: Record<string, HostEntry> = {
      'proj-a': makeEntry({ name: 'proj-a', port: 39240, token: null }),
    };
    const tokens = { 'proj-a': 'user-token' };
    const discovered: HostEntry[] = [
      makeEntry({ name: 'proj-a', port: 39250 }), // restarted on new port
    ];

    const result = reconcileRegistry(persisted, discovered, tokens);

    assert.strictEqual(result['proj-a'].port, 39250, 'port must be updated');
    assert.strictEqual(result['proj-a'].token, 'user-token', 'token must be preserved');
  });

  test('adds brand-new discovered host', () => {
    const persisted: Record<string, HostEntry> = {
      'proj-a': makeEntry({ name: 'proj-a', port: 39240 }),
    };
    const discovered: HostEntry[] = [
      makeEntry({ name: 'proj-a', port: 39240 }),
      makeEntry({ name: 'proj-b', port: 39241 }), // new
    ];

    const result = reconcileRegistry(persisted, discovered, {});

    assert.ok('proj-b' in result, 'new host must be added');
    assert.strictEqual(result['proj-b'].port, 39241);
  });

  test('keeps stale (offline) host from persisted registry — does not evict (EXT-10)', () => {
    const persisted: Record<string, HostEntry> = {
      'proj-a': makeEntry({ name: 'proj-a', port: 39240 }),
      'proj-offline': makeEntry({ name: 'proj-offline', port: 39245 }),
    };
    const discovered: HostEntry[] = [
      makeEntry({ name: 'proj-a', port: 39240 }), // only proj-a is online
    ];

    const result = reconcileRegistry(persisted, discovered, {});

    assert.ok('proj-offline' in result, 'stale host must be retained (not evicted)');
  });

  test('token from tokens map beats token in persisted registry entry', () => {
    const persisted: Record<string, HostEntry> = {
      'proj-a': makeEntry({ name: 'proj-a', port: 39240, token: 'old-token' }),
    };
    const tokens = { 'proj-a': 'current-token' };
    const discovered: HostEntry[] = [
      makeEntry({ name: 'proj-a', port: 39240 }),
    ];

    const result = reconcileRegistry(persisted, discovered, tokens);
    assert.strictEqual(result['proj-a'].token, 'current-token');
  });

  test('null token for brand-new host with no entry in tokens map', () => {
    const persisted: Record<string, HostEntry> = {};
    const discovered: HostEntry[] = [
      makeEntry({ name: 'proj-new', port: 39242 }),
    ];

    const result = reconcileRegistry(persisted, discovered, {});
    assert.strictEqual(result['proj-new'].token, null);
  });
});
