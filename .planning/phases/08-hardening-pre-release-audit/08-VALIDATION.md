---
phase: 8
slug: hardening-pre-release-audit
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (Node 20+ builtin — zero new deps) |
| **Config file** | none — runners invoked via npm scripts with **explicit file lists** (not globs) |
| **Quick run command** | `npm run test:lib` |
| **Full suite command** | `npm run check` (tsc ×2 + clean-room + host smoke + test:lib + test) |
| **Estimated runtime** | ~25–40 seconds full suite |

> ⚠ **Silent-skip traps (from RESEARCH):** `package.json` `test:lib`/`test` use explicit file lists — a new `*.test.ts` must be appended there or it never runs. New lib source files must be added to `tsconfig.lib.json` `include[]`. New banned tokens in `clean-room-check.mjs` must use the fragment-construction trick (`'__'+'opc'+'_'`) so the script does not flag itself.

---

## Sampling Rate

- **After every task commit:** Run `npm run test:lib` (fast — pure lib tests, no server boot)
- **After every plan wave:** Run `npm test` (host integration incl. concurrency + boundary)
- **Before `/gsd:verify-work`:** `npm run check` must be green (all gates + clean-room + host smoke), then the manual `08-UAT.md` runbook
- **Max feedback latency:** ~10 seconds (test:lib)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-* | 01 | 0 | REL-01 / SC-1 | T-08-01 | Mapper returns verbatim toast for `channel-dead` (SW-evicted path #4) | unit | `npm run test:lib` → `error-toast.test.js` | ❌ W0 | ⬜ pending |
| 08-01-* | 01 | 0 | REL-01 / SC-1 | T-08-01 | Mapper returns verbatim host-error string for `relay-error` (paths #1,#2,#3,#5) | unit | `npm run test:lib` → `error-toast.test.js` | ❌ W0 | ⬜ pending |
| 08-01-* | 01 | 0 | REL-01 / SC-1 | — | Mapper success string preserved verbatim (taxonomy completeness, D-01a) | unit | `npm run test:lib` | ❌ W0 | ⬜ pending |
| 08-01-* | 01 | 0 | REL-03 / SC-3 | T-08-02 | Pre-flight: 11.9 MB body passes, ≥12 MB rejected with clear toast | unit | `npm run test:lib` → `payload-size.test.js` | ❌ W0 | ⬜ pending |
| 08-02-* | 02 | 1 | REL-02 / SC-2 | — | 10 concurrent POST → serials 0001-0010, no gaps/dupes | integration | `npm test` → `server.test.js` | ⚠️ extend `server.test.ts` | ⬜ pending |
| 08-02-* | 02 | 1 | REL-03 / SC-3 | T-08-02 | Host backstop: POST 11.9 MB → 200; ≥12 MB → 413 (tolerate ECONNRESET) | integration | `npm test` → `server.test.js` | ⚠️ extend `server.test.ts` | ⬜ pending |
| 08-02-* | 02 | 1 | SC-4 | T-08-03 | grep `__opc_`/`opencode`/`JodusNodus`/self-audited constants → 0 matches | static | `node scripts/clean-room-check.mjs` (in `npm run check`) | ⚠️ extend `clean-room-check.mjs` | ⬜ pending |
| (existing) | — | — | REL-02 | — | 2-note serial increment 0001→0002 | unit | `npm test` → `serial.test.js` | ✅ `serial.test.ts:31` | ✅ green |
| (existing) | — | — | REL-03 | — | `readBody` >12 MB → 413 | unit | `npm test` → `security.test.js` | ✅ `security.test.ts:97` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs are provisional (assigned by the planner). The auditor reconciles them against the final PLAN.md task numbering.*

---

## Wave 0 Requirements

- [ ] `lib/error-toast.ts` + `lib/test/error-toast.test.ts` — REL-01 mapper per path (consolidates `card.ts` catch sites verbatim per D-01a)
- [ ] `lib/payload-size.ts` + `lib/test/payload-size.test.ts` — REL-03 pre-flight boundary
- [ ] Extend `host/test/server.test.ts` — 10-concurrent block (REL-02) + POST 11.9/12 MB boundary (REL-03)
- [ ] Extend `scripts/clean-room-check.mjs` — banned set + self-audited constants (SC-4)
- [ ] Wire new lib files into `tsconfig.lib.json` `include[]` and `package.json` `test:lib` file list
- [ ] `08-UAT.md` runbook — 5 failure-path manual confirmations + D-05 SW-eviction + multi-note increment
- [ ] Framework install: none — `node:test` is builtin

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| All 5 failure paths produce a *visible* toast at runtime | REL-01 / SC-1 | Toast is a rendered shadow-DOM element; SW-eviction mid-flight cannot be reproduced in node:test | `08-UAT.md`: host-down, wrong-token (401), oversize (413), SW-evicted (idle then Send), unknown-origin — confirm a toast appears for each |
| SW-eviction state survival + subsequent Send routes correctly | D-05 | MV3 SW idle eviction is a browser-runtime behavior | `08-UAT.md`: enter Review Mode, idle >30s to evict SW, Send → note still written + routed |
| Multi-note serial increment (extension-driven) | REL-02 / D-05 | Confirms the end-to-end relay (not just host mutex) | `08-UAT.md`: Send two notes → 0001 then 0002 on disk |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 40s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
