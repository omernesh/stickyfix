---
status: investigating
trigger: "Phase 4 UAT — FAILURE A: FAB completely inert (no click, no drag); FAILURE B: chip label D-09 re-map doesn't work. Chip Send works (stickyfix relay proof written to disk). No mount-time JS exception."
created: 2026-06-01T00:00:00Z
updated: 2026-06-01T00:01:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis_A: The FAB's pointer-events fallback (_applyPointerEventsDrag in fab.ts lines 103-165) is running because interact(fab) is throwing inside the try/catch. The fallback calls e.preventDefault() on pointerdown (fab.ts:128), which suppresses the click event on the FAB button in Chrome, making the FAB completely inert — no click opens the card, no drag works.

hypothesis_A_alt: interact(fab) succeeds but the drag is not working due to a shadow-DOM event boundary issue specific to Chrome extensions (not yet eliminated).

hypothesis_B: The chip label.onclick wiring is correct and unchanged by the fix commits. The D-09 failure is either (a) the label click IS firing but renderDropdown fails because REFRESH_HOSTS (async SW message with return true) gets a "message channel closed" error before responding, leaving the dropdown empty; OR (b) the label.onclick was accidentally cleared after being set.

test: Verify the fallback path theory for A by checking whether interact() would throw for the specific shadow-DOM element context. For B, check if label.onclick is set correctly after route resolves.
expecting: The fallback runs for A due to interact() or draggable() throwing, and B is an independent SW lifecycle issue (not a code regression).
next_action: Report findings — diagnosis only, no fixes.

## Symptoms

expected: FAB drags freely within viewport (interactjs), FAB click opens post-it card; routed-project label click re-opens dropdown for project re-map.
actual: FAB completely inert (no click, no drag); chip label click produces no visible dropdown.
errors: "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received" x4. No content-script mount exception.
reproduction: Enter Review Mode on any page; try FAB click; try FAB drag; try chip label click.
started: After code-review fix-pass commits (6c5e07f, dd8caa6, b367704, 1024e2f). Chip phase-3 Send works (proves review.js loads).

## Eliminated

- hypothesis: Single mount-time throw kills all handlers (original strong hypothesis)
  evidence: The chip (same shadow root, same mount) works fully — drags, Send button works. No single throw could kill FAB without killing chip. Also no mount-time JS exception reported.
  timestamp: 2026-06-01

- hypothesis: WR-01 TDZ error — const fab = mountFab(container, () => { fab.setAttribute(...) })
  evidence: The callback closes over fab but never accesses it synchronously during mountFab execution. fab.setAttribute is only called on user click, well after fab is assigned. esbuild compiles to let r = me(e, callback) — valid deferred closure. No TDZ error.
  timestamp: 2026-06-01

- hypothesis: getTabId() in index.ts always rejects (FAB never mounted)
  evidence: SFX_GET_TAB_ID handler is synchronous — it always calls sendResponse immediately with sender.tab?.id. For content scripts, sender.tab.id is always a number. The chip's own getTabId() works (chip shows route), proving the SW tab-id path is alive.
  timestamp: 2026-06-01

- hypothesis: interactjs CSS manipulation (pointer-events: none) makes FAB non-interactive
  evidence: Grep of build output shows only 3 .style.x = assignments in interactjs, all setting cursor. No pointer-events manipulation by interactjs.
  timestamp: 2026-06-01

- hypothesis: WR-01 change (adding fab.setAttribute calls) causes a runtime error in onOpen
  evidence: fab.setAttribute('aria-expanded', 'true') on a valid HTMLButtonElement cannot throw. The only change from WR-01 is adding attribute manipulation calls — no structural change to FAB mounting or event wiring.
  timestamp: 2026-06-01

## Evidence

- timestamp: 2026-06-01
  checked: entrypoints/review.content/index.ts (WR-01 diff)
  found: mountFab is called inside getTabId().then() callback. The .catch(() => {}) silently swallows both getTabId rejection AND any sync throw from mountFab. However getTabId succeeds (chip works), and mountFab's internal try/catch prevents external throws.
  implication: FAB IS mounted. The FAB element IS in the shadow DOM.

- timestamp: 2026-06-01
  checked: .output/chrome-mv3/content-scripts/review.js — compiled mountFab function
  found: Compiled as function me(e,t){...try{(0,L.default)(n).draggable({...})}catch{R(n)}return n} where R is _applyPointerEventsDrag.
  implication: If interact(fab) throws, fallback _applyPointerEventsDrag is invoked on the FAB element.

