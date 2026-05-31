---
phase: 02-host-mvp
reviewed: 2026-05-31T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - host/src/index.ts
  - host/src/server.ts
  - host/src/config.ts
  - host/src/security.ts
  - host/src/serial.ts
  - host/src/write-note.ts
  - host/src/types.ts
  - scripts/host-smoke-test.mjs
  - host/test/serial.test.ts
  - host/test/security.test.ts
  - host/test/write-note.test.ts
  - host/test/server.test.ts
findings:
  critical: 2
  warning: 6
  info: 5
  total: 13
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-05-31
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Reviewed the Host MVP: a localhost HTTP server with token auth, path-confined note writing, a promise-queue serial mutex, and PNG data-URL decoding. The security-critical primitives are largely sound: token comparison is timing-safe with a length pre-check, `isInsideDir` correctly uses `path.sep` to block the `rootfoo` sibling-prefix bypass, the 12 MB body cap genuinely aborts the stream via `req.destroy()`, the serial mutex serializes correctly under true concurrency, and 127.0.0.1 binding is asserted at boot. CORS echo-Origin is acceptable here because the token is the real gate.

However, two correctness defects can crash a request into a 500 or leave inconsistent on-disk state, and several robustness/quality gaps remain. The most serious: (1) `checkToken` can throw an unhandled exception (turning a clean 401 into a 500) when a provided token's UTF-16 length matches but its UTF-8 byte length differs; and (2) `writeNote` writes the `.md` file *before* decoding screenshots, so a malformed screenshot data-URL consumes a serial and leaves an orphaned note while returning 500 — a silent-capture-failure-class problem the PRD explicitly forbids.

## Critical Issues

### CR-01: `checkToken` throws (500) instead of returning false on multibyte length mismatch

**File:** `host/src/security.ts:26-27`, `host/src/server.ts:75`
**Issue:** The length guard compares `provided.length !== expectedToken.length`. For JavaScript strings, `.length` is the count of UTF-16 code units, but `Buffer.from(str)` encodes as UTF-8 bytes. A provided token can have the *same* UTF-16 length as the expected token yet a *different* UTF-8 byte length (e.g. a token containing an emoji or accented char). When that happens the length guard passes, but `timingSafeEqual(Buffer.from(provided), Buffer.from(expectedToken))` receives buffers of unequal length and **throws** `RangeError: Input buffers must have the same byte length`. In `handleAnnotation`, `checkToken` is called outside any try/catch (line 75), so the throw propagates to the last-resort `.catch` in `createHostServer` and the client receives a **500** instead of a clean **401**. An attacker can deliberately trigger this to probe behavior, and a legitimate non-ASCII `--token` / `STICKYFIX_TOKEN` makes *all* auth fail with 500.
**Fix:** Compare byte lengths, not string lengths, and build the buffers once:
```ts
export function checkToken(req: Pick<IncomingMessage, 'headers'>, expectedToken: string): boolean {
  const provided = req.headers['x-stickyfix-token'];
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expectedToken, 'utf8');
  if (a.length !== b.length) return false; // byte-length guard
  return timingSafeEqual(a, b);
}
```

### CR-02: `writeNote` writes the `.md` before decoding screenshots — bad screenshot leaves an orphaned note and a consumed serial

**File:** `host/src/write-note.ts:156-164`
**Issue:** `writeNote` writes the `.md` file at line 156, then loops decoding/writing PNGs at lines 159-164. `decodePngDataUrl` throws `{ statusCode: 400 }` when a screenshot's `dataUrl` lacks the `data:image/png;base64,` prefix. Because the throw happens *after* the `.md` is already on disk and *after* `getNextSerial` consumed a serial, the result is: an orphaned `.md` (with a `screenshots:` frontmatter list pointing at PNG files that were never written), a burned serial number, and a **500** returned to the client ("internal error") — even though the real cause is a 400-class bad input. This violates the PRD's "no silent failures / a dropped note is a regression" guarantee: the user sees a generic failure while a half-written note silently lands in `notes/`. The status-code intent (400 for bad mime) is also lost because `handleAnnotation`'s write-phase catch always maps to 500.
**Fix:** Decode and validate all screenshots into buffers *before* writing any file, so a bad screenshot fails fast with no partial state; then surface the 400. Example:
```ts
// Decode/validate FIRST — fail before touching disk
const pngBuffers = (payload.screenshots ?? []).map(s => decodePngDataUrl(s.dataUrl));

const frontmatter = buildFrontmatter(base, payload, serial, screenshotRelPaths);
const body = buildNoteBody(base, payload);
await writeFile(mdPath, frontmatter + body, 'utf8');

for (let i = 0; i < pngBuffers.length; i++) {
  await writeFile(join(notesDir, `${base}+${i + 1}.png`), pngBuffers[i]);
}
```
Additionally, propagate the `statusCode` from the write phase in `handleAnnotation` (server.ts:111-115) so a 400-class error returns 400, not 500.

