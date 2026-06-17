/**
 * Tests for the port-scan / bind logic in index.ts.
 * WR-06: Verifies that bindServer correctly skips an occupied port and
 *        lands on the next free one — binding to 127.0.0.1 only.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { bindServer, BIND_HOST } from '../src/bind.js';

// ---------------------------------------------------------------------------
// WR-06: port-scan skips an occupied port
//
// Hermetic by design: we occupy an OS-assigned ephemeral port (listen(0)) and
// ask bindServer to scan a small range that STARTS on it. This exercises the
// real "skip occupied, land on next free" logic without hardcoding the
// production port 39240 — so the test passes even when a real stickyfix host
// is already running on the production range.
// ---------------------------------------------------------------------------

describe('bindServer — port scan (WR-06)', () => {
  let blocker: http.Server;
  let targetServer: http.Server;
  let occupiedPort: number;

  before(async () => {
    // Occupy an ephemeral port chosen by the OS (never collides with a host).
    blocker = http.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, BIND_HOST, resolve);
    });
    occupiedPort = (blocker.address() as AddressInfo).port;
  });

  after(async () => {
    // Close both servers
    await new Promise<void>((res) => blocker.close(() => res()));
    if (targetServer?.listening) {
      await new Promise<void>((res) => targetServer.close(() => res()));
    }
  });

  test('WR-06: server scans past an occupied port and binds to the next free one', async () => {
    targetServer = http.createServer();

    // Scan range starts on the occupied port → bindServer must skip it.
    const scanEnd = occupiedPort + 5;
    const port = await bindServer(targetServer, undefined, occupiedPort, scanEnd);

    // Must have landed past the occupied port
    assert.ok(
      port > occupiedPort,
      `Expected port > ${occupiedPort} (blocker holds it), got ${port}`
    );
    // Must still be within the scan range
    assert.ok(
      port <= scanEnd,
      `Expected port within scan range, got ${port}`
    );
    // Must bind to 127.0.0.1 only
    const addr = targetServer.address() as AddressInfo;
    assert.equal(addr.address, BIND_HOST);
    assert.equal(addr.port, port);
  });
});
