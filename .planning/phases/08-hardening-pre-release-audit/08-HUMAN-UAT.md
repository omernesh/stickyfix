---
status: partial
phase: 08-hardening-pre-release-audit
source: [08-VERIFICATION.md]
started: 2026-06-04
updated: 2026-06-05
---

## Current Test

[awaiting human testing]

> Detailed repro steps for every item below live in the full runbook:
> `.planning/phases/08-hardening-pre-release-audit/08-UAT.md`
> (5 failure paths + D-05 regression + D-04 pre-flight + D-02a multi-Send).
> Run the extension built by this session against the running UAT host
> (`--root D:/docker/stickyfix-uat`, port 39240).

## Tests

### 1. REL-01 — all five failure paths surface a visible toast (SC-1)
expected: Each path shows its verbatim toast, never a silent drop —
  host unreachable → "Host unreachable: …"; 401 → "unauthorized";
  no token set → "No token set for host"; 413 oversize → "Payload Too Large";
  no host for origin → "No host mapped for origin: …".
result: PARTIAL (2026-06-05).
  - 401 wrong token → PASS. (False alarm during testing: the green "✓" the tester
    saw was the popup Apply-confirm flash, not a send success. Host auth verified
    correct by direct probe — wrong token → 401, correct → 200. Actual Send with a
    wrong token surfaces "unauthorized".)
  - no token set → PASS ("No token set for host …").
  - host unreachable → SKIPPED by tester (code path returns "Host unreachable: …"
    via the SW fetch catch; not manually exercised this session).
  - 413 oversize → SKIPPED (non-blocking; covered by D-04 pre-flight unit tests).
  - no host mapped for origin → NOT EXERCISED: unreachable on a single-host setup
    because resolveRoute single-host auto-select always resolves. Requires ≥2
    registered hosts to trigger; covered by lib/routing.test.ts (resolveRoute → null).

### 2. REL-01 / SW-evicted-mid-flight — the critical path (SC-1)
expected: With Review Mode active, Stop the service worker via chrome://extensions,
  then Send. The dead-channel guard fires and an "Extension error: …" toast appears —
  the note is NOT silently dropped.
result: PASS (2026-06-05). Initial run FAILED — disabling the whole extension made
  chrome.runtime.sendMessage throw synchronously ("Extension context invalidated"),
  so the lastError callback guard never ran and the note dropped silently. Fix: wrapped
  all three send call sites (chip.ts wireSendButton, card.ts _doSend, card.ts
  _doElementSend) in try/catch that routes the synchronous throw through the same
  channel-dead toast/feedback + control-restore path. Re-tested: "Extension error: …"
  now surfaces. No silent drop.

### 3. D-05a — SW idle-eviction state survival
expected: After the service worker is evicted, chrome.storage.local rehydrates host
  registry/token/origin map; a subsequent Send still routes correctly to the host.
result: PASS (2026-06-05). SW idle-evicted (DevTools inspector closed, ~30s),
  then a Send without page reload re-woke the SW, rehydrated from storage, and
  routed correctly. No "Extension error:" toast.

### 4. D-05b — multi-note serial increment (live, extension-driven)
expected: Two Sends in a row write 0001-… then 0002-… to disk (end-to-end relay,
  not just the host mutex).
result: PASS (2026-06-05). Live extension-driven Sends produced consecutive serials
  on disk (0009 → 0010 → 0011, no gaps or duplicates) across the picker test runs.

### 5. D-04 — pre-flight blocks oversize before any round-trip
expected: A near-/over-12 MB screenshot Send shows the "Payload Too Large" toast
  immediately; DevTools Network tab shows NO ~12 MB POST left the extension
  (pre-flight fired before sendMessage).
result: SKIPPED (2026-06-05) — non-blocking per runbook; hard to push a docs-page
  screenshot over 12 MB. Pre-flight covered by unit tests.

## Summary

total: 5
passed: 3
partial: 1
issues: 7
pending: 0
skipped: 1
blocked: 0

(passed: #2, #3, #4 · partial: #1 (2 paths PASS, 3 skipped/covered) · skipped: #5)

## Gaps

All gaps below were found during the live Chrome UAT on 2026-06-05 and FIXED +
rebuilt the same session. Extension-side only; host untouched. typecheck clean,
159/159 lib tests pass after all fixes.

### G-08-01 — Silent drop on synchronous sendMessage throw (BLOCKER, fixed)
Disabling the whole extension mid-flight makes `chrome.runtime.sendMessage` throw
synchronously ("Extension context invalidated"); the `lastError` callback never
runs, so the note dropped with NO toast — a REL-01/SC-1 violation. Fix: wrapped all
three send call sites (`chip.ts` wireSendButton, `card.ts` _doSend, _doElementSend)
in try/catch routing the throw through the existing channel-dead toast + control
restore. (Surfaced via Test #2.)

### G-08-02 — FAB occludes chip controls (overlap, fixed)
`#sfx-chip` and `#sfx-fab` had no z-index; the draggable FAB, parked over the chip,
stole clicks on the chip's "×". Fix: explicit layering — chip `z-index:5`, FAB
`z-index:4` (both above pins(2)/preview(3)). `styles.css`.

### G-08-03 — Picking a link navigates away (BLOCKER, fixed)
Picker did not suppress the page click (deferred edge case T-05-08 / AR-05-3,
explicitly slated for Phase 8), so picking an `<a>` followed the link before a note
could be written — broke element capture on any interactive element. Fix:
capture-phase `click` + `mousedown` + `auxclick` suppression (preventDefault +
stopImmediatePropagation) in `picker.ts`. Verified: note 0010 captured a real
stretched-link `<a>` with no navigation.

### G-08-04 — Cannot pick elements under overlay links (usability, fixed)
On pages using the Bootstrap `.stretched-link` pattern the link's `::after` overlay
covers the whole card, so only the link is hoverable. Fix: ↑/↓ DOM traversal
(parent / first-child) in `picker.ts`, with a blue "locked" highlight state.

### G-08-05 — Pick was single-click, no confirm step (UX, changed)
Changed to an explicit two-step model: 1st click selects (blue, no note), 2nd click
or Enter opens the note; ↑/↓ adjust the selection; deliberate mouse move releases.
`picker.ts` + `.sfx-pick-locked` style.

### G-08-06 — Pick mode exited on note discard (UX bug, fixed)
Discarding/cancelling an element note exited pick mode (only Send re-armed it). Fix:
`openElementCard` gained an `onDiscard` callback (Esc + Discard paths) wired in
`index.ts` to re-arm pick mode; free-note (FAB) discard behavior unchanged.

### G-08-07 — On-screen pick hints + popup toggle (feature)
Added a "Show hints in Pick Mode" preference (`sfxPrefs.showHints`, default on) with
a popup checkbox, and an on-screen instruction panel shown on pick-mode entry:
semi-transparent, Arial, draggable ("drag to move"), with a × to dismiss for the
session, z-index above the free-note card. `lib/types.ts`, `lib/storage.ts`,
`popup/*`, `picker.ts`, `chip.ts`, `styles.css`.

### Remaining (non-blocking, not exercised live)
- REL-01 "host unreachable" toast — code path present, not manually run (tester skipped).
- REL-01 "no host mapped for origin" — needs ≥2 hosts to bypass single-host
  auto-select; covered by `lib/routing.test.ts`.
- D-04 oversize pre-flight — covered by unit tests; not run live.
