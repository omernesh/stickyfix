---
phase: 4
slug: free-note-mode-capture-utilities
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-31
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
| `lib/capture.ts` `computeCropCoords(rect, dpr)` pure math | 0 | SC-4 | DPR-correct crop; Math.round; no DOM | unit | `node --test` capture.test (DPR=1,1.25,2) | ⬜ |
| single-active-card state guard | 0 | FREE-02 | only one card; re-open focuses | unit | `node --test` | ⬜ |
| `npm install interactjs@1.10.27` + lib test wiring | 0 | FREE-01/02 | locked stack version | build | `tsc -p tsconfig.lib.json` + test:lib green | ⬜ |
| FAB + post-it card (interactjs drag, clamp) | 1 | FREE-01,02 | viewport-clamped; shadow isolation | tsc + manual | `tsc --noEmit`; Chrome: FAB drags, card opens, single | ⬜ |
| free-note payload + Send via SFX_SEND_ANNOTATION | 1 | FREE-03 | text-only (`screenshots:[]`); SW relay only | tsc + manual | Chrome: Send → `0001-*.md` on disk | ⬜ |
| toast (success/error) | 1 | FREE-04 | never silent (REL-01); echoes host `file` | tsc + manual | Chrome: success toast names file; host-down → error toast | ⬜ |
| `captureVisibleTab` SW relay + double-rAF flush + crop wiring | 1/2 | SC-4 | SW is sole privileged caller; own-UI hidden | tsc + manual + integration | Chrome: captureVisibleTab round-trips through SW | ⬜ |
| chip re-map affordance | 1 | (carry-fwd) | onclick assignment (no listener stack) | manual | Chrome: click label → dropdown → re-routes | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red. Exact task IDs assigned by the planner.*

---

## Wave 0 Requirements

- [ ] `lib/test/capture.test.ts` — `computeCropCoords` at DPR=1, 1.25, 2 (the headline Success-Criterion-4 unit test) + single-active-card guard
- [ ] `lib/capture.ts` exports a **pure** `computeCropCoords(rect, dpr)` (no DOM) so it runs under `node:test`; the canvas `cropToRect` wrapper is manual-only
- [ ] node:test runner wired so these run under `npm run check` (extend `test:lib` script)
- [ ] `interactjs@1.10.27` installed (locked stack version)

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

- [ ] Pure crop math + card state guard have node:test coverage (DPR=1/1.25/2)
- [ ] Type-check (`tsc --noEmit`) green for extension + host
- [ ] Manual Chrome UAT items recorded as HUMAN-UAT after execution
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` flipped by execute-phase once test files exist + pass

**Approval:** pending
