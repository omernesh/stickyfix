/**
 * Integration tests for stickyfix-host server.ts.
 * Covers HOST-01..05, HOST-10 (status, token gate, write-to-disk, CORS preflight, 127.0.0.1 binding).
 * Phase 6 extension: HOST-14/15/16 (GET /annotations, PUT /annotation/<serial>, DELETE /annotation/<serial>).
 * Pattern 12: uses node:test lifecycle hooks, node:assert/strict.
 * Research Validation Architecture: HOST-04, HOST-05, HOST-10 coverage via real bound server.
 */

import { describe, before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
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

  // -------------------------------------------------------------------------
  // WR-02: missing required payload fields → 400 {ok:false,error:'invalid payload'}
  // -------------------------------------------------------------------------
  it('WR-02: POST /annotation with empty body {} and valid token returns 400 invalid payload', async () => {
    const { readdirSync } = await import('node:fs');
    const beforeFiles = readdirSync(fixture.cfg.notesDir);

    const res = await fetch(`${fixture.baseUrl}/annotation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': TEST_TOKEN,
      },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const body = await res.json() as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, 'invalid payload');

    // No files should be written
    const afterFiles = readdirSync(fixture.cfg.notesDir);
    assert.deepEqual(afterFiles.sort(), beforeFiles.sort(), 'No files should be created for invalid payload (WR-02)');
  });

  // -------------------------------------------------------------------------
  // CR-02 regression: bad screenshot dataUrl → 400, NO partial on-disk state
  // -------------------------------------------------------------------------
  it('CR-02: POST /annotation with non-PNG screenshot dataUrl returns 400 and leaves no .md or .png on disk', async () => {
    const { readdirSync } = await import('node:fs');

    // Snapshot files already in notesDir before the request
    const beforeFiles = readdirSync(fixture.cfg.notesDir);

    const res = await fetch(`${fixture.baseUrl}/annotation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': TEST_TOKEN,
      },
      body: JSON.stringify({
        mode: 'free',
        comment: 'bad screenshot test',
        page: { url: 'http://localhost:5173/', title: 'Test' },
        viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
        screenshots: [
          // dataUrl lacks the data:image/png;base64, prefix → should fail with 400
          { kind: 'page', mime: 'image/png', dataUrl: 'data:image/jpeg;base64,/9j/abc123' },
        ],
      }),
    });

    // Must be 400, not 500
    assert.equal(res.status, 400);
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, false);

    // No new files must have been written to notesDir
    const afterFiles = readdirSync(fixture.cfg.notesDir);
    assert.deepEqual(
      afterFiles.sort(),
      beforeFiles.sort(),
      'No files should be created in notesDir on a bad-screenshot request (CR-02)'
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 6: GET /annotations, PUT /annotation/<serial>, DELETE /annotation/<serial>
// HOST-14, HOST-15, HOST-16
// ---------------------------------------------------------------------------

/** Build a minimal frontmatter .md fixture */
function writeMdFixture(
  notesDir: string,
  filename: string,
  fm: Record<string, string | number | string[]>,
  body: string
): void {
  const fmLines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      fmLines.push(`${k}: []`);
    } else if (typeof v === 'number') {
      fmLines.push(`${k}: ${v}`);
    } else {
      fmLines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  fmLines.push('---');
  const content = fmLines.join('\n') + '\n' + body + '\n';
  writeFileSync(join(notesDir, filename), content, 'utf8');
}

describe('Phase 6: GET /annotations route (HOST-14)', () => {
  let fixture: TestFixture;

  before(async () => {
    fixture = buildFixture();
    await listenFixture(fixture);

    // Seed two notes: one matching, one not
    writeMdFixture(
      fixture.cfg.notesDir,
      '0001-20260603-100000.md',
      {
        id: 1, mode: 'free', url: 'http://localhost:5173/page',
        status: 'unread', screenshots: [],
      },
      'Free note text'
    );
    writeMdFixture(
      fixture.cfg.notesDir,
      '0002-20260603-100000.md',
      {
        id: 2, mode: 'element', url: 'http://localhost:5173/other',
        status: 'unread', screenshots: [],
      },
      'Other page note'
    );
  });

  after(async () => { await closeFixture(fixture); });

  it('GET /annotations without token returns 401 (T-06-04)', async () => {
    const res = await fetch(`${fixture.baseUrl}/annotations?url=${encodeURIComponent('http://localhost:5173/page')}`);
    assert.equal(res.status, 401);
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, false);
  });

  it('GET /annotations with valid token returns 200 and JSON array (HOST-14)', async () => {
    const pageUrl = 'http://localhost:5173/page';
    const res = await fetch(`${fixture.baseUrl}/annotations?url=${encodeURIComponent(pageUrl)}`, {
      headers: { 'X-Stickyfix-Token': TEST_TOKEN },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; pins: unknown[] };
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.pins), 'pins should be an array');
    assert.equal(body.pins.length, 1, 'should return only path-matching notes');
  });

  it('GET /annotations includes CORS headers on 200 response', async () => {
    const pageUrl = 'http://localhost:5173/page';
    const res = await fetch(`${fixture.baseUrl}/annotations?url=${encodeURIComponent(pageUrl)}`, {
      headers: { 'X-Stickyfix-Token': TEST_TOKEN, 'Origin': 'http://localhost:5173' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('access-control-allow-origin'), 'should have CORS header');
  });

  it('OPTIONS preflight includes PUT and DELETE in Access-Control-Allow-Methods (Pitfall 4)', async () => {
    const res = await fetch(`${fixture.baseUrl}/annotations`, {
      method: 'OPTIONS',
      headers: { 'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(res.status, 204);
    const methods = res.headers.get('access-control-allow-methods') ?? '';
    assert.ok(methods.includes('PUT'), `Expected PUT in Allow-Methods, got: ${methods}`);
    assert.ok(methods.includes('DELETE'), `Expected DELETE in Allow-Methods, got: ${methods}`);
  });
});

describe('Phase 6: PUT /annotation/<serial> route (HOST-15)', () => {
  let fixture: TestFixture;

  before(async () => {
    fixture = buildFixture();
    await listenFixture(fixture);

    // Seed a note to edit
    writeMdFixture(
      fixture.cfg.notesDir,
      '0001-20260603-100000.md',
      {
        id: 1, mode: 'free', url: 'http://localhost:5173/page',
        status: 'read', screenshots: [],
      },
      'Original comment'
    );
  });

  after(async () => { await closeFixture(fixture); });

  it('PUT /annotation/<serial> without token returns 401', async () => {
    const res = await fetch(`${fixture.baseUrl}/annotation/0001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'New text' }),
    });
    assert.equal(res.status, 401);
  });

  it('PUT /annotation/<serial> with unknown serial returns 404', async () => {
    const res = await fetch(`${fixture.baseUrl}/annotation/9999`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': TEST_TOKEN,
      },
      body: JSON.stringify({ comment: 'new text' }),
    });
    assert.equal(res.status, 404);
  });

  it('PUT /annotation/<serial> with valid token + body returns 200 and updates file', async () => {
    const newComment = 'Updated comment text for the note';
    const res = await fetch(`${fixture.baseUrl}/annotation/0001`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': TEST_TOKEN,
      },
      body: JSON.stringify({ comment: newComment }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, true);

    // Verify file was updated
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(join(fixture.cfg.notesDir, '0001-20260603-100000.md'), 'utf8');
    assert.ok(content.includes(newComment), 'file body should contain the new comment');
    assert.ok(content.includes('status: unread'), 'status should be re-marked unread');
  });

  it('PUT /annotation/<serial> with >12MB body is rejected (HOST-11/T-06-03)', async () => {
    // A >12MB body must be rejected. The host calls req.destroy() which may reset the
    // TCP connection before the 413 response is readable by the client — either outcome
    // (413 status OR connection reset error) proves the payload was rejected.
    const bigBody = JSON.stringify({ comment: 'x'.repeat(13 * 1024 * 1024) });
    let status: number | null = null;
    try {
      const res = await fetch(`${fixture.baseUrl}/annotation/0001`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Stickyfix-Token': TEST_TOKEN,
        },
        body: bigBody,
      });
      status = res.status;
    } catch {
      // Connection reset (ECONNRESET) — req.destroy() closed the socket. This is
      // acceptable: the request was rejected. status remains null.
    }
    // If we got a response, it must be 413
    if (status !== null) {
      assert.equal(status, 413, `Expected 413 for oversized body, got ${status}`);
    }
    // If status is null, the connection was reset — payload was rejected (acceptable)
  });
});

describe('Phase 6: DELETE /annotation/<serial> route (HOST-16)', () => {
  let fixture: TestFixture;

  before(async () => {
    fixture = buildFixture();
    await listenFixture(fixture);

    // Seed a note to delete
    writeMdFixture(
      fixture.cfg.notesDir,
      '0001-20260603-100000.md',
      {
        id: 1, mode: 'free', url: 'http://localhost:5173/page',
        status: 'unread', screenshots: [],
      },
      'Note to delete'
    );
  });

  after(async () => { await closeFixture(fixture); });

  it('DELETE /annotation/<serial> without token returns 401', async () => {
    const res = await fetch(`${fixture.baseUrl}/annotation/0001`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 401);
  });

  it('DELETE /annotation/<serial> with unknown serial returns 404', async () => {
    const res = await fetch(`${fixture.baseUrl}/annotation/9999`, {
      method: 'DELETE',
      headers: { 'X-Stickyfix-Token': TEST_TOKEN },
    });
    assert.equal(res.status, 404);
  });

  it('DELETE /annotation/<serial> with valid token returns 200 and removes .md', async () => {
    const mdPath = join(fixture.cfg.notesDir, '0001-20260603-100000.md');
    assert.ok(existsSync(mdPath), 'fixture .md should exist before delete');

    const res = await fetch(`${fixture.baseUrl}/annotation/0001`, {
      method: 'DELETE',
      headers: { 'X-Stickyfix-Token': TEST_TOKEN },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, true);

    assert.ok(!existsSync(mdPath), '.md should be removed after DELETE');
  });
});

// ---------------------------------------------------------------------------
// D-02 / REL-02 / SC-2: 10 concurrent POST /annotation serial-integrity
// Proves withSerialLock serialises getNextSerial+writeNote so no two concurrent
// POSTs produce the same serial and no serial is skipped.
// ---------------------------------------------------------------------------

describe('concurrent POST /annotation serial integrity (REL-02/SC-2)', () => {
  let fixture: TestFixture;

  before(async () => {
    fixture = buildFixture();
    await listenFixture(fixture);
  });

  after(async () => { await closeFixture(fixture); });

  it('10 concurrent POST /annotation yield serials 0001-0010 with no gaps/dupes (REL-02/SC-2)', async () => {
    const post = (i: number) =>
      fetch(`${fixture.baseUrl}/annotation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stickyfix-Token': TEST_TOKEN,
        },
        body: JSON.stringify({
          mode: 'free',
          comment: `concurrent note ${i}`,
          page: { url: 'http://localhost:5173/c', title: 'Concurrent Test' },
          viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
        }),
      }).then(r => r.json() as Promise<{ ok: boolean; file: string; serial: string }>);

    // Construct all 10 fetch promises before awaiting any — real concurrency
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => post(i)));

    // All 10 must succeed
    for (const r of results) {
      assert.equal(r.ok, true, `Expected ok:true but got ${JSON.stringify(r)}`);
    }

    // Sorted serials must be exactly 0001..0010 — no gaps, no duplicates
    const serials = results.map(r => r.serial).sort();
    assert.deepEqual(
      serials,
      ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010'],
      `Serial integrity failed — got: ${serials.join(', ')}`
    );

    // Exactly 10 distinct .md files on disk — no gaps, no phantom writes
    const { readdirSync } = await import('node:fs');
    const mdFiles = readdirSync(fixture.cfg.notesDir).filter(f => /^\d{4}-.*\.md$/.test(f));
    assert.equal(mdFiles.length, 10, `Expected 10 .md files, found ${mdFiles.length}: ${mdFiles.join(', ')}`);
  });
});

