/**
 * HTTP server factory for stickyfix-host.
 * D-05/HOST-10: CORS echo-Origin + Access-Control-Allow-Private-Network on every response
 * D-06/HOST-04: GET /status no-token, no secrets
 * D-05/HOST-05: POST /annotation token-gated via checkToken
 * D-04/HOST-11: readBody 12 MB cap -> 413; JSON.parse -> 400
 * D-03/HOST-06: withSerialLock(getNextSerial + writeNote) for atomic serial assignment
 * Pitfall 6: setCorsHeaders called at top of handler — before any response write
 */

import * as http from 'node:http';
import { VERSION } from './config.js';
import { checkToken, readBody } from './security.js';
import { withSerialLock, getNextSerial } from './serial.js';
import { writeNote } from './write-note.js';
import type { Config, AnnotationPayload } from './types.js';

// ---------------------------------------------------------------------------
// CORS helpers (Pattern 4)
// ---------------------------------------------------------------------------

/**
 * Set base CORS headers on every response — echoes the request Origin.
 * Must be called FIRST in every route handler, before any writeHead/end (Pitfall 6).
 */
function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin ?? '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

/**
 * Add OPTIONS preflight-specific headers (called after setCorsHeaders for OPTIONS requests).
 */
function setPreflightHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  setCorsHeaders(req, res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Stickyfix-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleStatus(req: http.IncomingMessage, res: http.ServerResponse, cfg: Config): void {
  setCorsHeaders(req, res);
  const body = JSON.stringify({
    app: 'stickyfix',
    version: VERSION,
    name: cfg.name,
    root: cfg.root,
    notesDir: cfg.notesDir,
    origins: cfg.origins,
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
}

function handleOptions(req: http.IncomingMessage, res: http.ServerResponse): void {
  setPreflightHeaders(req, res);
  res.writeHead(204);
  res.end();
}

async function handleAnnotation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: Config
): Promise<void> {
  // 1. CORS on every response path (Pitfall 6)
  setCorsHeaders(req, res);

  // 2. Token auth (HOST-05)
  if (!checkToken(req, cfg.token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  // 3. Read body with size cap (HOST-11)
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    const status = err.statusCode === 413 ? 413 : 400;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message ?? 'read error' }));
    return;
  }

  // 4. Parse JSON (D-04)
  let payload: AnnotationPayload;
  try {
    payload = JSON.parse(raw) as AnnotationPayload;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
    return;
  }

  // 5. Write under serial lock (D-03 / Pitfall 3)
  try {
    const { file, serial } = await withSerialLock(async () => {
      const serialNum = getNextSerial(cfg.notesDir);
      return writeNote(cfg.notesDir, payload, serialNum);
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, file, serial }));
  } catch (e: unknown) {
    // CR-02: propagate statusCode from write-phase errors (e.g. bad screenshot → 400)
    const err = e as { statusCode?: number; message?: string };
    const status = (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600)
      ? err.statusCode
      : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message ?? 'internal error' }));
  }
}

// ---------------------------------------------------------------------------
// Server factory (D-01: createHostServer — does NOT call listen)
// ---------------------------------------------------------------------------

/**
 * Create a configured http.Server with /status, OPTIONS, POST /annotation routing.
 * Does NOT call server.listen — index.ts owns port binding (Pattern 1).
 */
export function createHostServer(cfg: Config): http.Server {
  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    // WR-01: match on the path only — strip query string so /status?x=1 still routes correctly
    const path = (req.url ?? '/').split('?', 1)[0];

    if (method === 'OPTIONS') {
      handleOptions(req, res);
      return;
    }

    if (method === 'GET' && path === '/status') {
      handleStatus(req, res, cfg);
      return;
    }

    if (method === 'POST' && path === '/annotation') {
      handleAnnotation(req, res, cfg).catch((e: unknown) => {
        // Last-resort: if handler itself threw unexpectedly and response not started
        if (!res.headersSent) {
          setCorsHeaders(req, res);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    // 404 for all other routes (CORS headers still required — Pitfall 6)
    setCorsHeaders(req, res);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  return server;
}
