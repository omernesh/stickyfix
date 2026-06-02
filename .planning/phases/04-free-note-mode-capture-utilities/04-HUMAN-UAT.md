---
status: partial
phase: 04-free-note-mode-capture-utilities
source: [04-VERIFICATION.md]
started: 2026-06-01
updated: 2026-06-01
---

## Current Test

[awaiting human testing — load unpacked extension from `.output/chrome-mv3/`, run `npm run host -- --root <test-dir>`, enter Review Mode on any HTTPS page]

## Tests

### 1. Capture trio round-trip
expected: `captureTab(tabId)` → SW `captureVisibleTab` → `waitTwoRafs` → `cropToRect` returns a DPR-correct PNG crop; the stickyfix own-UI (chip/FAB) is absent from the screenshot (double-rAF flush worked); a free note sent in the same session still writes `screenshots: []`.
result: [pending]

### 2. FAB drag + viewport clamp
expected: the `+` FAB drags smoothly in Review Mode and is clamped inside the window.
result: pass
note: fixed in 8f85d3c (threshold pointer-drag replacing interactjs). User confirmed drag works after reload.

### 3. Single-card enforcement
expected: double-clicking the FAB does not open a second post-it; the existing card is focused instead.
result: pass
note: FAB click now opens the card (fixed in 8f85d3c). User confirmed "everything working" after reload — single card opens on tap.

### 4. Free-note Send end-to-end
expected: typing a note and pressing Send writes a `.md` file on disk with correct content; the success toast names the written file and auto-dismisses after ~3s.
result: pass
note: After the FAB fix (8f85d3c), the full FAB→post-it→Send flow works — user sent "test note #2" / others via the card; 0004-20260602-090416.md written correctly. Earlier 0001 confirmed frontmatter (mode:free, screenshots:[], url/title/viewport/status).

### 5. Host-down error toast persistence
expected: with the host stopped, Send surfaces a persistent error toast; the × dismiss works; the card stays open (no silent failure).
result: [pending]

### 6. Chip label re-map (D-09)
expected: the routed-label dropdown re-opens on click; selecting a new project persists the re-map.
result: pass
note: fixed in 10eaf4a (added .sfx-label-routed/.sfx-chip-dropdown to makeDraggable exclusion). User confirmed re-map works after reload.

## Summary

total: 6
passed: 4
issues: 0
pending: 2
open-gaps: 0 (all 3 discovered defects resolved + verified by user)
note: tests 2,3,4,6 PASS after fix-pass (8f85d3c FAB click/drag, 10eaf4a re-map, ae4e4c4 top-layer stacking — all user-confirmed). User ACCEPTED phase 2026-06-02 ("everything looks good"). Tests 1 (capture round-trip) and 5 (host-down error toast) deferred by choice — remain tracked. NOTE: Test 1 (capture trio) gates Phases 5/6 which inherit captureTab/cropToRect/waitTwoRafs — eyeball it when starting Phase 5. Session status: partial (2 deferred).
skipped: 0
blocked: 0

## Gaps

- truth: "The + FAB is interactive in Review Mode — a click opens a post-it card, and the FAB drags + clamps to the viewport (interactjs)"
  status: failed
  reason: "CONFIRMED via runtime probe: programmatic fab.click() opens the card and writes a note (0003.md), so the FAB is mounted, getTabId resolves, and openCard works. The NATIVE mouse click was swallowed because interactjs draggable was bound to the FAB element itself (which is also the click target) with no click/drag threshold — the pointer gesture was consumed and the native click never fired. Pre-existing from 04-02 (not a regression from review fixes)."
  status: resolved
  fix_commit: 8f85d3c
  resolution: "Replaced interactjs FAB drag with threshold pointer-drag (tap<4px => onOpen; movement => drag + one-shot synthetic-click suppression). User confirmed FAB click + drag work."
  severity: blocker
  test: 2, 3
  artifacts: [entrypoints/review.content/fab.ts]
  missing: []
- truth: "Clicking the routed-project label re-opens the host dropdown; selecting a new project persists the re-map (D-09)"
  status: failed
  reason: "CONFIRMED via code: the routed label is a <span class='sfx-chip-label sfx-label-routed'>, but chip.ts makeDraggable (line 453) only yielded drag to 'button, select, input, option, a, textarea' — NOT spans. Clicking the label started a chip drag (setPointerCapture + preventDefault), so label.onclick never fired. The 'message channel closed' console errors were a red herring. Pre-existing from 04-02."
  status: resolved
  fix_commit: 10eaf4a
  resolution: "Added '.sfx-label-routed' and '.sfx-chip-dropdown' to the makeDraggable yield selector. User confirmed re-map dropdown opens + persists."
  severity: major
  test: 6
  artifacts: [entrypoints/review.content/chip.ts]
  missing: []
- truth: "The chip always renders above page content (z-index / top layer)"
  status: resolved
  reason: "Page (React SPA) had competing elements at equal max z-index / browser top layer; z-index alone could not win. Anchor-last (d63862e) was insufficient."
  fix_commit: ae4e4c4
  resolution: "Promoted the WXT shadow host (ui.shadowHost) into the browser top layer via popover='manual' + showPopover(), with :host([popover])/:host(:popover-open) CSS neutralizing the popover UA box styles. Graceful fallback to max z-index if unsupported. User confirmed chip now always on top."
  severity: minor
  test: n/a (new)
  artifacts: [entrypoints/review.content/index.ts, entrypoints/review.content/styles.css]
  missing: []