// ---------------------------------------------------------------------------
// D-04 / REL-03 / SC-3: POST /annotation payload-size backstop
// Proves host enforces 12 MB cap: 11.9 MB succeeds, 12 MB+1 is rejected.
// ECONNRESET-tolerant: req.destroy() may race the 413 write (Pitfall 2).
// ---------------------------------------------------------------------------

describe('POST /annotation payload-size backstop (REL-03/SC-3)', () => {
  let fixture: TestFixture;

  before(async () => {
    fixture = buildFixture();
    await listenFixture(fixture);
  });

  after(async () => { await closeFixture(fixture); });

  it('POST /annotation with ~11.9 MB body succeeds (200 ok:true)', async () => {
    // Build a valid free-mode payload whose JSON encodes to just under 12 MB.
    // The outer shell (without the comment value) is ~140 bytes; pad the comment
    // with ASCII 'A' so the total JSON is ~11.9 MB.
    const TARGET_BYTES = Math.floor(11.9 * 1024 * 1024);
    const outerShell = JSON.stringify({
      mode: 'free',
      comment: '',
      page: { url: 'http://localhost:5173/test', title: 'Test Page' },
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    });
    // Pad = target - (shell length - 2 empty-comment chars that stay) = target - (shell.length)
    // shell already includes the two empty-comment quotes; we replace '' with the padded string
    const padding = TARGET_BYTES - outerShell.length;
    const comment = 'A'.repeat(Math.max(0, padding));
    const payload = JSON.stringify({
      mode: 'free',
      comment,
      page: { url: 'http://localhost:5173/test', title: 'Test Page' },
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    });

    // Confirm the body is below the 12 MB cap
    assert.ok(
      new TextEncoder().encode(payload).length < 12 * 1024 * 1024,
      `11.9 MB test body unexpectedly >= 12 MB (${new TextEncoder().encode(payload).length} bytes)`
    );

    const res = await fetch(`${fixture.baseUrl}/annotation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': TEST_TOKEN,
      },
      body: payload,
    });

    assert.equal(res.status, 200, `Expected 200 for 11.9 MB body, got ${res.status}`);
    const body = await res.json() as { ok: boolean; file: string; serial: string };
    assert.equal(body.ok, true, `Expected ok:true for 11.9 MB body, got ${JSON.stringify(body)}`);
  });

  it('POST /annotation with >12 MB body is rejected (413 or ECONNRESET) (REL-03/SC-3)', async () => {
    // Build a >12 MB JSON body via chunked string construction (no single giant allocation).
    // Use a comment padded to make total JSON just over 12 MB + 1 byte.
    const MAX_BODY = 12 * 1024 * 1024;
    const outerShell = JSON.stringify({
      mode: 'free',
      comment: '',
      page: { url: 'http://localhost:5173/test', title: 'Test Page' },
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    });
    // Need comment length such that total JSON > MAX_BODY
    const neededComment = MAX_BODY - outerShell.length + 2; // +2: exceed by at least 2 bytes
    // Build comment from 64 KB chunks to avoid one giant allocation
    const CHUNK = 'A'.repeat(64 * 1024);
    const commentChunks: string[] = [];
    let built = 0;
    while (built < neededComment) {
      const toAdd = Math.min(CHUNK.length, neededComment - built);
      commentChunks.push(CHUNK.slice(0, toAdd));
      built += toAdd;
    }
    const bigComment = commentChunks.join('');
    const bigBody = JSON.stringify({
      mode: 'free',
      comment: bigComment,
      page: { url: 'http://localhost:5173/test', title: 'Test Page' },
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    });

    // Confirm the body exceeds the 12 MB cap
    assert.ok(
      new TextEncoder().encode(bigBody).length > MAX_BODY,
      `oversize test body unexpectedly <= 12 MB`
    );

    // ECONNRESET-tolerant: req.destroy() may reset the TCP connection before
    // the 413 response is readable by the client — mirror the existing PUT
    // oversize tolerance at server.test.ts:477-502.
    let status: number | null = null;
    try {
      const res = await fetch(`${fixture.baseUrl}/annotation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stickyfix-Token': TEST_TOKEN,
        },
        body: bigBody,
      });
      status = res.status;
    } catch {
      // Connection reset (ECONNRESET) — req.destroy() closed the socket before
      // the 413 could be flushed. This is acceptable: request was rejected.
      // status remains null.
    }
    // If we got a response, it must be 413; a connection reset is equally valid.
    if (status !== null) {
      assert.equal(status, 413, `Expected 413 for oversized POST body, got ${status}`);
    }
  });
});

