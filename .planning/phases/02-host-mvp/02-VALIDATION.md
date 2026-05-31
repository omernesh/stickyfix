---
phase: 2
slug: host-mvp
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-31
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` + `node:assert` (compiled to `dist/host/`, run via `node --test`) |
| **Config file** | `tsconfig.host.json` (include extended to `host/test/**/*.ts`); no separate test config |
| **Quick run command** | `npm test` (`tsc -p tsconfig.host.json && node --test dist/host/**/*.test.js`) |
| **Full suite command** | `npm run check` (tsc ×2 + clean-room + host unit tests + smoke test) |
| **Estimated runtime** | ~10–20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (host unit tests) or the task's targeted `node --test` file
- **After every plan wave:** Run `npm run check`
- **Before `/gsd:verify-work`:** `npm run check` and `npm run build` both exit 0
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-----------|--------|
| 2-xx | config/server | 1 | HOST-01,02,03,13 | T-bind | binds 127.0.0.1 only; prints name/port/token/notesDir | unit+smoke | `node --test` server-start + `/status` probe; assert not 0.0.0.0 | ❌ W0 | ⬜ |
| 2-xx | serial | 1 | HOST-06 | — | concurrent POSTs never reuse a serial | unit | `node --test` — 2 concurrent withSerialLock → 0001,0002 | ❌ W0 | ⬜ |
| 2-xx | security | 1 | HOST-05,09,10,11 | T-auth,T-traversal,T-dos | 401 on bad token; reject `..` traversal; 413 over 12MB; CORS echoes Origin | unit | `node --test` — token/path/size/CORS assertions | ❌ W0 | ⬜ |
| 2-xx | write-note | 2 | HOST-07,08,12 | — | writes .md+.png inside notesDir only | unit | `node --test` — frontmatter yaml + +N.png decode + .gitkeep | ❌ W0 | ⬜ |
| 2-xx | endpoint wiring | 2 | HOST-04,05,07,08 | T-auth | /status open; /annotation token-gated, returns {ok,file,serial} | integration | `node --test` — boot server, POST with token → file on disk | ❌ W0 | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red. Exact task IDs assigned by the planner.*

---

## Wave 0 Requirements

- [ ] `host/test/serial.test.ts` — concurrent serial-assignment stubs (HOST-06)
- [ ] `host/test/security.test.ts` — token / path-traversal / body-cap / CORS stubs (HOST-05,09,10,11)
- [ ] `host/test/write-note.test.ts` — frontmatter + PNG decode stubs (HOST-07,08)
- [ ] `host/test/server.test.ts` — boot + /status + /annotation integration stubs (HOST-01..04)
- [ ] `tsconfig.host.json` include extended to `host/test/**/*.ts`; `npm test` script added and folded into `npm run check`

*Created during Wave 1 execution; no pre-existing framework needed (node:test is built in).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Host is NOT reachable from another LAN host | HOST-02 | Requires a second machine on the LAN to attempt a connection | From another device, `curl http://<dev-machine-ip>:<port>/status` must fail/refuse; localhost works. (Automated proxy: assert the listener address is `127.0.0.1`.) |

---

## Validation Sign-Off

- [ ] Every behavior-adding task has a `node --test` assertion or a Wave 0 test dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers serial / security / write-note / server test files
- [ ] No watch-mode flags (`node --test`, not `--watch`)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter (flipped by execute-phase once tests exist and pass)

> Note: `nyquist_compliant` / `wave_0_complete` stay `false` during planning by design; execute-phase flips them once the `host/test/*.test.ts` files exist on disk and pass. A `false` value at plan time is expected, not a defect.

**Approval:** pending
