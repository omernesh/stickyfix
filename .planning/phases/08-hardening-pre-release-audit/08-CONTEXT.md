# Phase 8: Hardening + Pre-Release Audit - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the product is release-grade against its core reliability promise: **no
silent drops**. This phase delivers (1) a verified guarantee that every known
failure path surfaces a visible toast, (2) serial-integrity proof under
concurrent Send, (3) a graceful large-payload guard, and (4) a zero-match GPL
clean-room audit. It is a hardening/verification phase — it adds tests, a thin
error-handling consolidation, and an extended audit, **not** new product
capabilities. Requirements: REL-01, REL-02, REL-03 (+ SC-4 GPL audit).

</domain>

<decisions>
## Implementation Decisions

### Error-Path Coverage (REL-01)
- **D-01:** Route all Send failure handling through a single typed **error→toast
  mapper** (one source of truth mapping each failure to its toast message). Cover
  all five paths: host unreachable, 401 token mismatch, 413 body-too-large, SW
  evicted mid-flight, and no-host-for-origin. Unit-test the mapper per path, then
  a thin manual Chrome UAT runbook for runtime confirmation.
- **D-01a (regression guardrail — MANDATORY):** The mapper **consolidates** the
  existing catch sites in `entrypoints/review.content/` without changing any
  currently-working toast message text or trigger behavior. Absorb the existing
  toast strings verbatim; this is a refactor for a single source of truth, not a
  UX change. Working toasts are sacred — no regression.

### Concurrent-Send Stress (REL-02)
- **D-02:** The blocking automated gate is a **host integration test**: fire 10
  concurrent `POST /annotation` at a booted host in `node:test`, assert files
  `0001`–`0010` exist with no gaps or duplicates. Extends the existing
  `host/test/serial.test.ts` patterns; deterministic and CI-able.
- **D-02a:** A manual extension-driven rapid multi-Send is folded into the
  regression UAT runbook (D-05) — **not** a blocking automated gate.

### GPL Clean-Room Audit (SC-4)
- **D-03:** **No-peek policy.** Do NOT open the GPL-3.0 upstream to source the
  banned list. The audit's banned set = the tokens we already know
  (`__opc_`, `opencode`, `JodusNodus`) PLUS any suspicious magic strings /
  selector constants surfaced by a **self-audit of our own repo**. Extend
  `scripts/clean-room-check.mjs` accordingly; it must return zero matches across
  the entire repo and continue running in `npm run check`. Absolute clean-room
  hygiene — the MIT-vs-GPL provenance constraint outranks audit completeness.

### Large-Payload Guard (REL-03)
- **D-04:** Extension-side **pre-flight encoded-size check** before POST — if the
  payload will exceed the cap, show a clear toast immediately and skip the wasted
  ~12 MB round-trip. The host **413** remains the backstop (defense in depth).
  Test both boundaries: an 11.9 MB payload succeeds; a ~12 MB payload is rejected
  (pre-flight on the extension side, 413 on the host side).

### Idle-Eviction Regression Scope
- **D-05:** Targeted regression, not a full re-run of every prior-phase UAT.
  Re-verify: (a) state survival across SW idle eviction with a subsequent Send
  still routing correctly (Phase 3 SC-4 re-confirmation), and (b) multi-note
  serial increment (`0001` → `0002`). Document as a short runbook.

### Claude's Discretion
All four presented gray areas were delegated to Claude ("you decide"). The
decisions above are the locked resolutions. Planner has latitude on:
- The exact shape/location of the error-taxonomy type (e.g., discriminated union
  vs. error-code enum) and the mapper's module path, provided D-01a is honored.
- Test file naming/placement within the existing `host/test/` and `lib/test/`
  conventions.
- Whether the pre-flight size check lives in a shared `lib/` util or inline in the
  Send path — provided it is unit-testable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Reliability requirements & criteria
- `.planning/ROADMAP.md` §"Phase 8: Hardening + Pre-Release Audit" — goal, success
  criteria SC-1..SC-4, REL-01/02/03 mapping
- `.planning/REQUIREMENTS.md` — REL-01 (toast on every failed Send), REL-02
  (multi-note serial stability), REL-03 (large-screenshot graceful guard)
- `.planning/PROJECT.md` §Constraints — "No silent failures" reliability constraint;
  host security model (127.0.0.1 bind, token auth, 12 MB cap)

### Existing implementation to harden / extend
- `entrypoints/review.content/toast.ts` — existing toast infrastructure (reuse;
  do not reinvent)
- `entrypoints/review.content/index.ts` — current Send path + catch sites to
  consolidate behind the error→toast mapper (D-01)
- `host/src/serial.ts` + `host/test/serial.test.ts` — serial mutex + existing
  tests; concurrency stress test (D-02) extends these
- `host/src/security.ts` + `host/test/security.test.ts` — token/path/body-cap
  (12 MB → 413) guards; payload-boundary test (D-04) extends these
- `host/src/server.ts` — `POST /annotation` routing + CORS; integration target
  for the concurrency test
- `scripts/clean-room-check.mjs` — clean-room grep gate to extend (D-03); already
  wired into `npm run check`
- `CLEAN-ROOM.md` — provenance doc (Phase 7); record the extended banned set here

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `toast.ts`: the only toast surface — the error→toast mapper (D-01) routes into it.
- `host/test/serial.test.ts`: established `node:test` + booted-host integration
  pattern; the 10-concurrent-Send test reuses its harness.
- `host/test/security.test.ts`: body-cap/413 test pattern; payload-boundary test
  reuses it.
- `scripts/clean-room-check.mjs`: `SKIP_DIRS` / `SKIP_FILENAMES` sets + recursive
  walk already in place; D-03 only adds banned tokens + (optionally) self-audited
  selector constants.

### Established Patterns
- Pure logic lives in `lib/` with `node:test` coverage via `test:lib`; host logic
  in `host/` via `test`. New unit tests (mapper, pre-flight size check) follow this
  split — a pure size-check/mapper belongs in `lib/`.
- `npm run check` is the umbrella gate (tsc ×2, clean-room, host smoke, test:lib,
  test). All new gates must pass under it.

### Integration Points
- Error mapper sits between the Send catch sites and `toast.ts`.
- Pre-flight size check sits in the Send path before the SW relay POST; host 413 is
  the downstream backstop.
- Concurrency + payload tests hit `host/src/server.ts` `POST /annotation` directly.

</code_context>

<specifics>
## Specific Ideas

- The five named failure paths (host unreachable, 401, 413, SW evicted mid-flight,
  no-host-for-origin) are the authoritative checklist for REL-01 coverage — the
  mapper and UAT must each enumerate all five.
- "No silent drops" is the product's core value statement (PROJECT.md) — a dropped
  note is treated as a regression, not a minor bug.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Turnkey onboarding, auto-pairing,
and cross-browser packaging are Phase 9; not touched here.)

</deferred>

---

*Phase: 8-Hardening + Pre-Release Audit*
*Context gathered: 2026-06-03*
