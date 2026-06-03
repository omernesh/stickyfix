# Phase 8: Hardening + Pre-Release Audit - Research

**Researched:** 2026-06-03
**Domain:** Reliability hardening of an existing MV3 extension + Node localhost host (error-path consolidation, concurrency stress, payload guard, GPL clean-room audit)
**Confidence:** HIGH (entirely grounded in the existing codebase + verified MV3 lifecycle behavior)

## Summary

This is a **hardening/verification phase over working code** — not new product capability. Every artifact it touches already exists and works. The research is therefore almost entirely a *grounding audit of the current source*, not an ecosystem survey. No new dependencies are needed; no new libraries are recommended. The five named failure paths already surface toasts today (verified file:line below) — the work is *consolidation* behind a single typed mapper (D-01/D-01a) without changing any string, plus *proof* via tests for concurrency (D-02) and payload boundaries (D-04), plus *extension* of the existing clean-room script (D-03).

The codebase has two distinct Send call-sites (`card.ts` and `chip.ts`) that each duplicate the same `chrome.runtime.lastError || !resp` → toast pattern and the same `resp.ok ? … : showToast(resp.error)` branch. The mapper's job is to become the single source of truth those call-sites delegate to. The SW relay (`background.ts handleSendAnnotation`) already converts *all* five failure conditions into structured `{ok:false,error}` responses — meaning the failure taxonomy is **already enumerable from the SW's return statements**, and the mapper is a client-side translation of those error strings into the exact toast text already shipping.

**Primary recommendation:** Build a pure `lib/error-toast.ts` mapper (node:test-covered) that takes the existing `{ok:false,error}`/`lastError` inputs and returns the *verbatim* current toast strings; refactor `card.ts` `_doSend`/`_doElementSend` and `chip.ts` `wireSendButton` to call it. Add a `lib/payload-size.ts` pure pre-flight check. Extend `host/test/server.test.ts` (not `serial.test.ts` directly — see D-02 note) with a 10-concurrent integration test and an 11.9 MB/12 MB boundary pair. Extend `scripts/clean-room-check.mjs` banned set + self-audit. Zero new dependencies.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Error→toast mapping (D-01) | Content script (`entrypoints/review.content/`) | Pure lib (`lib/error-toast.ts`) | Toast rendering is DOM/shadow-root only; the *mapping logic* is pure and belongs in `lib/` for node:test coverage |
| Failure-condition origination | Service worker (`background.ts`) | — | The SW is the sole HTTP client; it is where host-unreachable, 401, 413, no-host-for-origin become structured errors |
| SW-eviction surfacing | Content script (`card.ts`/`chip.ts`) | Chrome runtime | `chrome.runtime.lastError`/`!resp` after `sendMessage` is the ONLY client-side signal of a dropped channel; surfacing is a CS concern |
| Pre-flight payload size guard (D-04) | Content script Send path | Pure lib (`lib/payload-size.ts`) | The encoded JSON size is known only after payload assembly in the CS; the *threshold math* is pure |
| Serial integrity under concurrency (D-02) | Host (`host/src/serial.ts` + `server.ts`) | — | The mutex is in-process on the host; concurrency is proven server-side |
| 413 backstop (D-04) | Host (`host/src/security.ts` `readBody`) | — | Defense-in-depth; already implemented and tested |
| GPL clean-room audit (D-03) | Build tooling (`scripts/clean-room-check.mjs`) | — | Repo-wide static scan, not runtime |

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Route all Send failure handling through a single typed **error→toast mapper** (one source of truth mapping each failure to its toast message). Cover all five paths: host unreachable, 401 token mismatch, 413 body-too-large, SW evicted mid-flight, and no-host-for-origin. Unit-test the mapper per path, then a thin manual Chrome UAT runbook for runtime confirmation.
- **D-01a (regression guardrail — MANDATORY):** The mapper **consolidates** the existing catch sites in `entrypoints/review.content/` without changing any currently-working toast message text or trigger behavior. Absorb the existing toast strings verbatim; this is a refactor for a single source of truth, not a UX change. Working toasts are sacred — no regression.
- **D-02:** The blocking automated gate is a **host integration test**: fire 10 concurrent `POST /annotation` at a booted host in `node:test`, assert files `0001`–`0010` exist with no gaps or duplicates. Extends the existing `host/test/serial.test.ts` patterns; deterministic and CI-able.
- **D-02a:** A manual extension-driven rapid multi-Send is folded into the regression UAT runbook (D-05) — **not** a blocking automated gate.
- **D-03:** **No-peek policy.** Do NOT open the GPL-3.0 upstream to source the banned list. The audit's banned set = the tokens we already know (`__opc_`, `opencode`, `JodusNodus`) PLUS any suspicious magic strings / selector constants surfaced by a **self-audit of our own repo**. Extend `scripts/clean-room-check.mjs` accordingly; it must return zero matches across the entire repo and continue running in `npm run check`. Absolute clean-room hygiene — the MIT-vs-GPL provenance constraint outranks audit completeness.
- **D-04:** Extension-side **pre-flight encoded-size check** before POST — if the payload will exceed the cap, show a clear toast immediately and skip the wasted ~12 MB round-trip. The host **413** remains the backstop (defense in depth). Test both boundaries: an 11.9 MB payload succeeds; a ~12 MB payload is rejected (pre-flight on the extension side, 413 on the host side).
- **D-05:** Targeted regression, not a full re-run of every prior-phase UAT. Re-verify: (a) state survival across SW idle eviction with a subsequent Send still routing correctly (Phase 3 SC-4 re-confirmation), and (b) multi-note serial increment (`0001` → `0002`). Document as a short runbook.

