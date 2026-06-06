/**
 * SC-3 / ONB-03 security proof — Plan 09-04.
 *
 * Proves a scripted web origin can neither reach the native channel nor obtain
 * the token over HTTP, and that the Phase 8 token gate is intact after pairing:
 *
 *  (1) GET /token → 404 and GET /pair → 404 — the token is NEVER on an HTTP
 *      surface (no such routes exist).
 *  (2) GET /status → 200 and the body does NOT contain the token (handleStatus
 *      omits cfg.token).
 *  (3) POST /annotation with NO token → 401; with a WRONG token → 401 (Phase 8
 *      token-gate regression guard — pairing did not weaken auth).
 *  (4) buildManifest pins allowed_origins to exactly the supplied extension ID
 *      and rejects any other/malformed ID — only the pinned extension would be
 *      authorized by Chrome's native-messaging gate (structural rejection).
 *  (5) Source-grep: connectNative / sendNativeMessage do NOT appear under
 *      entrypoints/review.content/ — content scripts cannot reach the native
 *      channel (ONB-03 checklist item).
 *
 * Harness mirrors host/test/server.test.ts (createHostServer on an ephemeral
 * port via server.listen(0, '127.0.0.1')).
 */

import { describe, before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type * as http from 'node:http';
import { createHostServer } from '../src/server.js';
import { resolveConfig, ensureNotesDir } from '../src/config.js';
import { buildManifest } from '../src/bootstrap/register.js';
import type { Config } from '../src/types.js';

// ---------------------------------------------------------------------------
// Test fixture (createHostServer on an ephemeral port — server.test.ts shape)
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'sc3-secret-token-do-not-leak-0123456789';

interface TestFixture {
  cfg: Config;
  server: http.Server;
  baseUrl: string;
  tmpRoot: string;
}

function buildFixture(): TestFixture {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'sfx-sc3-test-'));
  const cfg = resolveConfig({ root: tmpRoot, token: TEST_TOKEN });
  ensureNotesDir(cfg.notesDir);
  const server = createHostServer(cfg);
  return { cfg, server, baseUrl: '', tmpRoot };
}

function listenFixture(fixture: TestFixture): Promise<string> {
  return new Promise((resolve, reject) => {
    fixture.server.once('error', reject);
    fixture.server.listen(0, '127.0.0.1', () => {
      const addr = fixture.server.address() as AddressInfo;
      fixture.baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve(fixture.baseUrl);
    });
  });
}

function closeFixture(fixture: TestFixture): Promise<void> {
  return new Promise((resolve, reject) => {
    fixture.server.close((err) => {
      rmSync(fixture.tmpRoot, { recursive: true, force: true });
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// (1)+(2)+(3) HTTP surface — no token endpoint, /status token-free, gate intact
// ---------------------------------------------------------------------------

describe('SC-3 / ONB-03 — token is unreachable over HTTP, gate intact', () => {
  let fx: TestFixture;

  before(async () => {
    fx = buildFixture();
    await listenFixture(fx);
  });

  after(async () => {
    await closeFixture(fx);
  });

  // (1) No /token or /pair route exists — the token is never on an HTTP surface.
  it('GET /token → 404 (no token-fetch endpoint exists)', async () => {
    const res = await fetch(`${fx.baseUrl}/token`);
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.ok(!body.includes(TEST_TOKEN), '/token 404 body must not leak the token');
  });

  it('GET /pair → 404 (no pairing endpoint exists)', async () => {
    const res = await fetch(`${fx.baseUrl}/pair`);
    assert.equal(res.status, 404);
    const body = await res.text();
    assert.ok(!body.includes(TEST_TOKEN), '/pair 404 body must not leak the token');
  });

  // (2) /status reveals identity but NEVER the token (handleStatus omits cfg.token).
  it('GET /status → 200 and the body does NOT contain the token', async () => {
    const res = await fetch(`${fx.baseUrl}/status`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(TEST_TOKEN), '/status body must not contain the token value');
    // Sanity: it IS the stickyfix status payload (so we proved the right surface)
    const json = JSON.parse(text) as Record<string, unknown>;
    assert.equal(json.app, 'stickyfix');
    assert.ok(!('token' in json), '/status JSON must have no token field');
  });

  // (3) Phase 8 token-gate regression — pairing did not weaken auth.
  it('POST /annotation with NO token → 401', async () => {
    const res = await fetch(`${fx.baseUrl}/annotation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'free', comment: 'x' }),
    });
    assert.equal(res.status, 401);
  });

  it('POST /annotation with a WRONG token → 401', async () => {
    const res = await fetch(`${fx.baseUrl}/annotation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': 'this-is-not-the-token',
      },
      body: JSON.stringify({ mode: 'free', comment: 'x' }),
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// (4) Native-messaging allowed_origins gate (pure, no Chrome)
// ---------------------------------------------------------------------------

describe('SC-3 / ONB-03 — buildManifest pins allowed_origins to the extension ID', () => {
  // A valid Chrome extension ID is exactly 32 lowercase a-p chars.
  const VALID_ID = 'abcdefghijklmnopabcdefghijklmnop';
  const HOSTILE_ID = 'ponmlkjihgfedcbaponmlkjihgfedcba';

  it('allowed_origins is exactly [chrome-extension://<id>/] for the pinned ID', () => {
    const manifest = buildManifest(VALID_ID, '/abs/path/native-host.cjs') as {
      allowed_origins: string[];
    };
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${VALID_ID}/`]);
  });

  it('a hostile chrome-extension://<other-id>/ is NOT in allowed_origins (structural rejection)', () => {
    const manifest = buildManifest(VALID_ID, '/abs/path/native-host.cjs') as {
      allowed_origins: string[];
    };
    assert.ok(
      !manifest.allowed_origins.includes(`chrome-extension://${HOSTILE_ID}/`),
      'only the pinned extension ID may be authorized by Chrome'
    );
  });

  it('buildManifest rejects malformed extension IDs', () => {
    // Too short
    assert.throws(() => buildManifest('abc', '/x.cjs'), /Invalid extension ID/);
    // Wrong alphabet (z is outside a-p)
    assert.throws(
      () => buildManifest('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', '/x.cjs'),
      /Invalid extension ID/
    );
    // Uppercase not allowed
    assert.throws(
      () => buildManifest('ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP', '/x.cjs'),
      /Invalid extension ID/
    );
    // Wrong length (33)
    assert.throws(
      () => buildManifest('abcdefghijklmnopabcdefghijklmnopa', '/x.cjs'),
      /Invalid extension ID/
    );
  });
});

// ---------------------------------------------------------------------------
// (5) Source-grep — no native-messaging API under entrypoints/review.content/
// ---------------------------------------------------------------------------

describe('SC-3 / ONB-03 — content scripts cannot reach the native channel', () => {
  // Resolve the repo root from this compiled test file:
  // dist/host/test/security-pairing.test.js → ../../../ = repo root
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const reviewDir = join(repoRoot, 'entrypoints', 'review.content');

  function listTsFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && (d.name.endsWith('.ts') || d.name.endsWith('.js')))
      .map((d) => join(dir, d.name));
  }

  it('no connectNative / sendNativeMessage call appears under entrypoints/review.content/', () => {
    const files = listTsFiles(reviewDir);
    assert.ok(files.length > 0, 'expected source files under entrypoints/review.content/');

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (/connectNative\s*\(/.test(src) || /sendNativeMessage\s*\(/.test(src)) {
        offenders.push(file);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `native-messaging API must NOT appear in content scripts; found in: ${offenders.join(', ')}`
    );
  });
});
