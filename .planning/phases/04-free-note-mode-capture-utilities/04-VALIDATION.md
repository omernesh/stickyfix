---
phase: 4
slug: free-note-mode-capture-utilities
status: validated-partial
nyquist_compliant: false
wave_0_complete: true
automated_green: 32
created: 2026-05-31
updated: 2026-06-02
source: [04-RESEARCH.md]
---

# Phase 4 — Validation Strategy

> Per-phase validation contract. The capture-utility math is pure and unit-tested;
> interactjs drag, captureVisibleTab round-trip, post-it Send, and toasts are
> Chrome-runtime-bound and verified by manual UAT.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert` for pure logic (`lib/capture.ts` crop math, single-active-card state guard), compiled via `tsconfig.lib.json` and run under `npm run test:lib`; manual Chrome UAT for runtime-bound UI |
| **Config file** | extension `tsconfig` (`tsc --noEmit`, `types:["chrome"]`); `tsconfig.lib.json` for the node:test runner |
| **Quick run command** | `npm run check` (tsc ×2 + clean-room + host smoke + all node:test) |
| **Full suite command** | `npm run build && npm run check` |
| **Estimated runtime** | ~25–45 seconds (WXT build dominates) |

---

## Sampling Rate

- **After every task commit:** `npm run check`
- **After every plan wave:** `npm run build && npm run check`
- **Before verify-work:** both exit 0; then manual Chrome UAT (Success Criteria 1–4)
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|------|------|-------------|-----------------|-----------|-------------------|--------|
| `lib/capture.ts` `computeCropCoords(rect, dpr)` pure math | 0 | SC-4 | DPR-correct crop; Math.round; no DOM | unit | `node --test` capture.test (DPR=1,1.25,2 + zero-dim/DPR=0 guards) | ✅ |
| single-active-card state guard | 0 | FREE-02 | only one card; re-open focuses | unit | `node --test` card-state.test (4 cases) | ✅ |
| `npm install interactjs@1.10.27` + lib test wiring | 0 | FREE-01/02 | locked stack version | build | `tsc -p tsconfig.lib.json` + test:lib green (32/32) | ✅ |
| FAB + post-it card (interactjs drag, clamp) | 1 | FREE-01,02 | viewport-clamped; shadow isolation | tsc + manual | tsc green; Chrome UAT Tests 2,3 PASS (drag+clamp, single-card) — fix 8f85d3c | 🟢M |
| free-note payload + Send via SFX_SEND_ANNOTATION | 1 | FREE-03 | text-only (`screenshots:[]`); SW relay only | tsc + manual | tsc green; Chrome UAT Test 4 PASS — 0004-*.md written, mode:free, screenshots:[] | 🟢M |
| toast (success) | 1 | FREE-04 | never silent (REL-01); echoes host `file` | tsc + manual | Chrome UAT Test 4 PASS — success toast names file, auto-dismiss | 🟢M |
| toast (host-down error persistence) | 1 | FREE-04/REL-01 | error toast persists; × dismiss; card stays open | manual | Chrome UAT Test 5 — DEFERRED (un-run) | 🟡M |
| `captureVisibleTab` SW relay + double-rAF flush + crop wiring | 1/2 | SC-4 | SW is sole privileged caller; own-UI hidden | tsc + manual + integration | Chrome UAT Test 1 — DEFERRED (un-run); gates Phase 5/6 | 🟡M |
| chip re-map affordance | 1 | (carry-fwd) | onclick assignment (no listener stack) | manual | Chrome UAT Test 6 PASS — re-map dropdown opens + persists (fix 10eaf4a) | 🟢M |

*Status: ⬜ pending · ✅ automated green · 🟢M manual-verified (UAT pass) · 🟡M manual-deferred · ❌ red.*

---

## Wave 0 Requirements

- [x] `lib/test/capture.test.ts` — `computeCropCoords` at DPR=1, 1.25, 2 + zero-width/zero-height/DPR=0 guards (SC-4)
- [x] `lib/test/card-state.test.ts` — single-active-card guard (4 cases: fresh/open/focus-existing/reset)
- [x] `lib/capture.ts` exports a **pure** `computeCropCoords(rect, dpr)` (no DOM); canvas `cropToRect` wrapper is manual-only
- [x] node:test runner wired under `npm run check` via `test:lib` (32/32 green)
- [x] `interactjs@1.10.27` installed (locked stack version)

*Pure capture math + state guards are unit-tested; chrome-API-bound code is manual Chrome UAT.*

---

## Manual-Only Verifications (Chrome UAT — Success Criteria 1–4)

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| FAB visible + draggable; opens one post-it card | FREE-01,02 | Live Chrome injection + interactjs drag | Enter Review Mode → `+` FAB shows, drags, clamps; click → single card; re-click focuses (no 2nd card) |
| Send writes correctly-named `.md` | FREE-03 | Live host + SW relay | Type note → Send → `notes/000N-YYYYMMDD-HHmmss.md` appears with the comment |
| Success + error toast (never silent) | FREE-04 | Live runtime | Success toast names the file; stop host → Send → visible error toast (REL-01) |
| captureVisibleTab round-trip + double-rAF flush | SC-4 | SW-only API + paint timing | Integration: capture returns a PNG dataURL via the SW; own UI absent from the shot |

---

## Validation Sign-Off

- [x] Pure crop math + card state guard have node:test coverage (DPR=1/1.25/2 + guards) — 32/32 green
- [x] Type-check (`tsc --noEmit`) green for extension + host
- [x] Manual Chrome UAT items recorded as HUMAN-UAT (04-HUMAN-UAT.md: Tests 2,3,4,6 PASS, user-accepted)
- [x] No watch-mode flags
- [ ] Tests 1 (capture round-trip) & 5 (host-down error toast) — manual-only, DEFERRED by choice; remain tracked

**Approval:** VALIDATED (PARTIAL) — automatable subset 100% covered + green; runtime-bound items manual-only.

---

## Validation Audit 2026-06-02

| Metric | Count |
|--------|-------|
| Requirements (Per-Task map) | 9 |
| Automated COVERED (green) | 3 (SC-4 crop math, FREE-02 card guard, build/install) — 32/32 lib tests |
| Manual-only verified (UAT PASS) | 4 (FAB drag+clamp, single-card, Send→.md, success toast, re-map) |
| Manual-only deferred | 2 (Test 1 capture round-trip, Test 5 host-down error toast) |
| Automated gaps MISSING | 0 |
| Auditor spawned | No — zero automatable gaps to fill (deferred items are Chrome-runtime-bound, not unit-testable in node:test) |

**Verdict:** PARTIAL. Every requirement that *can* be automated is automated and green; remaining items are intrinsically manual (Chrome API + paint timing). Test 1 (capture round-trip) gates Phases 5/6 — complete it before they consume the capture trio.
