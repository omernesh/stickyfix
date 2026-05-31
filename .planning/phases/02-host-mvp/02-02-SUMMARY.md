---
phase: 02-host-mvp
plan: "02"
subsystem: host
tags: [http-server, cors, port-scan, 127.0.0.1, token-auth, integration-test, node-test]
dependency_graph:
  requires: [02-01]
  provides: [host/src/server.ts, host/src/index.ts, host/test/server.test.ts]
  affects: [scripts/host-smoke-test.mjs, package.json]
tech_stack:
  added: []
  patterns:
    - createHostServer factory (no listen call inside — index.ts owns binding)
    - setCorsHeaders echoes req.headers.origin on every response path (Pitfall 6)
    - setPreflightHeaders for OPTIONS -> 204 with Allow-Methods/Headers/Max-Age
    - bind-or-fail port scan 39240-39260 on 127.0.0.1 via EADDRINUSE (Pattern 1)
    - tryListen helper with once('error') + once('listening') guards
    - spawn+readline smoke test pattern replacing spawnSync (Pattern 12 / Pitfall 2)
key_files:
  created:
    - host/src/server.ts
    - host/test/server.test.ts
  modified:
    - host/src/index.ts
    - scripts/host-smoke-test.mjs
    - package.json
decisions:
  - createHostServer does not call server.listen — keeps factory testable (ephemeral port 0 in tests)
  - setCorsHeaders called at top of every handler branch before any writeHead/end (Pitfall 6 / T-02-cors-readable)
  - bindServer throws on preferred --port conflict rather than silently falling back to scan range
  - smoke test updated from spawnSync to spawn+readline (Pitfall 2 — server runs indefinitely)
  - server.test.js added to package.json test script (35 total tests now)
metrics:
  duration: "~20 minutes"
  completed: "2026-05-31"
  tasks: 3
  files: 5
---

# Phase 02 Plan 02: HTTP Server + Boot Sequence + Integration Tests Summary

**One-liner:** node:http createHostServer with echo-Origin CORS + token-gated POST /annotation + bind-or-fail 127.0.0.1 port scan — 9 integration tests, 35 total, all green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | server.ts — routing, CORS, /status, /annotation | 9d249e4 | host/src/server.ts |
| 2 | index.ts — boot sequence + 127.0.0.1 port-scan + startup line | 19b816d | host/src/index.ts |
| 3 | server.test.ts — integration over a real bound server | a11e648 | host/test/server.test.ts, scripts/host-smoke-test.mjs, package.json |

## Verification Results

- `npx tsc -p tsconfig.host.json`: PASS
- `node --test dist/host/test/server.test.js`: 9/9 PASS
- `node --test` all test files: 35/35 PASS
- `node scripts/clean-room-check.mjs`: PASS
- `node scripts/host-smoke-test.mjs`: PASS
- `grep host/src '0.0.0.0'`: 0 matches (bind is 127.0.0.1 only)
- `npm run check`: PASS (all gates green)

**Total: 35/35 unit + integration tests passing.**

## Security Threat Coverage

| Threat | Status | Where |
|--------|--------|-------|
| T-02-bind (LAN exposure) | MITIGATED | BIND_HOST='127.0.0.1' constant; safety assertion on addr.address; test asserts === '127.0.0.1' |
| T-02-auth (token tampering) | MITIGATED | checkToken gate before any write; 401 on miss; test asserts no-token -> 401 |
| T-02-cors-readable (CORS on errors) | MITIGATED | setCorsHeaders called first in every handler branch incl 401/413/404 |
| T-02-dos (body OOM) | MITIGATED | readBody 12 MB cap -> 413; req.destroy() in security.ts (Plan 01) |
| T-02-info-status (token leak) | MITIGATED | /status returns app/version/name/root/notesDir/origins only; test asserts body.token === undefined |
| T-02-SC (supply chain) | ACCEPTED | Zero new packages installed in this plan |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated host-smoke-test.mjs from spawnSync to spawn+readline**

- **Found during:** Task 3 verification (smoke test would have hung in npm run check)
- **Issue:** Phase 2 server runs indefinitely. The existing smoke test used `spawnSync` which blocks until the child exits — causing `npm run check` to hang forever (Pitfall 2).
- **Fix:** Rewrote `scripts/host-smoke-test.mjs` to use `spawn` + `readline` (Pattern 12): reads the startup JSON line via readline, probes `/status`, then `child.kill('SIGTERM')`. Also added `/status.token === undefined` assertion.
- **Files modified:** scripts/host-smoke-test.mjs
- **Commit:** a11e648

**2. [Rule 2 - Missing critical] Added server.test.js to package.json test script**

- **Found during:** Task 3 completion
- **Issue:** The integration test would not run under `npm test` unless explicitly added to the test script.
- **Fix:** Added `dist/host/test/server.test.js` to the `test` script in package.json.
- **Files modified:** package.json
- **Commit:** a11e648

## Known Stubs

None. All routes are fully implemented and exercised by the integration test. The server wires all Plan 01 modules (config, security, serial, write-note) into a real HTTP server.

## Threat Flags

None. No new network endpoints, auth paths, or file access patterns beyond those in the plan's threat model. The server binds exclusively to 127.0.0.1 (never 0.0.0.0).

## Self-Check: PASSED

- host/src/server.ts: FOUND
- host/src/index.ts: FOUND (rewritten from stub)
- host/test/server.test.ts: FOUND
- scripts/host-smoke-test.mjs: FOUND (updated)
- Commits 9d249e4, 19b816d, a11e648: all in git log