### Claude's Discretion
- The exact shape/location of the error-taxonomy type (e.g., discriminated union vs. error-code enum) and the mapper's module path, provided D-01a is honored.
- Test file naming/placement within the existing `host/test/` and `lib/test/` conventions.
- Whether the pre-flight size check lives in a shared `lib/` util or inline in the Send path — provided it is unit-testable.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (Turnkey onboarding, auto-pairing, and cross-browser packaging are Phase 9; not touched here.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REL-01 | Every failed Send (host down, 4xx/5xx, token rejected, no host for origin) surfaces a visible toast — never a silent drop | All five paths already produce toasts (see Failure-Path Inventory). The mapper consolidates the 5 existing catch sites into `lib/error-toast.ts`, unit-tested per path, strings preserved verbatim (D-01a). |
| REL-02 | Multi-note sessions remain stable; a second note increments the serial to `0002` | `host/src/serial.ts` `withSerialLock` + `getNextSerial` already serialize. The 10-concurrent integration test (D-02) proves no gaps/dupes under stress; existing `serial.test.ts` covers 2-concurrent at the unit level. |
| REL-03 | Large-screenshot payloads are handled gracefully (size guard + clear error) | Host `readBody` 12 MB cap → 413 already implemented + tested. D-04 adds a CS pre-flight pure check (`lib/payload-size.ts`) tested at the 11.9 MB / 12 MB boundary, plus a host-side boundary test. |
</phase_requirements>

---

## Failure-Path Inventory (REL-01 / SC-1) — DOES A TOAST FIRE TODAY?

This is the load-bearing grounding for D-01/D-01a. Each of the five named paths is traced from the failure condition to the visible toast. **All five fire today.** The mapper must preserve every string verbatim.

| # | Failure path | Where the condition is detected | Toast string shipping TODAY (verbatim) | Fires today? |
|---|--------------|----------------------------------|-----------------------------------------|--------------|
| 1 | **Host unreachable** | `background.ts:326-329` `handleSendAnnotation` catch on `fetch` → returns `{ok:false, error: \`Host unreachable: ${String(e)}\`}` | `card.ts:433` / `card.ts:867` → `showToastFn(resp.error, true)` renders `"Host unreachable: …"`. `chip.ts:486` → inline feedback. | ✅ YES |
| 2 | **401 token mismatch** | `server.ts:78-82` returns 401 `{ok:false,error:'unauthorized'}`; `background.ts:350-360` maps non-2xx → `{ok:false, error: errBody.error ?? \`HTTP ${resp.status}\`}` → `"unauthorized"` | `card.ts:433/867` `showToastFn(resp.error,true)` renders `"unauthorized"` | ✅ YES |
| 2b | **No token set for host** (precursor to 401) | `background.ts:307-312` returns `{ok:false, error: \`No token set for host "${host.name}" — enter it in the popup\`}` | `card.ts:433/867` toast | ✅ YES |
| 3 | **413 body too large** | `server.ts:88-94` catches `readBody` reject (`statusCode 413`) → 413 `{ok:false,error:'Payload Too Large'}`; `background.ts:350-360` maps → `"Payload Too Large"` | `card.ts:433/867` toast. **NOTE:** the SW `fetch` may also see `req.destroy()` as a network error → falls into path 1 (`"Host unreachable: …"`). Both are visible toasts — neither is silent. D-04 pre-flight avoids this ambiguity by blocking before POST. | ✅ YES (but see D-04 ambiguity note) |
| 4 | **SW evicted mid-flight** | `card.ts:412` / `card.ts:848` / `chip.ts:478` — `if (chrome.runtime.lastError \|\| !resp)` guard | `card.ts:413-416` → `'Extension error: ' + (chrome.runtime.lastError?.message ?? 'no response')`. `chip.ts:479` → `'SW error: ' + (… ?? 'no response')` | ✅ YES |
| 5 | **No host mapped for origin** | `background.ts:303-305` returns `{ok:false, error: \`No host mapped for origin: ${origin}\`}` (and `GET_ROUTE` path returns `reason:'unmapped'` which `chip.ts:244` renders as a dropdown, not a toast) | `card.ts:433/867` toast renders `"No host mapped for origin: …"`. The chip's *unmapped* state is a dropdown (pre-Send), not a Send failure — distinct from a Send-time no-host error. | ✅ YES |

**Capture-failure (adjacent, not one of the 5 named):** `card.ts:246` (`'Screenshot capture failed'`), `card.ts:616` (`'Screenshot capture failed'`), `card.ts:804` (`'Screenshot capture failed — note not sent'`). These are also toasts. The mapper should **leave these as-is** unless trivially absorbable — they are capture-pipeline errors, not Send-relay errors. `[VERIFIED: codebase grep card.ts]`

### Exact catch sites the mapper consolidates (D-01a — preserve verbatim)

| File:line | Context | Current behavior to preserve |
|-----------|---------|------------------------------|
| `card.ts:411-423` | `_doSend` (free) `sendMessage` callback | `lastError\|\|!resp` → `'Extension error: '+…`; restore controls |
| `card.ts:431-441` | `_doSend` (free) `resp.ok===false` branch | `showToastFn(resp.error, true)`; restore controls; re-apply disabled rule |
| `card.ts:425-428` | `_doSend` success | `showToastFn(\`wrote notes\\${resp.file}\`, false)` (success string — also part of taxonomy) |
| `card.ts:847-857` | `_doElementSend` `sendMessage` callback | identical `lastError\|\|!resp` → `'Extension error: '+…` |
| `card.ts:859-871` | `_doElementSend` ok/err branches | `showToastFn(resp.error,true)` / success `\`wrote notes\\${resp.file}\`` |
| `chip.ts:478-488` | `wireSendButton` callback | `lastError\|\|!resp` → `'SW error: '+…`; ok → `\`sent ✓ ${resp.file}\``; err → `resp.error` |

> **Critical D-01a observation:** `card.ts` uses `'Extension error: '` and the success format `wrote notes\<file>`, while `chip.ts` uses `'SW error: '` and `sent ✓ <file>`. These differ by call-site. The mapper MUST either (a) accept a per-call-site prefix/format parameter, or (b) the planner accepts that the chip is a Phase-3 *relay-proof stub* (`chip.ts:7` "Stub Send") whose feedback strings are not user-facing production toasts. **Recommendation:** treat `card.ts` strings as the canonical production taxonomy; consolidate both `_doSend` and `_doElementSend` (which are byte-identical in their error handling) behind the mapper. For `chip.ts`, the planner decides whether to route it through the mapper with a `feedbackStyle:'chip'` variant or leave the stub untouched — either honors D-01a as long as no *card* toast string changes. `[VERIFIED: codebase grep]`

---

## Standard Stack

**No new dependencies.** This phase adds tests + a pure mapper + a pure size-check + a script extension. The full existing stack is reused.

### Core (existing — reused, not added)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | Node 20+ builtin | Mapper unit tests, concurrency integration test, payload-boundary test | Already the project's sole test runner (`test:lib`, `test`); zero-dep |
| `node:assert/strict` | Node 20+ builtin | Assertions | Already used in every test file |
| TypeScript | 6.0.3 | Compile lib + host tests | Existing `tsconfig.lib.json` / `tsconfig.host.json` wiring |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:test` integration test against `createHostServer` | A mocking library / supertest | Project has a proven booted-server harness (`server.test.ts` `buildFixture`/`listenFixture`); adding a dep violates the zero-runtime-dep host constraint and the MIT clean-room posture. **Do not add.** |
| Pure `lib/error-toast.ts` | Inline switch in each call-site | Inline duplicates the taxonomy across 3 sites — exactly what D-01 forbids. |

**Installation:** None.

## Package Legitimacy Audit

> Not applicable — this phase installs **zero** external packages. All work uses Node builtins (`node:test`, `node:assert`) and existing project dependencies (already audited in Phase 1, verified 2026-05-31 in CLAUDE.md). No `npm install` step. slopcheck gate is N/A.

---

## Architecture Patterns

### System Architecture Diagram (Send-failure data flow)

```
                         ┌─────────────────────────────────────────────┐
  USER clicks Send       │  CONTENT SCRIPT (entrypoints/review.content) │
  ───────────────►       │                                              │
                         │  card.ts _doSend / _doElementSend            │
                         │  chip.ts wireSendButton (stub)               │
                         │       │                                      │
   D-04 PRE-FLIGHT  ◄────┤  [NEW] lib/payload-size.ts check            │
   (encoded size)        │       │  oversize? → toast, ABORT (no POST)  │
                         │       ▼                                      │
                         │  chrome.runtime.sendMessage(SEND_ANNOTATION) │
                         └───────┬──────────────────────────────────────┘
                                 │ (channel may DIE here = path #4)
                                 ▼
                         ┌─────────────────────────────────────────────┐
                         │  SERVICE WORKER (background.ts)              │
                         │  handleSendAnnotation                        │
                         │   ├─ no host for origin → {ok:false,error}   │ path #5
                         │   ├─ no token           → {ok:false,error}   │ path #2b
                         │   ├─ fetch throws       → {ok:false,error}   │ path #1
                         │   └─ fetch resolves ──────────┐              │
                         └────────────────────────────────┼─────────────┘
                                 │ HTTP POST 127.0.0.1     │
                                 ▼                         │
                         ┌─────────────────────────────────────────────┐
                         │  HOST (host/src/server.ts handleAnnotation)  │
                         │   ├─ bad token  → 401 'unauthorized'         │ path #2
                         │   ├─ >12MB body → 413 'Payload Too Large'    │ path #3 (D-04 backstop)
                         │   ├─ bad JSON   → 400 'invalid JSON'         │
                         │   └─ ok → withSerialLock(getNextSerial+write)│ ← D-02 concurrency proof
                         └─────────────────────────────────────────────┘
                                 │ {ok,file,serial} | {ok:false,error}
                                 ▼
                         SW maps non-2xx → {ok:false, error}  (background.ts:350-360)
                                 ▼
                         CS callback → [NEW] mapErrorToToast(input) → showToast(...)
                                                  ▲
                                       single source of truth (D-01)
```

### Recommended Project Structure (additions only)

```
lib/
├── error-toast.ts          # [NEW] pure mapper: failure input → toast string (D-01)
├── payload-size.ts         # [NEW] pure encoded-size pre-flight check (D-04)
└── test/
    ├── error-toast.test.ts # [NEW] per-path mapper unit tests (D-01)
    └── payload-size.test.ts# [NEW] 11.9MB ok / 12MB reject boundary (D-04)
host/
└── test/
    └── server.test.ts      # [EXTEND] add 10-concurrent describe-block (D-02)
                            #          + 11.9MB/12MB host boundary (D-04 backstop)
scripts/
└── clean-room-check.mjs    # [EXTEND] banned set + self-audited constants (D-03)
.planning/phases/08-…/
└── 08-UAT.md (or RUNBOOK)  # [NEW] thin manual Chrome runbook (D-01/D-05)
```

> **Wiring requirements (do not miss):**
> - `lib/error-toast.ts` and `lib/payload-size.ts` MUST be added to `tsconfig.lib.json` `include[]` (currently lists each lib file explicitly — line 13-25).
> - The new test files MUST be appended to the `test:lib` script's explicit `node --test dist/lib/lib/test/*.js` file list in `package.json:11` (the runner does NOT glob — it lists every file).
> - The pure modules MUST have **zero top-level `chrome`/`document`/`window` access** (the `capture.ts` invariant, lib/capture.ts:5-10) so they import cleanly under node:test. Browser-only behavior (calling `showToast`) stays in the content script; the mapper returns a string + an `isError` boolean.

### Pattern 1: Pure mapper returning a render-ready descriptor
**What:** `mapSendError(input): { message: string; isError: true }` where `input` is a discriminated union covering `{ kind:'channel-dead', lastErrorMessage?:string }` | `{ kind:'relay-error', error:string }`. The mapper reproduces the exact current strings.
**When to use:** Every `card.ts` Send callback.
**Example (shape, original code — NOT from any external source):**
```typescript
// lib/error-toast.ts — pure, node:test-safe (no chrome/DOM at module level)
export type SendOutcome =
  | { kind: 'ok'; file: string }
  | { kind: 'channel-dead'; lastErrorMessage?: string }   // path #4 SW eviction
  | { kind: 'relay-error'; error: string };               // paths #1,#2,#2b,#3,#5

export interface ToastSpec { message: string; isError: boolean; }

export function mapSendOutcome(o: SendOutcome): ToastSpec {
  switch (o.kind) {
    case 'ok':
      // VERBATIM from card.ts:427 — D-01a
      return { message: `wrote notes\\${o.file}`, isError: false };
    case 'channel-dead':
      // VERBATIM from card.ts:413-415 — D-01a
      return { message: 'Extension error: ' + (o.lastErrorMessage ?? 'no response'), isError: true };
    case 'relay-error':
      // VERBATIM from card.ts:433 — host-derived string passed straight through
      return { message: o.error, isError: true };
  }
}
```
> The mapper does NOT classify *which* of paths #1/#2/#3/#5 occurred — those already arrive as a single host-derived `error` string (the SW already did the HTTP→string mapping at `background.ts:350-360`). The taxonomy the *client* mapper must distinguish is exactly two: **dead channel** (`lastError||!resp`) vs **relay error** (`resp.ok===false`). This matches the existing branching at `card.ts:412` vs `card.ts:431`. The per-path *messages* are tested by feeding the mapper each representative `error` string. `[VERIFIED: codebase card.ts:408-443]`

### Pattern 2: Pre-flight encoded-size check (D-04)
**What:** Compute the byte length of the JSON the SW will POST, compare against the 12 MB cap *minus the host's own counting basis*. The host counts **raw request-body bytes** (`security.ts:48-55` sums `chunk.length` of UTF-8 bytes). The CS must compute the same basis: `new TextEncoder().encode(JSON.stringify(payload)).length`.
**Why base64 inflation matters:** screenshots are `data:image/png;base64,…` strings inside the JSON. A base64 PNG is ~33% larger than the raw image. The check operates on the **already-encoded JSON string**, so inflation is already included — do NOT try to back-calculate raw image bytes.
**Threshold:** host cap is exactly `12 * 1024 * 1024 = 12582912` bytes (`security.ts:12`). Pre-flight should reject at the **same** boundary the host rejects (`> MAX_BODY`), so 11.9 MB passes and ≥12 MB+1 fails — matching SC-3 ("near-12 MB rejected, 11.9 MB succeeds").
**Example (original):**
```typescript
// lib/payload-size.ts — pure, node:test-safe
export const MAX_BODY_BYTES = 12 * 1024 * 1024; // mirror host/src/security.ts:12

/** Returns the UTF-8 byte length the host will count for this JSON string. */
export function encodedBodyBytes(jsonBody: string): number {
  return new TextEncoder().encode(jsonBody).length;
}

/** true if the body would be rejected by the host's >12MB 413 guard. */
export function exceedsBodyCap(jsonBody: string): boolean {
  return encodedBodyBytes(jsonBody) > MAX_BODY_BYTES;
}
```
> **Insertion point:** in `card.ts` `_doSend` (line ~405, after `payload` is assembled) and `_doElementSend` (line ~841, after the `payload` with `screenshots[]` is assembled), *before* `chrome.runtime.sendMessage(SEND_ANNOTATION)`. If `exceedsBodyCap(JSON.stringify(payload))`, call `showToastFn` with a clear message and restore controls (mirroring the existing error-branch control-restore), then `return` — no SW round-trip. **The toast string is new (no existing string to preserve), so D-01a does not constrain it; pick a clear message** e.g. `"Screenshot too large to send (over 12 MB) — remove a capture and retry"`. `[VERIFIED: codebase security.ts:12, card.ts:392-409]`
>
> **Note:** `TextEncoder` IS available in content scripts (it's a global Web API), so this is safe to call from `card.ts`. It is also available in Node 20+ globally, so the pure lib test runs without import. `[VERIFIED: codebase — capture.ts already uses btoa/Uint8Array in SW context]`

### Pattern 3: 10-concurrent integration test (D-02)
**What:** Boot the host server via the *existing* `buildFixture()`/`listenFixture()` harness in `host/test/server.test.ts`, fire 10 `POST /annotation` with `Promise.all`, assert 10 distinct files `0001`–`0010`.
**Why extend `server.test.ts` and not `serial.test.ts`:** D-02 says "extends the existing `host/test/serial.test.ts` *patterns*" — but the *integration* (booted HTTP server + token + real `withSerialLock` through `handleAnnotation`) requires the `createHostServer` fixture, which lives in `server.test.ts`. `serial.test.ts` tests the mutex *in isolation* (no HTTP). **Recommendation:** add the 10-concurrent test as a new `describe` block in `server.test.ts` (real end-to-end serial proof through the HTTP layer), and optionally bump `serial.test.ts`'s existing 2-concurrent unit test to 10 for unit-level coverage. The planner has discretion (CONTEXT.md) on file placement — document both in the plan.
**How the harness boots + obtains a token:** `server.test.ts:24` defines `TEST_TOKEN`; `buildFixture()` (line 33) calls `resolveConfig({root, token: TEST_TOKEN})` + `ensureNotesDir`; `listenFixture()` (line 44) binds `server.listen(0, '127.0.0.1')` and reads the assigned port from `server.address()`. The token is passed as the `X-Stickyfix-Token` header on each POST.
**Example (original, extends existing fixture):**
```typescript
it('10 concurrent POST /annotation yield serials 0001-0010 with no gaps/dupes (REL-02/SC-2)', async () => {
  const post = (i: number) => fetch(`${fixture.baseUrl}/annotation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stickyfix-Token': TEST_TOKEN },
    body: JSON.stringify({
      mode: 'free', comment: `concurrent ${i}`,
      page: { url: 'http://localhost:5173/c', title: 'C' },
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    }),
  }).then(r => r.json() as Promise<{ ok: boolean; serial: string }>);

  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => post(i)));
  const serials = results.map(r => r.serial).sort();
  assert.deepEqual(serials, ['0001','0002','0003','0004','0005','0006','0007','0008','0009','0010']);

  const { readdirSync } = await import('node:fs');
  const md = readdirSync(fixture.cfg.notesDir).filter(f => /^\d{4}-.*\.md$/.test(f));
  assert.equal(md.length, 10, 'exactly 10 distinct .md files, no dupes');
});
```
> **Determinism note:** `Promise.all` fires the 10 `fetch` calls before awaiting any — they hit the host nearly simultaneously. The host's `withSerialLock` (a single module-level promise queue, `serial.ts:9`) serializes the `getNextSerial`+`writeNote` critical section, so no two reads of `getNextSerial` see the same max. This is exactly the race the mutex defends. `getNextSerial` re-reads the directory inside the lock (`server.ts:125-128`), so each call sees the prior write. `[VERIFIED: codebase serial.ts + server.ts:123-130]`

### Pattern 4: Payload-boundary host test (D-04 backstop)
The existing `security.test.ts:97-117` already tests "over 12 MB → 413" at the `readBody` unit level, and `server.test.ts:477-502` tests >12MB PUT → 413/reset. **Add the matching pair for `POST /annotation`:** an 11.9 MB body returns 200, a 12 MB+1 body returns 413 (or connection-reset, per the existing PUT test's tolerance at `server.test.ts:478-501`). Reuse the chunked-write pattern from `security.test.ts:101-110` to avoid a giant single allocation.

### Anti-Patterns to Avoid
- **Changing any card.ts toast string while consolidating** — violates D-01a. Copy strings byte-for-byte into the mapper; the mapper's test asserts the exact output string.
- **Adding a test framework or HTTP mock** — violates zero-dep host constraint. Use the booted `createHostServer` fixture.
- **Computing pre-flight size from raw image dimensions** — the encoded JSON (with base64) is the only correct basis; the host counts JSON bytes, so the CS must too.
- **Asserting an exact 413 status in the oversize host test without tolerating ECONNRESET** — `req.destroy()` may reset the socket before the 413 is readable (the existing PUT test at `server.test.ts:478-501` documents and tolerates this). Mirror that tolerance.
- **Opening the GPL upstream to find more banned tokens** — violates D-03 no-peek. Self-audit OUR repo only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Serial mutex under concurrency | A new locking scheme | Existing `withSerialLock` (`serial.ts`) | Already correct + tested; D-02 only *proves* it at scale |
| Body-size enforcement on host | A new size guard | Existing `readBody` 12 MB cap (`security.ts`) | Already the 413 backstop; D-04 reuses it |
| Booted-server test harness | A bespoke server spin-up | `buildFixture`/`listenFixture` (`server.test.ts:33-63`) | Proven, handles bind/teardown/tmpdir cleanup |
| UTF-8 byte counting | Manual byte math | `new TextEncoder().encode(s).length` | Matches the host's `Buffer.byteLength`-equivalent counting exactly |
| Recursive repo walk for audit | New walker | Existing `walk()` in `clean-room-check.mjs:65-97` | Already cross-platform, has SKIP_DIRS/SKIP_FILENAMES |

**Key insight:** Phase 8 builds almost nothing new — it *consolidates*, *proves*, and *extends*. The biggest risk is a regression in the consolidation (D-01a), not a missing capability.

## Runtime State Inventory

> This phase contains a refactor (D-01 mapper consolidation) and a string-audit (D-03). It touches identifiers and toast strings, so a Runtime State Inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — the mapper refactor changes no persisted data. Notes on disk, `chrome.storage.local` registry/tokens/originMap are untouched. Verified: D-01 only moves toast-string logic; no storage key or note-frontmatter field changes. | None |
| Live service config | **None** — no host CLI flags, ports, or `--root` semantics change. Verified by scope: D-01..D-05 add tests + a mapper + a script extension. | None |
| OS-registered state | **None** — no OS-level registration exists in this project (no Task Scheduler, no systemd, no pm2). The host is run manually via `npm run host`. Verified: `package.json` scripts, no install/daemon step. | None |
| Secrets/env vars | **None changed** — token handling (`X-Stickyfix-Token`, `STICKYFIX_TOKEN` env, `.stickyfix-token` file) is untouched. The 401 path is *tested*, not modified. | None |
| Build artifacts | `dist/lib/**` and `dist/host/**` are regenerated by `tsc` on every `test:lib`/`test`. **New** `lib/error-toast.ts`/`lib/payload-size.ts` will produce `dist/lib/lib/error-toast.js` etc.; the `test:lib` script's explicit file list must be updated or the new tests won't run. | Update `package.json:11` `test:lib` file list; add to `tsconfig.lib.json include[]` |

**D-03 audit-specific note:** the clean-room check scans **source**, including the new test files and the new lib modules. Any banned token (`__opc_`, `opencode`, `JodusNodus`) or self-audited selector constant accidentally introduced in Phase 8's own code would fail the gate. The new files must be clean. `[VERIFIED: clean-room-check.mjs:65-97 walks process.cwd() recursively]`

## Common Pitfalls

### Pitfall 1: SW-eviction-mid-flight is NOT separately detectable from a generic dead channel
**What goes wrong:** Planner tries to write a test that distinguishes "SW was evicted" from "SW threw" — but from the content script's vantage there is only one signal: `chrome.runtime.lastError` is set OR `resp` is `undefined` after `sendMessage`.
**Why it happens:** MV3 service workers are ephemeral; Chrome terminates them after ~30s idle, and a SW terminated *while a message is in flight* closes the channel → the CS callback fires with `lastError` ("message channel closed before a response was received" / "The message port closed before a response was received") and `resp === undefined`. This is the *same* code path as any other channel failure. `[CITED: developer.chrome.com/docs/extensions migrate-to-service-worker; VERIFIED: w3c/webextensions issue #16]`
**How to avoid:** The existing guard `if (chrome.runtime.lastError || !resp)` at `card.ts:412`/`card.ts:848`/`chip.ts:478` already covers it. **Path #4's toast is the `'Extension error: …'` / `'SW error: …'` toast.** The mapper's `channel-dead` case IS the SW-eviction surface. For the manual UAT (D-01/D-05), repro by: enter Review Mode, open `chrome://serviceworker-internals` or `chrome://extensions` → click "service worker" → "Stop", then immediately Send — or simply wait >30s idle so the SW evicts, then Send (the SW re-spawns; the *first* message after a cold eviction during an in-flight send is the risk window). The deterministic *unit-testable* assertion is: mapper given `{kind:'channel-dead'}` returns the exact `'Extension error: no response'` string.
**Warning signs:** A test that tries to literally kill the SW in node:test — impossible (no Chrome runtime in node:test). Keep SW-eviction as a *manual UAT* line + a *mapper unit test* on the `channel-dead` input.

### Pitfall 2: 413 may surface as "Host unreachable" not "Payload Too Large"
**What goes wrong:** The host's `readBody` calls `req.destroy()` on the oversize body (`security.ts:53`). This can reset the TCP connection *before* the 413 response is flushed, so the SW's `fetch` rejects with a network error → `background.ts:326` returns `"Host unreachable: …"` instead of `"Payload Too Large"`.
**Why it happens:** `req.destroy()` is a hard socket close; the 413 write races the reset.
**How to avoid:** This is **why D-04 mandates a CS pre-flight** — the pre-flight blocks the oversize POST entirely, giving a deterministic, clear toast *before* the ambiguous host behavior. The host 413 remains the backstop for payloads that somehow bypass pre-flight. The host-side boundary test should tolerate *either* 413 *or* connection-reset for the oversize case (mirror `server.test.ts:478-501`).
**Warning signs:** A flaky host test asserting `status === 413` strictly. Use the tolerant pattern.

### Pitfall 3: `test:lib` / `test` runners do NOT glob — new test files are silently skipped
**What goes wrong:** Author adds `lib/test/error-toast.test.ts`, runs `npm run test:lib`, sees green — but the new test never ran because `package.json:11` lists each compiled test file explicitly and the new one isn't in the list.
**Why it happens:** `node --test dist/lib/lib/test/routing.test.js dist/lib/lib/test/...` is an explicit file list, not a glob.
**How to avoid:** Append `dist/lib/lib/test/error-toast.test.js` and `dist/lib/lib/test/payload-size.test.js` to the `test:lib` command, and add the source files to `tsconfig.lib.json include[]`. The host test extension goes into existing `server.test.ts` (already in the `test` list) so no script change is needed there. **Verify the new tests actually execute** (count assertions in output). `[VERIFIED: package.json:11-12]`

### Pitfall 4: clean-room self-trip on banned-token additions
**What goes wrong:** Adding new banned tokens as plain string literals in `clean-room-check.mjs` makes the script match *itself* → false-positive failure.
**Why it happens:** The script scans `.mjs` files including itself.
**How to avoid:** Follow the existing fragment-construction pattern (`clean-room-check.mjs:17-24`): `new RegExp('__' + 'opc' + '_', 'i')` so the literal never appears intact in the source. Any new self-audited constant must use the same split-fragment trick OR be added to a data structure that the existing SKIP logic excludes. **Also: `clean-room-check.mjs` itself is a `.mjs` at repo root — it is NOT in `SKIP_FILENAMES`**, so it is scanned. `[VERIFIED: clean-room-check.mjs:11-24, 49-55]`

### Pitfall 5: D-03 self-audit must search for selector/magic-string constants without a reference list
**What goes wrong:** "Upstream selector constants" (SC-4) implies specific strings, but D-03 forbids opening the upstream to learn them.
**Why it happens:** The success criterion names "upstream selector constants" but no-peek means we can't enumerate them from the source.
**How to avoid:** Self-audit *our* repo for *suspicious* magic strings — e.g. grep our `element-context.ts` / curated computed-styles config (ELEM-04 mentions a "single config constant") for any string that looks copied rather than original, any unusual data-attribute names, any verbatim CSS-selector arrays. The banned set = known tokens + any string *we* judge provenance-risky in *our own* code. If our code is genuinely original (clean-room from spec, per CLAUDE.md), the self-audit may find nothing new to ban beyond the three known tokens — and that is a valid PASS. Document the self-audit method + result in `CLEAN-ROOM.md` (CONTEXT.md canonical ref). `[VERIFIED: CONTEXT.md D-03, ROADMAP.md SC-4]`

## Code Examples

All load-bearing examples are inline in the Architecture Patterns section above (mapper shape, pre-flight check, 10-concurrent test, boundary test). They are original code derived from the existing codebase patterns — no external source.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-call-site inline error handling (3 duplicated sites) | Single typed mapper (`lib/error-toast.ts`) | This phase (D-01) | One source of truth; future error-string changes happen once |
| 2-concurrent unit test only (`serial.test.ts:31`) | 10-concurrent end-to-end HTTP integration test | This phase (D-02) | Proves the mutex through the real server stack at stress |
| Host-only 413 guard | CS pre-flight + host 413 backstop | This phase (D-04) | Saves a ~12 MB wasted round-trip; deterministic toast |

**Deprecated/outdated:** Nothing. No library version churn touches this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `chip.ts` Send is a Phase-3 relay-proof *stub* whose feedback strings are not production-critical user-facing toasts (so D-01a's "sacred" constraint applies primarily to `card.ts`). | Failure-Path Inventory / Pattern 1 | If the chip's Send is considered production, the mapper must also reproduce `'SW error: …'` and `sent ✓ <file>` verbatim with a chip-variant. **Planner should confirm with user.** Low risk — chip.ts:7 explicitly says "Stub Send". `[ASSUMED]` |
| A2 | The new D-04 pre-flight toast string is unconstrained (no existing string to preserve) and may be authored fresh. | Pattern 2 | If a specific wording is expected, it's a one-line change. Very low risk. `[ASSUMED]` |
| A3 | The oversize host POST test should tolerate ECONNRESET (not strictly assert 413), mirroring the existing PUT oversize test. | Pitfall 2 / Pattern 4 | If strict 413 is required, the test may flake. Mitigation is already documented in the existing PUT test. `[ASSUMED — but strongly evidenced by server.test.ts:478-501]` |

**Note:** No assumption affects compliance, security model, or data retention — these are test/refactor-shape choices the planner+user can confirm cheaply.

## Open Questions

1. **Should `chip.ts` route through the mapper, or is it out of scope as a stub?**
   - What we know: `chip.ts:7` labels it a "Stub Send (relay proof)"; its strings differ from `card.ts`.
   - What's unclear: whether Phase 8 wants the stub consolidated too.
   - Recommendation: Consolidate `card.ts` `_doSend` + `_doElementSend` (production paths) definitively. For `chip.ts`, the planner proposes either a mapper variant or leaving the stub — flag in PLAN for a quick user confirm. Either honors D-01a.

2. **Exact placement of the 10-concurrent test: new `describe` in `server.test.ts` vs. bumping `serial.test.ts`.**
   - What we know: D-02 says "extends serial.test.ts patterns"; the integration needs the `server.test.ts` fixture.
   - Recommendation: integration block in `server.test.ts` (authoritative end-to-end proof) + optionally bump the `serial.test.ts` unit test to 10. CONTEXT.md grants file-placement discretion.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | host tests, lib tests, host runtime | ✓ (assumed — project requires Node 20+) | 20+ | — |
| `node:test` / `node:assert` | all new tests | ✓ builtin | Node 20+ | — |
| TypeScript (`tsc`) | compile lib + host before test | ✓ (devDep 6.0.3) | 6.0.3 | — |
| Chrome/Chromium | manual UAT only (D-01/D-05 runbook) | ✓ (dev machine) | MV3-capable | UAT is manual; not a CI gate |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — all automated gates run under existing Node + tsc. Chrome is needed only for the *manual* UAT runbook, which is explicitly non-blocking (D-01 "thin manual Chrome UAT", D-02a, D-05 "short runbook").

## Validation Architecture

> `.planning/config.json` was not read for an explicit `nyquist_validation:false`; treating as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (Node 20+ builtin) |
| Config file | none — runner invoked via npm scripts with explicit file lists |
| Quick run command | `npm run test:lib` (lib/mapper/payload-size unit tests) |
| Full suite command | `npm run check` (tsc ×2 + clean-room + host smoke + test:lib + test) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REL-01 / SC-1 | Mapper returns verbatim toast for `channel-dead` (path #4) | unit | `npm run test:lib` → `error-toast.test.js` | ❌ Wave 0 |
| REL-01 / SC-1 | Mapper returns verbatim host-error string for `relay-error` (paths #1,#2,#2b,#3,#5) | unit | `npm run test:lib` → `error-toast.test.js` | ❌ Wave 0 |
| REL-01 / SC-1 | Mapper success string `wrote notes\<file>` (taxonomy completeness) | unit | `npm run test:lib` | ❌ Wave 0 |
| REL-01 / SC-1 | All 5 paths produce a *visible* toast at runtime | manual UAT | `08-UAT.md` runbook (non-blocking) | ❌ Wave 0 |
| REL-02 / SC-2 | 10 concurrent POST → serials 0001-0010, no gaps/dupes | integration | `npm test` → `server.test.js` | ⚠️ EXTEND `server.test.ts` |
| REL-02 / SC-2 | 2-note serial increment 0001→0002 (existing) | unit | `npm test` → `serial.test.js` | ✅ exists (`serial.test.ts:31`) |
| REL-03 / SC-3 | Pre-flight: 11.9 MB body passes, 12 MB+1 rejected | unit | `npm run test:lib` → `payload-size.test.js` | ❌ Wave 0 |
| REL-03 / SC-3 | Host backstop: POST 11.9 MB → 200, 12 MB+1 → 413/reset | integration | `npm test` → `server.test.js` | ⚠️ EXTEND `server.test.ts` |
| REL-03 / SC-3 | `readBody` >12 MB → 413 (existing unit) | unit | `npm test` → `security.test.js` | ✅ exists (`security.test.ts:97`) |
| SC-4 | grep for `__opc_`/`opencode`/`JodusNodus`/self-audited constants → 0 matches | static | `node scripts/clean-room-check.mjs` (in `npm run check`) | ⚠️ EXTEND `clean-room-check.mjs` |
| D-05 | SW-eviction state survival + subsequent Send routes; multi-note increment | manual UAT | `08-UAT.md` runbook (non-blocking) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:lib` (fast — pure lib tests, no server boot)
- **Per wave merge:** `npm test` (host integration incl. concurrency + boundary)
- **Phase gate:** `npm run check` green (all of the above + clean-room + host smoke) before `/gsd:verify-work`; then the manual `08-UAT.md` runbook.

### Wave 0 Gaps
- [ ] `lib/error-toast.ts` + `lib/test/error-toast.test.ts` — covers REL-01 (mapper per path)
- [ ] `lib/payload-size.ts` + `lib/test/payload-size.test.ts` — covers REL-03 (pre-flight boundary)
- [ ] Extend `host/test/server.test.ts` — 10-concurrent block (REL-02) + POST 11.9/12 MB boundary (REL-03)
- [ ] Extend `scripts/clean-room-check.mjs` — banned set + self-audited constants (SC-4)
- [ ] Wire new lib files into `tsconfig.lib.json include[]` and `package.json:11` `test:lib` file list
- [ ] `08-UAT.md` runbook — 5 failure-path manual confirmations + D-05 SW-eviction + multi-note increment
- [ ] Framework install: none — `node:test` is builtin

## Security Domain

> `security_enforcement` not found as `false` in config → treated as enabled. This phase *hardens* an existing security model; it must not weaken it.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `X-Stickyfix-Token` constant-time check (`security.ts:checkToken`, timingSafeEqual) — 401 path *tested*, not modified |
| V3 Session Management | no | No sessions; single local token per host |
| V4 Access Control | yes | IDOR guards (`background.ts` bind `tabId` to `sender.tab.id`); path-confinement (`isInsideDir`). Untouched — Phase 8 adds tests around the 401 path only |
| V5 Input Validation | yes | Payload shape guard (`server.ts:109-121`); D-04 adds a *client* pre-flight size guard (defense-in-depth, not a replacement for host validation) |
| V6 Cryptography | yes | `timingSafeEqual` token compare (existing). No new crypto. Never hand-roll. |
| V12 Files/Resources | yes | 12 MB body cap + path-traversal guard (existing). D-04 pre-flight reduces DoS surface by blocking oversize before the SW round-trip |

### Known Threat Patterns for stickyfix (MV3 + localhost host)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Origin spoofing (page claims a different host) | Spoofing | Origin derived from `chrome.tabs.get(tabId).url`, never message body (`background.ts:295`) — invariant preserved |
| Token exfiltration to page | Information Disclosure | Token lives in `chrome.storage.local`, attached only inside SW relay; never reaches CS/page (`background.ts` comments T-03-02) — preserved |
| Oversize-body DoS | Denial of Service | Host 12 MB cap → 413 (`security.ts:12`); D-04 adds CS pre-flight (defense-in-depth) |
| Cross-tab note enumeration (IDOR) | Information Disclosure | `tabId` bound to `sender.tab.id` in list/edit/delete/screenshot handlers (`background.ts:817+`) — preserved |
| GPL-identifier leakage (provenance) | (Legal/compliance) | `clean-room-check.mjs` zero-match gate in `npm run check` — extended by D-03 |

> **Security invariant for the planner:** Phase 8 is *additive*. The D-01 mapper refactor must not remove the `chrome.runtime.lastError || !resp` guard (it is the SW-eviction safety net) and must not change origin/token derivation. The D-04 pre-flight is an *additional* client guard, NOT a replacement for the host's authoritative 413 — the host backstop must remain. `[VERIFIED: background.ts:294-329, security.ts:42-68]`

## Sources

### Primary (HIGH confidence)
- Codebase (direct read, 2026-06-03): `entrypoints/review.content/{index,toast,card,chip}.ts`, `entrypoints/background.ts`, `host/src/{serial,security,server}.ts`, `host/test/{serial,security,server,index}.test.ts`, `lib/{capture,types}.ts`, `lib/test/marquee.test.ts`, `scripts/clean-room-check.mjs`, `package.json`, `tsconfig.lib.json` — all file:line citations above
- `.planning/phases/08-…/08-CONTEXT.md` — locked decisions D-01..D-05
- `.planning/REQUIREMENTS.md` — REL-01/02/03; `.planning/ROADMAP.md` — Phase 8 SC-1..SC-4
- `CLAUDE.md` (project) — clean-room MIT constraint, sfx-* namespace, host security model

### Secondary (MEDIUM confidence)
- [developer.chrome.com — Migrate to a service worker](https://developer.chrome.com/docs/extensions/mv3/migrating_to_service_workers/) — MV3 SW ephemerality / ~30s idle termination
- [w3c/webextensions issue #16 — what happens when a MV3 SW is shut down before answering a message](https://github.com/w3c/webextensions/issues/16) — channel-closed-before-response semantics
- [net-informations — "message channel closed before a response was received"](https://net-informations.com/q/mis/closed.htm) — the exact lastError surface for path #4

### Tertiary (LOW confidence)
- None relied upon.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all reuse verified in `package.json` + test files
- Architecture (5 failure paths, mapper, pre-flight, concurrency): HIGH — every claim cited to file:line in current code
- Pitfalls: HIGH — derived from existing code comments + the documented PUT-oversize tolerance + verified MV3 lifecycle
- SW-eviction surfacing: HIGH — the single `lastError||!resp` signal is confirmed in both code and MV3 docs

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (stable — pinned deps, no fast-moving surface; the only external fact is MV3 SW lifecycle which is settled)
