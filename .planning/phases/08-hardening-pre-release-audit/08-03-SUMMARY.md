---
phase: 08-hardening-pre-release-audit
plan: "03"
subsystem: testing
tags: [node:test, integration-test, concurrency, serial-mutex, payload-size, ECONNRESET]

requires:
  - phase: 08-01
    provides: pure lib units (error-toast + payload-size) already wired into package.json

provides:
  - 10-concurrent POST /annotation integration test proving withSerialLock serial integrity end-to-end through the HTTP layer (D-02/REL-02/SC-2)
  - POST /annotation payload-boundary backstop: 11.9 MB succeeds, >12 MB rejected 413-or-ECONNRESET (D-04/REL-03/SC-3)

affects: [phase-09, ci-gate, pre-release-audit]

tech-stack:
  added: []
  patterns:
    - "ECONNRESET-tolerant oversize fetch: try/catch, assert 413 only if status !== null, connection reset is acceptable"
    - "Promise.all concurrency harness: build all fetch promises before awaiting any to maximise real concurrency"
    - "Chunked comment construction: build large strings in 64 KB slices to avoid single giant allocation"

key-files:
  created: []
  modified:
    - host/test/server.test.ts

key-decisions:
  - "Concurrency test uses fresh buildFixture/listenFixture fixture (own before/after) so it starts with an empty notesDir and serials begin at 0001"
  - "Both new describe blocks added to server.test.ts (not serial.test.ts) — real end-to-end serial proof through the HTTP layer requires createHostServer"
  - "ECONNRESET tolerance mirrors the existing PUT-oversize pattern exactly at lines 477-502"
  - "11.9 MB body constructed by computing target bytes minus the outer shell length to stay strictly under 12 MB cap"
  - "Oversize comment built from 64 KB slices joined to avoid a single >12 MB string allocation"

patterns-established:
  - "ECONNRESET-tolerant test: let status = null; try { status = res.status } catch {}; if (status !== null) assert.equal(status, 413)"
  - "Concurrency proof: Promise.all(Array.from({length:10}, (_, i) => post(i))) before any await"

requirements-completed: [REL-02, REL-03]

duration: 15min
completed: 2026-06-04
---

# Phase 8 Plan 03: Concurrency + Payload-Boundary Integration Tests Summary

**10-concurrent POST /annotation integration test proves withSerialLock serial mutex integrity; 11.9 MB/12 MB+1 POST-boundary backstop proves the host's 12 MB cap with ECONNRESET tolerance**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-04T00:00:00Z
- **Completed:** 2026-06-04T00:15:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added `describe 'concurrent POST /annotation serial integrity (REL-02/SC-2)'`: fires 10 concurrent POST /annotation via `Promise.all`, asserts sorted serials exactly `['0001'..'0010']` with no gaps or duplicates, and asserts exactly 10 distinct `.md` files on disk.
- Added `describe 'POST /annotation payload-size backstop (REL-03/SC-3)'`: `~11.9 MB body -> 200 ok:true`; `>12 MB body -> 413 or ECONNRESET` (ECONNRESET-tolerant, mirroring the existing PUT oversize pattern).
- Both blocks reuse the `buildFixture`/`listenFixture`/`closeFixture` harness — no new dependencies.
- `npm test` exits 0 with both new describe blocks passing; the pre-existing `WR-06 EADDRINUSE` failure in `index.test.js` is unrelated (port 39240 occupied on this dev machine, confirmed pre-existing before any changes).

## Task Commits

Both tasks modify the same file and were committed together:

1. **Task 1: 10-concurrent serial-integrity block (D-02)** + **Task 2: POST payload-boundary block (D-04)** - `5382a62` (test)

## Files Created/Modified

- `host/test/server.test.ts` — added 174 lines: two new describe blocks with their own before/after fixtures

## Decisions Made

- Both tasks committed in a single commit (same file, additive-only, both verified together in one `npm test` run).
- Chunked comment construction (64 KB slices) chosen for the oversize body to avoid a single >12 MB string allocation — mirrors the `security.test.ts` chunked-write reference.
- Fresh fixture per describe block (own `before`/`after`) ensures isolated serial sequences starting at 0001.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. The pre-existing `WR-06: EADDRINUSE 39240` failure in `index.test.js` was confirmed pre-existing before my changes (stash → run → same failure → pop stash). Not caused by this plan.

## Known Stubs

None — this plan adds integration tests only; no UI stubs introduced.

## Threat Flags

None — this plan adds tests to existing routes; no new network endpoints, auth paths, or schema changes introduced.

## Self-Check

- [x] `host/test/server.test.ts` modified with 174 new lines
- [x] Commit `5382a62` exists: `git log --oneline | grep 5382a62`
- [x] Both new describe blocks visible and passing in `npm test` output
- [x] 10-concurrent test asserts serials 0001-0010 + exactly 10 .md files
- [x] Payload-boundary test: 11.9 MB -> 200, >12 MB -> 413-or-ECONNRESET (tolerant)
- [x] No existing server.test.ts test modified or removed

## Self-Check: PASSED

## Next Phase Readiness

- D-02 (REL-02/SC-2) and D-04 host backstop (REL-03/SC-3) fully proven via CI-able integration tests.
- Ready for Plan 04 (clean-room audit extension + UAT runbook).

---
*Phase: 08-hardening-pre-release-audit*
*Completed: 2026-06-04*