## Warnings

### WR-01: Route matching breaks on query strings / fragments

**File:** `host/src/server.ts:136,141`
**Issue:** Routes are matched with strict equality on the raw `req.url` (`url === '/status'`, `url === '/annotation'`). `req.url` includes the query string, so `GET /status?foo=1` or `POST /annotation?x=1` falls through to the 404 handler. The extension is unlikely to append a query today, but this is a brittle coupling that will silently break capture if a query ever appears (again, a dropped note is a regression).
**Fix:** Parse the path before matching:
```ts
const path = (req.url ?? '/').split('?', 1)[0];
if (method === 'GET' && path === '/status') { ... }
if (method === 'POST' && path === '/annotation') { ... }
```

### WR-02: No payload shape validation — handler dereferences `payload.page` / `payload.viewport` blindly

**File:** `host/src/server.ts:96-108`, `host/src/write-note.ts:60-70`
**Issue:** After `JSON.parse`, the result is cast `as AnnotationPayload` with no runtime validation. `buildFrontmatter` then dereferences `page.url`, `page.title`, `viewport.width/height/devicePixelRatio` unconditionally. A POST with a valid token but a body like `{}` (or `{"mode":"free"}`) passes JSON parsing, then throws `TypeError: Cannot read properties of undefined (reading 'url')` inside `writeNote`, which is caught as a generic **500** ("internal error"). A malformed-but-parseable payload should be a **400**, not a 500, and should not reach the disk-write path. The smoke test and integration tests only ever send well-formed payloads, so this gap is untested.
**Fix:** Add a minimal runtime guard before `withSerialLock` that checks `mode`, `comment`, `page.url/title`, and `viewport.*` are present and correctly typed; return 400 `{ ok:false, error:'invalid payload' }` on failure.

### WR-03: Smoke test does not await child exit — possible orphaned process / race on Windows

**File:** `scripts/host-smoke-test.mjs:181-186`
**Issue:** The `finally` block sends `SIGTERM` then waits a fixed `setTimeout(200)` and proceeds to `rmSync(tmpRoot)`. On Windows, Node does not translate `SIGTERM` into a graceful signal — `child.kill('SIGTERM')` terminates the process, but there is no `await` on the child's actual `exit` event. If termination is slow, `rmSync` of `tmpRoot` can race the still-running server (which may hold the notes dir / token file open), occasionally throwing EBUSY/EPERM and leaving an orphaned `node` process or temp dir. The 200 ms sleep is a guess, not a guarantee.
**Fix:** Await actual exit with a fallback:
```ts
if (child && child.exitCode === null) {
  await new Promise((res) => {
    child.once('exit', res);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} res(undefined); }, 2000);
  });
}
```

### WR-04: PNG data-URL is decoded but never verified to be a PNG (magic-byte check missing)

**File:** `host/src/write-note.ts:34-42`
**Issue:** `decodePngDataUrl` only checks the textual `data:image/png;base64,` prefix, then `Buffer.from(slice, 'base64')`. `Buffer.from(..., 'base64')` silently drops invalid base64 characters rather than erroring, so a garbage payload that *starts* with the right prefix produces a non-PNG buffer that is written to disk as a `.png` with no error. The 12 MB body cap bounds the allocation (so this is not unbounded-alloc), but a corrupt/empty image is written silently and the note's `screenshots:` reference points at a non-image file. Given the "reliable capture" guarantee, validate the decoded bytes.
**Fix:** After decoding, assert the 8-byte PNG signature (`89 50 4E 47 0D 0A 1A 0A`) and throw `{ statusCode: 400 }` if it does not match; reject zero-length buffers too.

### WR-05: `--port` parsed with `Number()` — `NaN`/negative/out-of-range values are not rejected