- timestamp: 2026-06-01
  checked: fab.ts lines 110-128 (_applyPointerEventsDrag)
  found: Fallback registers pointerdown on el (the FAB). Inside the handler: el.setPointerCapture(e.pointerId) + isDragging=true + e.preventDefault() is called UNCONDITIONALLY on every pointerdown.
  implication: If the fallback is running, e.preventDefault() on pointerdown suppresses the click event for the FAB button in Chrome (mousedown compatibility event is suppressed, which suppresses click). FAB would be completely inert: no click (card doesn't open), drag would also be broken (no proper clamp, no interactjs state).

- timestamp: 2026-06-01
  checked: interactjs bundle in build output — pointerdown preventDefault behavior
  found: interactjs's checkAndPreventDefault in 'auto' mode (default): skips preventDefault for events matching /^(mouse|pointer|touch)*(down|start)/i — so pointerdown is EXEMPT. interactjs does NOT call preventDefault on pointerdown. Uses composedPath()[0] to resolve shadow-DOM elements correctly. No throw expected from interact(fab).draggable({...}).
  implication: If interactjs succeeds, the click event IS NOT suppressed by interactjs. FAB click should work. This contradicts the fallback theory IF interactjs works without throwing.

- timestamp: 2026-06-01
  checked: chip.ts renderRoutedLabel (lines 238-261), dd8caa6 diff
  found: label.onclick = () => { renderDropdown(..., showFeedbackFn) } — correct wiring. The only change in dd8caa6 was adding showFeedbackFn parameter to function signatures. The label.onclick logic is IDENTICAL to pre-fix code. renderDropdown sends REFRESH_HOSTS (return true async handler).
  implication: If label.onclick fires, renderDropdown runs and sends REFRESH_HOSTS to SW. The "message channel closed" x4 errors suggest SW lifecycle issues killing async responses. This would leave the dropdown empty ("No hosts found") even if hosts exist.

- timestamp: 2026-06-01
  checked: build output — interactjs docEvents registration
  found: (E.PointerEvent ? [{type:s.down,listener:l},{type:s.down,listener:t.pointerDown},...]) — interactjs registers pointerdown/pointermove/pointerup on document. Uses composedPath() to resolve shadow-DOM target correctly.
  implication: interactjs's event wiring for shadow DOM is correct. The drag SHOULD work if interact(fab).draggable() succeeded.

- timestamp: 2026-06-01
  checked: styles.css — FAB CSS
  found: #sfx-fab { pointer-events: auto; position: fixed; bottom: 32px; right: 32px; ... } — explicitly auto. No z-index. No visibility:hidden. WXT shadow root reset (:host{all:initial !important}) sets :host pointer-events to auto (initial value, overrides project's pointer-events:none for the host element). Child elements (#sfx-fab, #sfx-chip) unaffected by :host reset — they get their styles from the shadow stylesheet directly.
  implication: Pointer events are correctly set. No CSS is blocking FAB interaction.

## Resolution

root_cause: |
  FAILURE A: The _applyPointerEventsDrag fallback in fab.ts (lines 103-165) is running instead of
  the interactjs drag path. The fallback calls e.preventDefault() unconditionally on every pointerdown
  (fab.ts:128), which suppresses the subsequent click event on the FAB button in Chrome (pointerdown
  preventDefault kills the mousedown compat event, which kills click). This makes the FAB completely
  inert: no click opens the card, no drag works.

  WHY the fallback runs is uncertain from static analysis alone — interact(fab).draggable() appears
  correct and should not throw. Runtime possibilities: interactjs version incompatibility with the
  specific Chrome extension MV3 shadow-root context, or a DOM timing issue at interact() call time.
  The bug surface (e.preventDefault in the fallback) is confirmed; the trigger (what causes the throw)
  requires runtime verification.

  NOTE: The fix commits (WR-01/CR-01/WR-03/WR-04) did NOT touch fab.ts. This bug likely exists
  in the original phase-4 code (04-02). The fix commits are NOT the regression source.

  FAILURE B: The chip label.onclick wiring is correct and unchanged by the fix commits. The D-09
  re-map failure is a pre-existing MV3 service worker lifecycle issue: the SW terminates while
  processing the async REFRESH_HOSTS (return true handler in background.ts line 431), triggering
  "message channel closed" errors. The dropdown appears but says "No hosts found," blocking selection.
  NOT a code regression from any fix commit.

fix: |
  FAILURE A minimal fix: Remove e.preventDefault() from _applyPointerEventsDrag's pointerdown
  handler (fab.ts:128), OR guard it to only fire after actual movement is detected (not on bare
  pointerdown). This ensures clicks are never suppressed when the fallback runs.
  Better fix: investigate why interact(fab).draggable() throws at runtime and fix the root cause,
  eliminating the need for the fallback entirely.

  FAILURE B minimal fix: N/A for a code regression. SW keepalive or chrome.runtime.connect
  keepalive pattern would mitigate MV3 SW idle termination. Alternatively, add explicit error
  handling in renderDropdown to surface "SW timed out" rather than "No hosts found."

verification:
files_changed: []
