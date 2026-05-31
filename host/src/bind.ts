/**
 * Port-discovery helpers for stickyfix-host.
 * Extracted so tests can import bindServer without running the full index.ts boot.
 * WR-06: removeAllListeners between scan attempts prevents stale-handler accumulation.
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export const PORT_RANGE_START = 39240;
export const PORT_RANGE_END = 39260;
export const BIND_HOST = '127.0.0.1'; // T-02-bind: NEVER 0.0.0.0

/**
 * Attempt to bind `server` on a single port.
 * Resolves true if bound, false on EADDRINUSE, throws on other errors.
 * Uses 'once' listeners so a failed attempt does not accumulate handlers.
 */
export function tryListen(server: http.Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(e);
      }
    };

    const onListening = () => {
      resolve(true);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, BIND_HOST);
  });
}

/**
 * Find the first free port in the range [start, end] and bind the server to it.
 * Honors a caller-supplied preferred port (e.g. from --port) by trying it first.
 * Throws if no port in range is free.
 *
 * WR-06: The comment previously described probe-server-per-attempt, but the
 * implementation reused the same server in a loop.  We keep single-server reuse
 * (simpler) and make the code and comment agree: after each failed EADDRINUSE
 * attempt, removeAllListeners('error') and removeAllListeners('listening') are
 * called before the next attempt to prevent stale-handler accumulation.
 */
export async function bindServer(server: http.Server, preferredPort?: number): Promise<number> {
  // Try preferred port first if specified
  if (preferredPort !== undefined) {
    const bound = await tryListen(server, preferredPort);
    if (bound) {
      return (server.address() as AddressInfo).port;
    }
    throw new Error(
      `stickyfix-host: --port ${preferredPort} is already in use. ` +
      `Remove --port to auto-scan ${PORT_RANGE_START}–${PORT_RANGE_END}.`
    );
  }

  // Scan range, reusing the real server across attempts.
  // WR-06: Remove stale handlers between attempts so a prior failed listen()
  // does not accumulate duplicate error/listening listeners on the server.
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    server.removeAllListeners('error');
    server.removeAllListeners('listening');
    const bound = await tryListen(server, port);
    if (bound) {
      return (server.address() as AddressInfo).port;
    }
  }

  throw new Error(
    `stickyfix-host: no free port found in ${PORT_RANGE_START}–${PORT_RANGE_END}. ` +
    `Use --port to specify a different port.`
  );
}
