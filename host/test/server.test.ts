/**
 * Integration tests for stickyfix-host server.ts.
 * Covers HOST-01..05, HOST-10 (status, token gate, write-to-disk, CORS preflight, 127.0.0.1 binding).
 * Pattern 12: uses node:test lifecycle hooks, node:assert/strict.
 * Research Validation Architecture: HOST-04, HOST-05, HOST-10 coverage via real bound server.
 */

import { describe, before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createHostServer } from '../src/server.js';
import { resolveConfig, ensureNotesDir } from '../src/config.js';
import type { Config } from '../src/types.js';
import type * as http from 'node:http';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'test-token-fixed-abcdef1234567890';

interface TestFixture {
  cfg: Config;
  server: http.Server;
  baseUrl: string;
  tmpRoot: string;
}

function buildFixture(): TestFixture {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'sfx-server-test-'));
  const cfg = resolveConfig({
    root: tmpRoot,
    token: TEST_TOKEN,
  });
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
// Test suite
// ---------------------------------------------------------------------------

describe('stickyfix-host server integration', () => {
  let fixture: TestFixture;

  before(async () => {
    fixture = buildFixture();
    await listenFixture(fixture);
  });

  after(async () => {
    await closeFixture(fixture);
  });

  // -------------------------------------------------------------------------
  // T-02-bind: 127.0.0.1 only (HOST-02 / acceptance #10)
  // -------------------------------------------------------------------------
  it('server.address().address is 127.0.0.1', () => {
    const addr = fixture.server.address() as AddressInfo;
    assert.equal(addr.address, '127.0.0.1');
  });

  // -------------------------------------------------------------------------
  // GET /status (HOST-04, D-06)
  // -------------------------------------------------------------------------
  it('GET /status returns 200 with correct shape and no token', async () => {
    const res = await fetch(`${fixture.baseUrl}/status`);
    assert.equal(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['app'], 'stickyfix');
    assert.equal(typeof body['version'], 'string');
    assert.equal(body['name'], fixture.cfg.name);
    assert.equal(body['notesDir'], fixture.cfg.notesDir);
    assert.deepEqual(body['origins'], fixture.cfg.origins);

    // T-02-info-status: token must NOT appear in /status response
    assert.equal(body['token'], undefined);
  });

  // -------------------------------------------------------------------------
  // POST /annotation — no token (HOST-05)
  // -------------------------------------------------------------------------
  it('POST /annotation without token returns 401 {ok:false}', async () => {
    const res = await fetch(`${fixture.baseUrl}/annotation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'free', comment: 'test' }),
    });
    assert.equal(res.status, 401);

    const body = await res.json() as Record<string, unknown>;
    assert.equal(body['ok'], false);
    assert.equal(typeof body['error'], 'string');
  });

  // -------------------------------------------------------------------------
  // POST /annotation — wrong token (HOST-05)
  // -------------------------------------------------------------------------
  it('POST /annotation with wrong token returns 401', async () => {
    const res = await fetch(`${fixture.baseUrl}/annotation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': 'wrong-token-value-that-does-not-match',
      },
      body: JSON.stringify({ mode: 'free', comment: 'test' }),
    });
    assert.equal(res.status, 401);
  });

  // -------------------------------------------------------------------------
  // POST /annotation — valid token + free-mode payload writes .md (HOST-07)
  // -------------------------------------------------------------------------
  it('POST /annotation with valid token writes .md file and returns {ok:true,file,serial}', async () => {
    const payload = {
      mode: 'free',
      comment: 'Integration test note',
      page: {
        url: 'http://localhost:5173/test',
        title: 'Test Page',
      },
      viewport: {
        width: 1280,
        height: 800,
        devicePixelRatio: 1,
      },
    };

    const res = await fetch(`${fixture.baseUrl}/annotation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': TEST_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);

    const body = await res.json() as { ok: boolean; file: string; serial: string };
    assert.equal(body.ok, true);
    assert.equal(typeof body.file, 'string');
    assert.equal(typeof body.serial, 'string');

    // Verify the .md file was actually written to disk (HOST-07)
    assert.ok(existsSync(body.file), `Expected .md file to exist at: ${body.file}`);
  });

  // -------------------------------------------------------------------------
  // OPTIONS preflight (HOST-10, D-05)
  // -------------------------------------------------------------------------
  it('OPTIONS /annotation returns 204 with CORS headers echoing Origin', async () => {
    const testOrigin = 'http://localhost:5173';
    const res = await fetch(`${fixture.baseUrl}/annotation`, {
      method: 'OPTIONS',
      headers: {
        'Origin': testOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-Stickyfix-Token',
      },
    });

    assert.equal(res.status, 204);

    // CORS echo-origin (Pattern 4)
    assert.equal(res.headers.get('access-control-allow-origin'), testOrigin);

    // Must allow the token header
    const allowedHeaders = res.headers.get('access-control-allow-headers') ?? '';
    assert.ok(
      allowedHeaders.toLowerCase().includes('x-stickyfix-token'),
      `Expected Access-Control-Allow-Headers to include X-Stickyfix-Token, got: ${allowedHeaders}`
    );
  });

  // -------------------------------------------------------------------------
  // CORS headers on error responses (T-02-cors-readable / Pitfall 6)
  // -------------------------------------------------------------------------
  it('401 response includes CORS Allow-Origin header so browser can read error body', async () => {
    const testOrigin = 'http://localhost:5173';
    const res = await fetch(`${fixture.baseUrl}/annotation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': testOrigin,
      },
      body: JSON.stringify({ mode: 'free', comment: 'test' }),
    });

    assert.equal(res.status, 401);
    assert.equal(res.headers.get('access-control-allow-origin'), testOrigin);
  });

  // -------------------------------------------------------------------------
  // POST /annotation — malformed JSON -> 400
  // -------------------------------------------------------------------------
  it('POST /annotation with malformed JSON returns 400', async () => {
    const res = await fetch(`${fixture.baseUrl}/annotation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': TEST_TOKEN,
      },
      body: 'this is not json {{{',
    });

    assert.equal(res.status, 400);
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, false);
  });

  // -------------------------------------------------------------------------
  // Unknown route -> 404
  // -------------------------------------------------------------------------
  it('GET /unknown returns 404 {ok:false}', async () => {
    const res = await fetch(`${fixture.baseUrl}/unknown`);
    assert.equal(res.status, 404);
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, false);
  });
});
