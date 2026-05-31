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

const PORT_RANGE_START = 39240;

// ---------------------------------------------------------------------------
// WR-06: port-scan skips an occupied port
// ---------------------------------------------------------------------------

describe('bindServer — port scan (WR-06)', () => {
  // A blocker server that occupies PORT_RANGE_START (39240)
  let blocker: http.Server;
  let targetServer: http.Server;

  before(async () => {
    // Occupy 39240
    blocker = http.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(PORT_RANGE_START, BIND_HOST, resolve);
    });
  });

  after(async () => {
    // Close both servers
    await new Promise<void>((res) => blocker.close(() => res()));
    if (targetServer?.listening) {
      await new Promise<void>((res) => targetServer.close(() => res()));
    }
  });

  test('WR-06: server scans past occupied 39240 and binds to 39241', async () => {
    targetServer = http.createServer();

    const port = await bindServer(targetServer);

    // Must have landed past the occupied port
    assert.ok(
      port > PORT_RANGE_START,
      `Expected port > ${PORT_RANGE_START} (blocker holds it), got ${port}`
    );
    // Must still be within range
    assert.ok(
      port <= 39260,
      `Expected port within scan range, got ${port}`
    );
    // Must bind to 127.0.0.1 only
    const addr = targetServer.address() as AddressInfo;
    assert.equal(addr.address, BIND_HOST);
    assert.equal(addr.port, port);
  });
});
