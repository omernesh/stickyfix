---
phase: 02-host-mvp
plan: "03"
subsystem: host
tags: [smoke-test, spawn-readline, token-auth, port-range, end-to-end, npm-check-gate]
dependency_graph:
  requires: [02-02]
  provides: [scripts/host-smoke-test.mjs]
  affects: [npm run check]
tech_stack:
  added: []
  patterns:
    - spawn+readline smoke test with port-range assertion + 401 probe + token POST + .md-on-disk
    - body.file is absolute path from writeNote (not joined with notesDir)
    - child.kill('SIGTERM') in finally with 200ms Windows drain
key_files:
  created: []
  modified:
    - scripts/host-smoke-test.mjs
decisions:
  - Use body.file directly from POST /annotation response (absolute path) rather than joining with notesDir — writeNote returns the absolute mdPath
  - Port range assertion uses constants PORT_RANGE_START=39240 / PORT_RANGE_END=39260 matching index.ts
metrics:
  duration: "~10 minutes"
  completed: "2026-05-31"
  tasks: 2
  files: 1
---

# Phase 02 Plan 03: Smoke Test End-to-End + npm run check Gate Summary

**One-liner:** spawn+readline smoke test now probes port-range (39240-39260), 401 no-token, token POST + .md-on-disk — npm run check green with 35/35 tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite smoke test with full 02-03 assertions | bea137c | scripts/host-smoke-test.mjs |
| 2 | Full npm run check green (phase gate) | bea137c | (verification only — no new files) |

## Verification Results

- `npm run build`: PASS (wxt build + tsc -p tsconfig.host.json, exit 0)
- `node scripts/host-smoke-test.mjs`: PASS — all 5 assertions pass
  - startup.port in 39240-39260
  - GET /status: 200, app:'stickyfix', no token field
  - POST /annotation (no token): 401
  - POST /annotation (token): 200, ok:true, .md file exists on disk
  - child.kill in finally, script exits 0
- `npm run check`: PASS — exit 0
  - tsc --noEmit: PASS
  - tsc --noEmit -p tsconfig.host.json: PASS
  - node scripts/clean-room-check.mjs: PASS
  - node scripts/host-smoke-test.mjs: PASS
  - npm test (35/35 node:test): PASS
- No hangs detected; spawned child process killed cleanly

## Acceptance Criteria Coverage

| Criterion | Status |
|-----------|--------|
| spawn+readline (no spawnSync); does not hang | PASS (carried from 02-02, preserved) |
| Asserts port in 39240-39260 | PASS (added in 02-03) |
| No-token POST -> 401 | PASS (added in 02-03) |
| Token POST -> 200 + .md on disk | PASS (added in 02-03) |
| child.kill in finally; exits 0/1 | PASS |
| npm run check returns and exits 0 | PASS |
| npm run build exits 0 | PASS |

## Threat Coverage

| Threat | Status |
|--------|--------|
| T-02-hang: smoke test hangs npm run check | MITIGATED — spawn+readline+child.kill confirmed non-blocking |
| T-02-auth-e2e: 401 assertion end-to-end | MITIGATED — no-token POST returns 401 proven end-to-end |
| T-02-bind-e2e: port in 39240-39260 | MITIGATED — startup.port asserted in range |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] body.file is absolute path — do not join with notesDir**

- **Found during:** Task 1 verification (first run showed doubled path)
- **Issue:** `writeNote` returns the absolute `mdPath` as `file`. The response body `file` field was already the full path (e.g., `C:\...\notes\0001-....md`). Joining it with `notesDir` via `join()` produced a doubled path like `C:\...\notes\C:\...\notes\0001-....md`, causing `existsSync` to return false.
- **Fix:** Use `annotBody.file` directly as `notePath` without joining with `notesDir`.
- **Files modified:** scripts/host-smoke-test.mjs
- **Commit:** bea137c

**2. [Note] spawn+readline smoke test already present from 02-02**

- The 02-02 plan rewrote `host-smoke-test.mjs` from spawnSync to spawn+readline as a blocking deviation (Rule 3). The 02-03 Task 1 baseline was already correct — only the additional assertions (port range, 401, token POST + .md) were missing and were added in this plan.

## Known Stubs

None. All smoke test assertions are fully exercised end-to-end against the real server.

## Threat Flags

None. No new network endpoints or auth paths introduced.

## Self-Check

- scripts/host-smoke-test.mjs: FOUND
- Commit bea137c: in git log
- npm run check: PASS (verified above)
- npm run build: PASS (verified above)

## Self-Check: PASSED
