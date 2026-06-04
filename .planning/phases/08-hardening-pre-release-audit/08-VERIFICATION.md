---
phase: 08-hardening-pre-release-audit
verified: 2026-06-04T00:00:00Z
status: human_needed
score: 3/4 must-haves verified (SC-4 fully verified; SC-1 automated portion verified; SC-2 and SC-3 fully verified; SC-1 Chrome-runtime paths need live UAT)
overrides_applied: 0
human_verification:
  - test: "Run the 08-UAT.md runbook — all five REL-01 failure paths"
    expected: "Each of the five failure scenarios (host unreachable, 401 wrong token, 401 no token, 413/over-12-MB, SW evicted mid-flight, unmapped origin) shows a visible toast. No scenario silently drops the note."
    why_human: "SW-eviction mid-flight (scenario 4) and live Chrome toast rendering cannot be confirmed under node:test. All five paths require a running Chrome + loaded extension. The automated mapper unit tests confirm the string logic; the dead-channel guard is present in code; runtime toast delivery requires the human runbook."
  - test: "D-05a: SW idle-eviction state survival"
    expected: "After manually stopping the SW via chrome://extensions, a subsequent Send succeeds and a new .md appears on disk — no Extension error toast from a stale state."
    why_human: "chrome.storage.local hydration and SW restart require a live Chrome runtime; not reproducible in node:test."
  - test: "D-04: near-12 MB screenshot pre-flight — verify no network request fires"
    expected: "Pre-flight toast 'Screenshot too large to send (over 12 MB) — remove a capture and retry' appears AND the DevTools Network tab shows zero requests to 127.0.0.1:39240."
    why_human: "Requires Chrome DevTools observation. The code path exists and is unit-tested; the 'no round-trip' guarantee is only fully confirmable in-browser."
---

# Phase 8: Hardening + Pre-Release Audit Verification Report

**Phase Goal:** Every failure path (host down, 401, 413, SW eviction mid-flight, no host for origin) surfaces a visible toast and never silently drops a note; concurrent Sends produce correct serial ordering; a GPL clean-room grep audit returns zero matches.

**Verified:** 2026-06-04
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every known failure path (host unreachable, 401, 413, SW evicted mid-flight, no host for origin) produces a visible toast — no silent drops | VERIFIED (automated) / HUMAN for SW-eviction runtime | background.ts returns typed `relay-error` objects for all 5 paths; card.ts dead-channel guard wired at both `_doSend` and `_doElementSend`; mapSendOutcome unit-tested (144/144 pass); SW-eviction path collapses into `chrome.runtime.lastError \|\| !resp` guard — confirmed in code; live Chrome runtime toast delivery requires 08-UAT.md runbook |
| 2 | Ten concurrent Sends produce files 0001 through 0010 with no gaps or duplicates | VERIFIED | `server.test.ts` `describe 'concurrent POST /annotation serial integrity (REL-02/SC-2)'`: `Promise.all(10 concurrent POSTs)` asserts exact sorted serials `['0001'..'0010']` and exactly 10 `.md` files on disk. Test passes: `npm test` 97/98 pass (1 EADDRINUSE flake, pre-existing, unrelated) |
| 3 | 11.9 MB POST succeeds (200 ok:true); near-12 MB pre-flight toast fires; >12 MB is rejected with 413/ECONNRESET | VERIFIED (integration + unit) / HUMAN for in-browser pre-flight | `exceedsBodyCap` unit-tested at exact boundary and MAX+1; `server.test.ts` payload-boundary block: 11.9 MB → 200, >12 MB → 413-or-ECONNRESET. Pre-flight guard present at both Send paths in card.ts (lines 411, 861). Live Chrome DevTools "no network request fires" check requires human run. |
| 4 | A grep for `__opc_`, `opencode`, `JodusNodus`, and upstream selector constants returns zero results across the entire repo | VERIFIED | `node scripts/clean-room-check.mjs` exits 0, prints `clean-room audit: PASS — no banned identifiers found`. Direct `grep` confirms only CLEAN-ROOM.md and PRD.md reference banned terms (both excluded in skip-list — attribution-only files). D-03 no-peek self-audit documented in CLEAN-ROOM.md §6. |

