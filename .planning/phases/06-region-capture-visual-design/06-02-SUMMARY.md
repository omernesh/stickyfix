---
phase: 06-region-capture-visual-design
plan: 02
subsystem: region-capture-ui
tags: [camera-tool, marquee, thumbnail-strip, interactjs, shadow-dom, capture-trio]
dependency_graph:
  requires:
    - 06-01 (lib/marquee.ts buildMarqueeRect/isBelowThreshold, lib/capture.ts trio)
  provides:
    - entrypoints/review.content/marquee.ts (enterMarqueeMode)
    - entrypoints/review.content/card.ts (camera button + thumbnail strip on both card modes)
    - entrypoints/review.content/styles.css (camera/thumbnail CSS + paper aesthetic)
  affects:
    - Chrome UAT (Task 3 — PENDING-HUMAN)
tech_stack:
  added: []
  patterns:
    - enterMarqueeMode returns cleanup() fn (picker.ts enter/exitPickMode analog)
    - interact(scrim direct-ref).draggable() — no context:shadowRoot (card.ts:195 pattern)
    - T-06-07: cleanup() removes scrim DOM BEFORE setSfxVisibility(false)→waitTwoRafs→captureTab
    - ThumbnailEntry[] scoped per card call (not module-level)
    - renderThumbnails() rebuilds strip via replaceChildren() + createElement/textContent
    - Element-note thumbnails offset by +1 (reserve +1 for element auto-highlight)
key_files:
  created:
    - entrypoints/review.content/marquee.ts
  modified:
    - entrypoints/review.content/card.ts
    - entrypoints/review.content/styles.css
decisions:
  - "T-06-07 ordering: enterMarqueeMode cleanup() contract requires scrim removal BEFORE setSfxVisibility — documented in JSDoc of both marquee.ts and card.ts onCapture handlers"
  - "Element-note camera thumbnails start at +2 (thumbnails.push kind offset +1) to preserve the element auto-highlight as +1 in the final screenshots array"
  - "Free setSfxVisibility and element setSfxVisibility are defined inline per onCapture scope (closures over container) to avoid adding the scrim to the shared setSfxVisibility helper — per plan constraint"
  - "Paper aesthetic CSS (UI-02, UI-03) applied as overrides to existing #sfx-card + .sfx-card-header rules — no structural DOM changes"
metrics:
  duration: ~35m
  completed: "2026-06-03"
  tasks: 3
  files: 3
---

# Phase 06 Plan 02: Region Capture Vertical Slice Summary

Camera button on both card modes, drag-marquee scrim (35% black overlay, crosshair cursor, interact.js direct-ref), DPR-correct crop via the existing lib/capture.ts trio, deletable multi-thumbnail strip, and screenshots payload mapping — plus paper-aesthetic CSS polish.

## One-liner

Region capture camera tool on free + element note cards: marquee scrim (interact.js), DPR-correct cropToRect, deletable thumbnail strip (+1/+2…), CAM-06 screenshots payload wiring, and paper-aesthetic card CSS (amber/blue mode headers).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | marquee.ts (scrim + interact.js + Esc) and scrim/thumbnail CSS | 7892d8e | entrypoints/review.content/marquee.ts, entrypoints/review.content/styles.css |
| 2 | Camera button + thumbnail strip + capture wiring in card.ts | decbb76 | entrypoints/review.content/card.ts |
| 3 | Chrome UAT — region capture end to end (CAM-01..06) | PENDING-HUMAN | — awaiting human verification |

## Verification Results

- `npm run build`: GREEN (138 kB content-script bundle; host tsc clean)
- `tsc --noEmit` (extension): 0 errors
- `npm run test:lib`: 116/116 pass (no regressions in lib/marquee.ts + lib/capture.ts)
- Task 3 Chrome UAT: PENDING-HUMAN — see Checkpoint Details below

## Acceptance Criteria Status

### Task 1

| Criterion | Status |
|-----------|--------|
| `npm run build` succeeds | PASS |
| `interact(scrim` with direct element ref | PASS (`interact(scrim).draggable()` line 68) |
| `grep -c "context:" marquee.ts` = 0 code occurrences | PASS (3 comment occurrences only) |
| Esc handler calls `interactable.unset()` with capture:true | PASS (lines 103, 112) |
| CSS classes present: .sfx-cam-scrim, .sfx-cam-rect, .sfx-cam-btn, .sfx-thumb-strip, .sfx-thumb-del | PASS |
| No rem in new CSS additions | PASS (grep returns empty) |
| No innerHTML in marquee.ts code | PASS (1 occurrence in comment only) |