// ---------------------------------------------------------------------------
// FIX-1: GET /screenshot route — token-gated PNG file serve
// ---------------------------------------------------------------------------

// Minimal 1×1 transparent PNG (67 bytes, valid magic + IHDR + IDAT + IEND)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const TINY_PNG_BUF = Buffer.from(TINY_PNG_B64, 'base64');

describe('FIX-1: GET /screenshot route', () => {
  let fixture: TestFixture;

  before(async () => {
    fixture = buildFixture();
    await listenFixture(fixture);

    // Write a tiny 1×1 PNG into notesDir named like a real screenshot
    writeFileSync(join(fixture.cfg.notesDir, '0001-20260601-120000+1.png'), TINY_PNG_BUF);
  });

  after(async () => { await closeFixture(fixture); });

  it('GET /screenshot without token returns 401 (T-06-04)', async () => {
    const res = await fetch(
      `${fixture.baseUrl}/screenshot?serial=0001&file=0001-20260601-120000%2B1.png`
    );
    assert.equal(res.status, 401);
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, false);
  });

  it('GET /screenshot with valid token returns 200 image/png (FIX-1)', async () => {
    const res = await fetch(
      `${fixture.baseUrl}/screenshot?serial=0001&file=${encodeURIComponent('0001-20260601-120000+1.png')}`,
      { headers: { 'X-Stickyfix-Token': TEST_TOKEN } }
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(buf, TINY_PNG_BUF, 'response bytes must match the file on disk');
  });

  it('GET /screenshot rejects missing file with 404', async () => {
    const res = await fetch(
      `${fixture.baseUrl}/screenshot?serial=0001&file=${encodeURIComponent('0001-20260601-120000+9.png')}`,
      { headers: { 'X-Stickyfix-Token': TEST_TOKEN } }
    );
    assert.equal(res.status, 404);
  });

  it('GET /screenshot rejects traversal in file param with 400 (T-06-02)', async () => {
    const res = await fetch(
      `${fixture.baseUrl}/screenshot?serial=0001&file=${encodeURIComponent('../secret.png')}`,
      { headers: { 'X-Stickyfix-Token': TEST_TOKEN } }
    );
    assert.equal(res.status, 400);
  });

  it('GET /screenshot rejects file that does not start with serial (T-06-02)', async () => {
    const res = await fetch(
      `${fixture.baseUrl}/screenshot?serial=0001&file=${encodeURIComponent('9999-other+1.png')}`,
      { headers: { 'X-Stickyfix-Token': TEST_TOKEN } }
    );
    assert.equal(res.status, 400);
  });

  it('GET /screenshot rejects non-PNG file extension (T-06-02)', async () => {
    const res = await fetch(
      `${fixture.baseUrl}/screenshot?serial=0001&file=${encodeURIComponent('0001-20260601-120000.jpg')}`,
      { headers: { 'X-Stickyfix-Token': TEST_TOKEN } }
    );
    assert.equal(res.status, 400);
  });

  it('GET /screenshot includes CORS headers (Pitfall 6)', async () => {
    const res = await fetch(
      `${fixture.baseUrl}/screenshot?serial=0001&file=${encodeURIComponent('0001-20260601-120000+1.png')}`,
      { headers: { 'X-Stickyfix-Token': TEST_TOKEN, 'Origin': 'http://localhost:5173' } }
    );
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('access-control-allow-origin'), 'should have CORS header');
  });
});