**File:** `host/src/config.ts:53-54`, `host/src/index.ts:90-98`
**Issue:** `port = portStr ? Number(portStr) : undefined`. `Number('abc')` yields `NaN`; `Number('99999')` yields an out-of-range port; `Number('0x10')` yields 16. A `NaN` port flows into `tryListen(server, NaN)` → `server.listen(NaN, ...)`, which Node coerces to port 0 (random ephemeral port) — so `--port garbage` silently binds a *random* port instead of erroring, and the boot assertion that the port is in 39240-39260 is bypassed entirely (the smoke test would catch this, but a real run would not). `--port -1` / `--port 70000` produce confusing low-level errors.
**Fix:** Validate after parsing:
```ts
let port: number | undefined;
if (portStr !== undefined) {
  port = Number(portStr);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be an integer 1-65535, got: ${portStr}`);
  }
}
```

### WR-06: `bindServer` reuses the same `http.Server` across scan attempts, contradicting Pitfall 1 / risking a stuck listener

**File:** `host/src/index.ts:88-114`
**Issue:** The doc comment (Pitfall 1, lines 6-7 and 82-87) explicitly says "create a fresh http.Server per probe attempt to avoid listener accumulation" and "create fresh temporary probe servers per-port." The implementation does the opposite: it calls `tryListen(server, port)` on the *same* real `server` in a loop (line 104). On EADDRINUSE the `error` event fires and `tryListen` resolves false, but the failed `listen()` attempt leaves the server in a state where re-calling `listen()` is not contractually guaranteed across all Node versions, and any non-EADDRINUSE error path (rejected) leaves the real server half-initialized. The code comment and the code disagree, which is a maintenance hazard and an untested concurrency edge (no test exercises the scan-past-occupied-ports path). At minimum, remove the `once('listening'/'error')` handlers that did *not* fire before the next attempt to avoid stale-handler accumulation across iterations.
**Fix:** Either (a) follow the documented pattern and probe each port with a throwaway server, closing it before binding the real server to the winning port; or (b) keep single-server reuse but explicitly `server.removeAllListeners('error'); server.removeAllListeners('listening')` between attempts and document that the comment was changed. Add a test that occupies 39240 and asserts the server lands on 39241.

## Info

### IN-01: Unused parameters in `buildFrontmatter` / `buildNoteBody`

**File:** `host/src/write-note.ts:52-57,89`
**Issue:** `buildFrontmatter(base, payload, serial, screenshotRelPaths)` never reads `base`. `buildNoteBody(base, payload)` never reads `base` (it recomputes its own `screenshotBasenames` from `payload`). Dead parameters invite drift and confuse callers.
**Fix:** Drop the unused `base` parameters (and `serial` from `buildFrontmatter` if `payload`/the `id` field is sourced elsewhere — currently `serial` *is* used for `id`, so keep that one).

### IN-02: `getNextSerial` uses `Math.max(...serials)` spread — fragile on very large dirs

**File:** `host/src/serial.ts:33`
**Issue:** `Math.max(...serials)` spreads the entire array as call arguments; with a very large `notes/` directory this can hit the engine's argument-count limit (RangeError). Not a concern at expected scale, but `serials.reduce((a,b)=>Math.max(a,b), 0)` is safer and equally clear.
**Fix:** `const max = serials.reduce((a, b) => Math.max(a, b), 0); return max + 1;`

### IN-03: `localTimestamp` second-resolution allows filename collision under burst

**File:** `host/src/write-note.ts:23-28,147-148`
**Issue:** The note basename is `<serial>-<YYYYMMDD-HHmmss>` at one-second resolution. The serial guarantees uniqueness, so collisions are avoided in practice — but the timestamp adds no collision protection by itself. Two notes in the same second differ only by serial, which is fine; flagging only so a future reader does not assume the timestamp is unique.
**Fix:** None required; optionally document that uniqueness derives from the serial, not the timestamp.

### IN-04: `writeFile` for PNGs has no explicit `flush`/error context; partial PNG on disk-full not cleaned

**File:** `host/src/write-note.ts:159-164`
**Issue:** If the second of two `await writeFile(pngPath, ...)` calls fails (e.g. disk full), the first PNG and the `.md` remain on disk while the request returns 500. Same partial-state class as CR-02 but for I/O failures rather than bad input. Lower severity because it requires an I/O fault.
**Fix:** Consider writing to a temp name and renaming, or documenting that partial writes are possible on I/O failure and the serial is consumed regardless.

### IN-05: `setCorsHeaders` falls back to `'*'` when Origin absent, but credentials are header-based

**File:** `host/src/server.ts:27`
**Issue:** When no `Origin` header is present, `Access-Control-Allow-Origin` is set to `'*'`. This is harmless here because auth is via the `X-Stickyfix-Token` header (not cookies), so `Allow-Origin: *` does not leak credentials. Noting it only to confirm it was considered and is acceptable within the host boundary — not a defect.
**Fix:** None required.

---

_Reviewed: 2026-05-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