### Task 2

| Criterion | Status |
|-----------|--------|
| `npm run build` succeeds | PASS |
| `.sfx-cam-btn` on both openCard + openElementCard headers | PASS (lines 160, 507) |
| T-06-07 capture ordering: cleanup → setSfxVisibility(false) → waitTwoRafs → captureTab → cropToRect → setSfxVisibility(true) | PASS |
| No new innerHTML in card.ts | PASS (all 4 occurrences are in comments) |
| `thumbnails.map` in both _doSend and _doElementSend | PASS (lines 397, 830) |
| Existing free-note + element-note send-payload lines unchanged except screenshots field | PASS |

### Task 3 — Chrome UAT (PENDING-HUMAN)

**Status:** PENDING — awaiting Omer's Chrome verification per checkpoint protocol.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written for Tasks 1 and 2.

### Implementation Notes

**Element-note thumbnail numbering:** The plan says "element auto-highlight stays first" and "region thumbnails continue from there." Implementation uses `thumbnails.push({ kind: '+${thumbnails.length + 2}' })` (offset +1) in the camera button handler for element cards. This reserves `+1` for the element auto-highlight written by `_doElementSend`. The final screenshots array in `_doElementSend` is `[{kind:'+1', ...plus1DataUrl}, ...thumbnails.map()]`, producing the correct ordering.

## Checkpoint Details — Task 3: Chrome UAT (PENDING-HUMAN)

**Gate:** blocking — no auto-approve

**What was built:**
A 📷 camera button on free + element note cards that opens a dimming scrim (35% black overlay, crosshair cursor); drag-marquee region capture (DPR-correct crop via captureTab + cropToRect); deletable multi-thumbnail strip (+1/+2…); thumbnails sent as +N.png through the existing host pipeline.

### Chrome UAT Steps (exact steps from plan Task 3)

**Prerequisites:** `npm run build`, then start the host (`npm run host -- --root <a test project dir>`), load the unpacked extension from `.output/chrome-mv3/`, enter Review Mode on an HTTPS page, set the token in the popup.

1. Open a free note (+ FAB). Confirm a 📷 button is in the card header. Click it: the page dims (35% scrim) and the cursor becomes a crosshair.

2. Press Esc → scrim disappears, card returns, NO thumbnail added. Click 📷 again, do a tiny (<6px) click-drag → cancels, NO thumbnail.

3. Click 📷, drag a real rectangle over page content, release → a thumbnail appears in the strip showing the cropped region (verify the crop matches the dragged area and contains NO sfx UI / no scrim outline).

4. Drag a second region → a second thumbnail (+2). Click the × on the first thumbnail → it is removed and the remaining one renumbers.

5. Type a note, Send → success toast with filename. On disk: the `.md` frontmatter + body reference the remaining `+N.png`, and the PNG file(s) exist next to the `.md` and visually match the captured region(s).

6. Repeat 1–5 using an element note (🎯 pick an element first): confirm the element auto-highlight `+1.png` is still produced AND region thumbnails stack after it.

7. REGRESSION: send one plain free note (no camera) and one plain element note (no camera) — both still write correct `.md` files as before.

**Resume signal:** Type "approved" or describe any issue (wrong crop, scrim in image, missing PNG, broken Send, regression).

## Known Stubs

None — all implemented functions are fully operational. Thumbnail data URLs are passed directly to the host's existing write-note.ts screenshot pipeline.

## Threat Flags

No new security surfaces beyond the plan's threat model.
- T-06-07 (own-UI leak): mitigated — scrim removed by cleanup() before setSfxVisibility(false)
- T-06-09 (DoS — scrim blocks exit): mitigated — scrim z-index:1 below chip/FAB; Esc always cancels
- T-06-05 (XSS via thumbnail label): mitigated — createElement/textContent only; img.src is data: URI
- T-06-08 (supply chain): accepted — zero new packages

## Self-Check: PASSED

- entrypoints/review.content/marquee.ts: FOUND
- entrypoints/review.content/card.ts: FOUND (modified)
- entrypoints/review.content/styles.css: FOUND (modified)
- Commits: 7892d8e, decbb76 — verified in git log
