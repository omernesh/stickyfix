# Phase 4: Free-Note Mode + Capture Utilities — Discussion Log

**Mode:** `--auto` (autonomous — recommended default selected for every gray area, single pass, no user prompts)
**Date:** 2026-05-31

This log records each decision point, the options considered, and the auto-selected
choice. `[auto]` marks a default chosen without user input. Where the PRD constrained
or overrode a default, it is noted explicitly.

---

## 1. FAB placement & host mount (FREE-01 / FREE-02)

**Gray area:** Where does the `+` FAB live, and does it get its own injected root?
- Option A: separate `createShadowRootUi` mount for the FAB/card.
- Option B: reuse the **existing** review mount (chip already lives there).

`[auto]` FAB host — separate mount vs reuse existing review mount → **reuse existing mount** (one `createShadowRootUi` hosts chip + FAB + card + toast; avoids second-root z-index/teardown management). Default placement **bottom-right**, offset from the top-right chip.

**PRD check:** §6.5 "one active post-it at a time" and §6.2 (draggable `+`) consistent. No override.

---

## 2. Single-card enforcement (FREE-02)

**Gray area:** What happens if the FAB is clicked while a card is open?
- Option A: spawn a second card.
- Option B: focus/reuse the existing card (single active card).

`[auto]` Multiple cards vs single active card → **single active card; re-click focuses the existing one** (PRD §6.5 / §14 locked-default "one active post-it at a time" — this is a PRD constraint, not just a default).

---

## 3. Drag implementation (FREE-01 / FREE-02)

**Gray area:** interactjs vs the existing pointer-events `makeDraggable`.
- Option A: hand-rolled pointer events (as the chip uses today).
- Option B: **interactjs** (the stack-table choice for FAB/post-it/chip drag + future marquee).

`[auto]` Drag impl — pointer-events vs interactjs → **interactjs for the new FAB + post-it card** (stack choice; same lib reused for the Phase-6 region marquee). Wired to operate inside the shadow root, viewport-clamped.

`[auto]` Retrofit chip to interactjs this phase? → **NO** — chip keeps its proven Phase-3 pointer-events drag. Rationale: touching a working surface risks a regression (developer's top frustration); not in FREE scope.

**PRD check:** §7.2 lists interact.js for the `+` FAB and post-it. Consistent. No override.

---

## 4. Capture utility trio — what to build (Success Criterion 4)

**Gray area:** scope and shape of the "+ Capture Utilities" half.

`[auto]` Capture trio composition → build **three** standalone utilities:
- (a) `captureVisibleTab` **SW relay** (SW is sole privileged caller — consistent with the Phase-3 relay boundary; CS lacks the permission).
- (b) **double-rAF flush** helper (await two rAFs so own-UI paints/hides before capture).
- (c) **DPR-correct crop** helper (canvas `drawImage`, CSS rect × `devicePixelRatio`, `Math.round`; tested DPR 1 / 1.25 / 2).

`[auto]` Test depth → **unit-test all three** (pure DPR/crop math under `node:test`, no chrome API) **+ one integration test** round-tripping `captureVisibleTab` through the SW. Satisfies Success Criterion 4 explicitly.

**PRD check:** §7.3 is the source for all three mechanics (native capture, DPR multiply, hide-own-UI-before-capture). Consistent.

---

## 5. ⚠️ Screenshot on free notes? (FREE-03) — KEY SCOPE DECISION

**Gray area:** Do free notes get an auto screenshot now that the capture trio exists?
- Option A: add a visible-tab screenshot to the free-note payload (tempting — the utilities are right there).
- Option B: free notes stay **text-only**; trio is built/tested standalone, consumed in Phases 5/6.

`[auto]` Free-note screenshot — add now vs text-only → **TEXT-ONLY (`screenshots: []`)**. The capture trio is proven standalone (unit + one SW integration test); its real consumers are Phase 5 (element `+1`) and Phase 6 (region `+N`). Keeps FREE scope tight; de-risks the pixel path early without coupling it to the free-note flow.

**PRD override/confirm:** PRD §7.3 explicitly states **"(Free notes have no auto shot.)"** and FREE-03 lists only url/title/timestamp/viewport. → **The PRD positively confirms this default.** Flagged as the single most important decision for the planner (CONTEXT D-06). **Do not wire capture into the free-note Send.**

---

## 6. Toast surface (FREE-04 / REL-01)

**Gray area:** Reuse the chip's inline `showFeedback` stub, or introduce a real toast?
- Option A: keep inline chip feedback.
- Option B: introduce a shadow-root **toast** surface.

`[auto]` Send feedback — inline chip stub vs real toast → **real toast surface** in the shared mount. Success: auto-dismiss ~3s, names the written file. Error: **persists until dismissed**, names the reason. Never silent (REL-01).

`[auto]` Toast coverage depth this phase → **surface + success + host-down only**; exhaustive failure-path matrix (401/413/SW-evicted/no-host) is **Phase 8**.

**PRD check:** §7.5 / §14 #4 / REL-01 require a visible toast naming the file on success and the reason on failure. Consistent.

---

## 7. Send transport (FREE-03)

**Gray area:** New annotation transport, or reuse the proven relay?

`[auto]` Free-note Send transport → **reuse the existing `SFX_SEND_ANNOTATION` relay** (proven end-to-end in Phase 3's stub). This phase only swaps the stub comment for the real textarea value; no new transport.

---

## 8. Re-map / "change project" affordance (carry-forward — Phase-3 UAT)

**Gray area:** The Phase-3 mapping was write-once with no way to re-point a mapped origin (user-flagged during UAT).

`[auto]` Add re-map control → **YES** — clicking the chip's routed label re-opens the project dropdown (reusing `renderDropdown`) and overwrites via the existing `SFX_SET_ROUTE`.

`[auto]` Listener binding for the re-bindable label → **`.onclick =` assignment, not `addEventListener`** — prevents handler stacking across re-renders. Low-risk, reuses proven Phase-3 paths.

**PRD check:** §6.1 routing is "never re-asked" by default; an explicit user-initiated re-map is an additive affordance, not a violation. No override.

---

## Summary of auto-selected decisions

| # | Decision | Choice | PRD relation |
|---|----------|--------|--------------|
| 1 | FAB mount | Reuse existing shadow-root mount, bottom-right | consistent |
| 2 | Card count | Single active card (re-click focuses) | **PRD-locked** (§6.5/§14) |
| 3 | Drag | interactjs on FAB/card; chip keeps pointer-events | consistent (§7.2) |
| 4 | Capture trio | 3 utils, unit-tested (DPR 1/1.25/2) + 1 SW integ test | consistent (§7.3) |
| 5 | Free-note screenshot | **TEXT-ONLY — no auto shot** ⚠️ | **PRD confirms** (§7.3) |
| 6 | Toast | Real shadow-root toast; success+host-down this phase | consistent (§7.5) |
| 7 | Send transport | Reuse `SFX_SEND_ANNOTATION` | consistent |
| 8 | Re-map | Chip label `.onclick` → dropdown → `SFX_SET_ROUTE` | additive |

**PRD overrides:** none contradicted a default. PRD §7.3 **positively confirmed** decision #5 (free notes text-only).

---

*Phase: 4-Free-Note Mode + Capture Utilities*
*Discussion logged: 2026-05-31*