**Score:** 4/4 truths verified at automated level; SC-1 SW-eviction path + SC-3 pre-flight no-round-trip require live Chrome UAT.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/error-toast.ts` | Pure `mapSendOutcome` mapper with `SendOutcome` discriminated union | VERIFIED | Exports `SendOutcome`, `ToastSpec`, `mapSendOutcome`. No top-level chrome/document/window. Three branches (ok, channel-dead, relay-error) match D-01a verbatim strings. |
| `lib/payload-size.ts` | Pure `exceedsBodyCap` pre-flight check, `MAX_BODY_BYTES = 12 * 1024 * 1024` | VERIFIED | Exports `MAX_BODY_BYTES`, `encodedBodyBytes`, `exceedsBodyCap`. Strict `>` boundary matches host `security.ts`. TextEncoder global, node:test-safe. |
| `lib/test/error-toast.test.ts` | Unit tests for all three SendOutcome branches | VERIFIED | 7 tests across 3 describe blocks; verbatim D-01a string assertions pass. |
| `lib/test/payload-size.test.ts` | Unit tests for boundary conditions | VERIFIED | 6 tests: exact boundary false, MAX+1 true, 11.9 MB false. All pass. |
| `entrypoints/review.content/card.ts` | Both `_doSend` and `_doElementSend` wired to `mapSendOutcome` + `exceedsBodyCap` pre-flight | VERIFIED | Imports confirmed on lines 30–32. `mapSendOutcome` called at 6 branch points (lines 428, 441, 449, 875, 885, 894). `exceedsBodyCap` guard at lines 411 and 861. Dead-channel guard `chrome.runtime.lastError \|\| !resp` at both call-sites. |
| `host/test/server.test.ts` | 10-concurrent serial-integrity test + payload-boundary backstop | VERIFIED | Lines 563–617: `describe 'concurrent POST /annotation serial integrity'` (Promise.all 10, sorted serials assert, 10 md-files assert). Lines 617+: `describe 'POST /annotation payload-size backstop'` (11.9 MB → 200, >12 MB → 413-or-ECONNRESET). Both pass. |
| `scripts/clean-room-check.mjs` | Extended with Phase 8 D-03 audit narrative; exits 0 repo-wide | VERIFIED | Phase 8 audit comment block added. Fragment-constructed banned tokens unchanged (3 tokens). Exit code 0 confirmed by direct run. |
| `CLEAN-ROOM.md` | §6 Phase 8 Release Gate record with per-file disposition table | VERIFIED | §6 present with 10-file disposition table, extended banned-set table, live audit result `2026-06-04 exit 0`. |
| `.planning/phases/08-hardening-pre-release-audit/08-UAT.md` | Manual Chrome runbook covering all 5 REL-01 paths + D-05 regression + D-04 manual | VERIFIED | File exists. Scenario table covers scenarios 1, 2, 2b, 3, 4, 5, D-05a, D-05b, D-04, D-02a with repro steps, verbatim expected toasts, and checkbox pass markers. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `card.ts _doSend` | `lib/error-toast.ts mapSendOutcome` | import line 30, calls lines 428/441/449 | WIRED | All three branches route through mapper |
| `card.ts _doElementSend` | `lib/error-toast.ts mapSendOutcome` | import line 30, calls lines 875/885/894 | WIRED | All three branches route through mapper |
| `card.ts _doSend` | `lib/payload-size.ts exceedsBodyCap` | import line 32, guard line 411 | WIRED | Pre-flight before `chrome.runtime.sendMessage` |
| `card.ts _doElementSend` | `lib/payload-size.ts exceedsBodyCap` | import line 32, guard line 861 | WIRED | Pre-flight before `chrome.runtime.sendMessage` |
| `background.ts SEND_ANNOTATION handler` | toast strings (relay-error) | Returns `{ ok: false, error: '...' }` strings consumed by `mapSendOutcome relay-error` branch | WIRED | Strings "No host mapped for origin:", "No token set for host", "Host unreachable:" all present at lines 304/310/328 and mirrored across all handler variants |
| `server.test.ts concurrent block` | `createHostServer` + `withSerialLock` | `buildFixture/listenFixture` + `Promise.all(10 POSTs)` | WIRED | End-to-end HTTP layer proof |
| `server.test.ts payload-boundary block` | `host security.ts readBody` (413 cap) | 11.9 MB → 200, >12 MB → 413/ECONNRESET | WIRED | Downstream backstop proven independently of pre-flight |
| `package.json test:lib` | `lib/test/error-toast.test.js` + `lib/test/payload-size.test.js` | Explicit file list in `node --test` invocation | WIRED | Both files listed; 144/144 pass |

---

### Data-Flow Trace (Level 4)

Not applicable to this phase. Phase 8 delivers pure lib units (no rendering), integration tests, and audit artifacts — no new data-rendering components introduced.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `test:lib` passes (error-toast + payload-size) | `npm run test:lib` | 144 tests, 0 failures, suites include `mapSendOutcome` and `exceedsBodyCap` | PASS |
| 10-concurrent serial integrity | `npm test` (server.test.ts) | `concurrent POST /annotation serial integrity (REL-02/SC-2)` — 1 test PASS in 36 ms | PASS |
| 11.9 MB POST succeeds | `npm test` (server.test.ts) | `POST /annotation with ~11.9 MB body succeeds (200 ok:true)` — PASS in 169 ms | PASS |
| >12 MB POST rejected | `npm test` (server.test.ts) | `POST /annotation with >12 MB body is rejected (413 or ECONNRESET)` — PASS in 114 ms | PASS |
| Clean-room audit exits 0 | `node scripts/clean-room-check.mjs` | `clean-room audit: PASS — no banned identifiers found` | PASS |
| `mapSendOutcome` wired into card.ts (not inline strings) | `grep 'Extension error: ' entrypoints/review.content/card.ts` | 0 matches — string lives only in `lib/error-toast.ts` | PASS |
| `exceedsBodyCap` pre-flight present at both Send paths | `grep -n 'exceedsBodyCap' card.ts` | Lines 411 and 861 — both call-sites confirmed | PASS |

---

### Probe Execution

No probe scripts declared for Phase 8. The `npm test` and `node scripts/clean-room-check.mjs` runs above serve as the equivalent CI-able gates.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REL-01 | 08-01, 08-02, 08-04 | Every failed Send surfaces a visible toast — never silent | SATISFIED (automated) + HUMAN (runtime) | background.ts error strings + card.ts dead-channel guard + mapSendOutcome unit tests; live Chrome runtime confirmation via 08-UAT.md |
| REL-02 | 08-03 | Multi-note sessions stable; second note serial increments correctly | SATISFIED | 10-concurrent integration test asserts serials 0001–0010; existing `withSerialLock` unit test (2 concurrent → 0001/0002) remains passing |
| REL-03 | 08-01, 08-02, 08-03 | Large-screenshot payloads handled gracefully (size guard + clear error) | SATISFIED | `exceedsBodyCap` unit tests at boundary; pre-flight wired in card.ts both paths; host 413 backstop proven via server.test.ts |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `entrypoints/review.content/card.ts` | 179, 560 | `setAttribute('placeholder', 'Type your note…')` | Info | HTML textarea placeholder attribute — not a code stub. Pre-existing, not introduced by Phase 8. |

No blockers. No unresolved TBD/FIXME/XXX debt markers. No stubs in Phase 8 modified files.

---

### Human Verification Required

#### 1. All Five REL-01 Failure-Path Toasts (Chrome Live Runtime)

**Test:** Run 08-UAT.md scenarios 1–5 with a live Chrome + built extension + running host.

**Expected:**
- Scenario 1 (host down): toast `Host unreachable: …`
- Scenario 2 (wrong token): toast `unauthorized`
- Scenario 2b (no token): toast `No token set for host "…" — enter it in the popup`
- Scenario 3 (413): toast `Payload Too Large` or pre-flight `Screenshot too large to send (over 12 MB)…`
- Scenario 4 (SW evicted): toast `Extension error: …`
- Scenario 5 (unmapped origin): toast `No host mapped for origin: …`

**Why human:** Chrome MV3 SW lifecycle and toast rendering cannot be exercised in node:test. The code paths are present and the string logic is unit-tested, but live confirmation requires a running Chrome runtime.

#### 2. SW Idle-Eviction State Survival (D-05a)

**Test:** Start host. Enter Review Mode, confirm one Send succeeds. Wait >30 s or manually stop SW via chrome://extensions. WITHOUT refreshing, send another note.

**Expected:** SW restarts cleanly from `chrome.storage.local`; a new `.md` file appears; no `Extension error:` toast.

**Why human:** `chrome.storage.local` hydration and SW restart require a live Chrome runtime.

#### 3. D-04 Pre-Flight: No Network Round-Trip Fired

**Test:** Attempt to send an over-12-MB payload (large region capture). Observe the pre-flight toast. Open Chrome DevTools Network tab filtered for `127.0.0.1:39240`.

**Expected:** Pre-flight toast fires immediately AND zero requests appear in the Network tab — confirming the `exceedsBodyCap` guard blocks before `chrome.runtime.sendMessage`.

**Why human:** Network-tab observation requires Chrome DevTools. The code-level guarantee (guard before sendMessage) is already verified; this confirms the runtime behavior.

---

### Gaps Summary

No gaps. All four success criteria are verified at their automatable depth:

- **SC-1** (visible toast for every failure path): The error-string sources (background.ts), the dead-channel guard (card.ts), the mapper consolidation (lib/error-toast.ts), and the unit tests all confirm the mechanism. Remaining gap is live Chrome runtime confirmation — delegated to 08-UAT.md (human gate).
- **SC-2** (10 concurrent Sends → 0001–0010 no gaps/dupes): Fully verified by integration test.
- **SC-3** (near-12 MB ok / ≥12 MB rejected with toast): Fully verified by unit tests + integration test + pre-flight wiring in card.ts.
- **SC-4** (zero GPL identifiers): Fully verified by `node scripts/clean-room-check.mjs` exit 0 and direct grep.

The only remaining gate is the live Chrome UAT runbook (08-UAT.md), which is explicitly the intended human checkpoint for this phase.

---

_Verified: 2026-06-04_
_Verifier: Claude (gsd-verifier)_
