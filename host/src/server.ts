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
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { VERSION } from './config.js';
import { checkToken, readBody, isInsideDir } from './security.js';
import { withSerialLock, getNextSerial } from './serial.js';
import { writeNote } from './write-note.js';
import { listAnnotations, editNote, deleteNote } from './read-note.js';
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

  // 4b. WR-02: Runtime payload shape guard before reaching the disk-write path.
  // buildFrontmatter/buildNoteBody dereference page.url, viewport.width, etc.
  // unconditionally — a missing field causes a TypeError (500). Validate first.
  if (
    (payload.mode !== 'free' && payload.mode !== 'element') ||
    typeof payload.comment !== 'string' ||
    !payload.page || typeof payload.page.url !== 'string' || typeof payload.page.title !== 'string' ||
    !payload.viewport ||
    typeof payload.viewport.width !== 'number' ||
    typeof payload.viewport.height !== 'number' ||
    typeof payload.viewport.devicePixelRatio !== 'number'
  ) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'invalid payload' }));
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
// Phase 6 handlers: GET /annotations, PUT /annotation/<serial>, DELETE /annotation/<serial>
// HOST-14/15/16
// ---------------------------------------------------------------------------

/**
 * GET /annotations?url=<page-url>
 * Returns all notes whose URL path matches the given page URL (D-02).
 * Token-gated (T-06-04). CORS headers first (Pitfall 6).
 */
async function handleListAnnotations(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: Config,
): Promise<void> {
  setCorsHeaders(req, res);

  if (!checkToken(req, cfg.token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  try {
    // Parse ?url= query parameter (path already stripped of query by route table)
    const pageUrl = new URL(req.url ?? '/', 'http://x').searchParams.get('url') ?? '';
    const pins = listAnnotations(cfg.notesDir, pageUrl);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pins }));
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    const status = (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600)
      ? err.statusCode : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message ?? 'internal error' }));
  }
}

/**
 * PUT /annotation/<serial>
 * Overwrites the note body in place; preserves frontmatter + screenshots; re-marks status:unread.
 * Reads body via existing readBody (12 MB cap → 413, HOST-11 reuse).
 * Token-gated (T-06-01). path-confined via editNote (T-06-02).
 */
async function handleEditAnnotation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: Config,
  serial: string,
): Promise<void> {
  setCorsHeaders(req, res);

  if (!checkToken(req, cfg.token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  // Read body with 12 MB cap (HOST-11 invariant reuse, T-06-03)
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

  try {
    let parsed: { comment?: string };
    try {
      parsed = JSON.parse(raw) as { comment?: string };
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
      return;
    }

    const comment = parsed.comment ?? '';
    await editNote(cfg.notesDir, serial, comment);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    const status = (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600)
      ? err.statusCode : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message ?? 'internal error' }));
  }
}

/**
 * DELETE /annotation/<serial>
 * Removes the .md file and its +N.png screenshots (D-05/D-06).
 * Token-gated (T-06-01). path-confined via deleteNote (T-06-02).
 */
async function handleDeleteAnnotation(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: Config,
  serial: string,
): Promise<void> {
  setCorsHeaders(req, res);

  if (!checkToken(req, cfg.token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  try {
    await deleteNote(cfg.notesDir, serial);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    const status = (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600)
      ? err.statusCode : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message ?? 'internal error' }));
  }
}

/**
 * GET /screenshot?serial=<serial>&file=<basename.png>
 * Serves a screenshot PNG file from notesDir as image/png bytes.
 *
 * Security model:
 *  - Token-gated via checkToken (same as all other read verbs) — prevents
 *    info-disclosure from unauthenticated callers (T-06-04 class).
 *  - Path-traversal guard (T-06-02 class): `file` param must be a plain
 *    basename (no `/`, `\`, or `..`), MUST start with `<serial>` (ties the
 *    file to the note being requested), MUST end with `.png`.
 *    The resolved absolute path is then verified via isInsideDir before read.
 *  - No directory listing: only a single named file is ever returned.
 *  - SW is the sole HTTP client — this endpoint is not called from page context.
 */
async function handleGetScreenshot(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: Config,
): Promise<void> {
  // CORS first (Pitfall 6)
  setCorsHeaders(req, res);

  // Token gate (T-06-04)
  if (!checkToken(req, cfg.token)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  const params = new URL(req.url ?? '/', 'http://x').searchParams;
  const serial = params.get('serial') ?? '';
  const file = params.get('file') ?? '';

  // Basename guard: reject any path separator or traversal component (T-06-02)
  if (
    !serial ||
    !file ||
    file.includes('/') ||
    file.includes('\\') ||
    file.includes('..') ||
    !file.startsWith(serial) ||  // ties file to the specific note serial
    !file.endsWith('.png')
  ) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'invalid file parameter' }));
    return;
  }

  // Reconstruct absolute path and verify confinement (T-06-02)
  const resolved = join(cfg.notesDir, basename(file));
  if (!isInsideDir(cfg.notesDir, resolved)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(resolved);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length) });
  res.end(bytes);
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

    // Phase 6 routes: GET /annotations, PUT/DELETE /annotation/<serial>
    if (method === 'GET' && path === '/annotations') {
      handleListAnnotations(req, res, cfg).catch((e: unknown) => {
        if (!res.headersSent) {
          setCorsHeaders(req, res);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    if (method === 'PUT' && path.startsWith('/annotation/')) {
      const serial = path.slice('/annotation/'.length);
      handleEditAnnotation(req, res, cfg, serial).catch((e: unknown) => {
        if (!res.headersSent) {
          setCorsHeaders(req, res);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    if (method === 'DELETE' && path.startsWith('/annotation/')) {
      const serial = path.slice('/annotation/'.length);
      handleDeleteAnnotation(req, res, cfg, serial).catch((e: unknown) => {
        if (!res.headersSent) {
          setCorsHeaders(req, res);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }

    // GET /screenshot?serial=&file= — token-gated PNG file serve (FIX-1 UAT)
    if (method === 'GET' && path === '/screenshot') {
      handleGetScreenshot(req, res, cfg).catch((e: unknown) => {
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
