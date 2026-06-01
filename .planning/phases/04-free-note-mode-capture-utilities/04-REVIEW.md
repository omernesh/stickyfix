---
phase: 04-free-note-mode-capture-utilities
reviewed: 2026-06-01T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - entrypoints/background.ts
  - entrypoints/review.content/card-state.ts
  - entrypoints/review.content/card.ts
  - entrypoints/review.content/chip.ts
  - entrypoints/review.content/fab.ts
  - entrypoints/review.content/index.ts
  - entrypoints/review.content/toast.ts
  - lib/capture.ts
  - lib/test/capture.test.ts
  - lib/test/card-state.test.ts
  - lib/types.ts
findings:
  critical: 2
  warning: 4
  info: 4
  total: 10
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-06-01
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 04 implements: free-note card (card.ts + card-state.ts), FAB (fab.ts), capture utilities (lib/capture.ts), and wires them into index.ts. Background.ts received the SFX_CAPTURE_TAB handler. Toast, chip, and types were also updated.

The MV3 message-channel invariants (`return true` for async handlers) are correctly implemented throughout background.ts. The security invariant binding tabId to `sender.tab.id` for SFX_CAPTURE_TAB is correctly applied. No `innerHTML` use, no direct localhost fetch from content scripts, no hardcoded secrets.

Two blockers require fixes before ship: a listener-stacking bug in chip.ts that causes duplicate annotations on re-route, and a silent zero-dimension canvas path in capture.ts. Four warnings cover a stale `aria-expanded` state, a redundant disabled-reset, a module-level timer shared across potential multi-mount, and a dirty card-state on re-injection.

---

## Critical Issues

### CR-01: `wireSendButton` uses `addEventListener` — listeners stack on D-09 re-route

**File:** `entrypoints/review.content/chip.ts:356`

**Issue:** `wireSendButton` registers a click handler with `addEventListener` on the Send button. The D-09 re-map flow calls `wireSendButton` a second (and third, etc.) time — once at initial route resolution (line 151), and again after each dropdown selection (line 326). Because `.addEventListener` accumulates listeners, every subsequent click fires N handlers from previous wires. The result: one user click fires two (or more) annotation sends, duplicating notes on disk silently.

The bug path:
1. Chip mounts, route resolves → `wireSendButton` call #1 (line 151)
2. User clicks routed label → `renderDropdown` → user picks again → `wireSendButton` call #2 (line 326)
3. Next Send click fires the handler registered in step 1 AND the handler registered in step 2 → two `chrome.runtime.sendMessage(SEND_ANNOTATION)` calls

This violates REL-01 (no silent duplication) and the single-annotation-per-click contract.

**Fix:** Use `.onclick` assignment (idempotent — same pattern the codebase already applies to `label.onclick` and `dismiss.onclick`) instead of `addEventListener`:

```typescript
// chip.ts — wireSendButton, replace addEventListener with onclick assignment
function wireSendButton(
  sendBtn: HTMLButtonElement,
  feedback: HTMLSpanElement,
  tabId: number,
  _host: HostEntry
): void {
  sendBtn.disabled = false;
  sendBtn.removeAttribute('title');

  // .onclick = assignment (idempotent — prevents stacking on D-09 re-map)
  sendBtn.onclick = () => {
    sendBtn.disabled = true;
    // ... rest of handler unchanged
  };
}
```

---

### CR-02: `cropToRect` in `capture.ts` silently produces a blank PNG when element rect is zero-dimension

**File:** `lib/capture.ts:63`

**Issue:** When `sw` or `sh` is 0 (element fully off-screen, hidden, or collapsed to zero size), `canvas.width = 0` and `canvas.height = 0` are valid; `canvas.toDataURL('image/png')` returns a minimal 1×0 or 0×0 base64 PNG string rather than throwing. The caller receives `{ ok: true, dataUrl: '<blank-png>' }` with no indication that the crop produced nothing, violating the "no silent failure" principle. An annotation would be filed with a useless screenshot attachment.

**Fix:** Guard `sw` and `sh` before drawing:

```typescript
export function cropToRect(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  dpr: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { sx, sy, sw, sh } = computeCropCoords(rect, dpr);
    if (sw <= 0 || sh <= 0) {
      reject(new Error(`Zero-dimension crop rect: ${sw}x${sh} (CSS: ${rect.width}x${rect.height} @ DPR ${dpr})`));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No 2D context')); return; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}
```

Also add a corresponding test case to `lib/test/capture.test.ts` for zero-dimension rejection.

---

## Warnings

### WR-01: FAB `aria-expanded` is set to `'false'` at construction and never updated

**File:** `entrypoints/review.content/fab.ts:34` and `entrypoints/review.content/index.ts:48`

**Issue:** `fab.setAttribute('aria-expanded', 'false')` is set on construction. The `onOpen` callback fires when the card opens, but nothing in `fab.ts` or `index.ts` flips `aria-expanded` to `'true'` when the card is active, or back to `'false'` when the card closes. Screen readers will always report the FAB as "collapsed", which is incorrect when the card is open.

The `onDismiss` callback passed at line 48 of `index.ts` is an empty no-op (`() => {}`), so even the card-close leg has no way to reset the state.

**Fix:** In `fab.ts`, have `mountFab` return a setter, or expose `setExpanded`, or accept an optional `onClose` callback. Simplest fix at the call site in `index.ts`:

```typescript
// index.ts — wire aria-expanded and FAB icon state
const fab = mountFab(container, () => {
  openCard(container, tabId, () => {
    fab.setAttribute('aria-expanded', 'false');
  }, toast);
  fab.setAttribute('aria-expanded', 'true');
});
```

---

### WR-02: `sendBtn.disabled = false` on line 297 of `card.ts` is immediately overridden on line 303

**File:** `entrypoints/review.content/card.ts:297-303`

**Issue:** In the error-recovery path of `_doSend`, line 297 unconditionally sets `sendBtn.disabled = false`, and line 303 then re-evaluates it to `!hasText`. If `textarea.value.trim()` is empty (which it cannot be at Send time due to the Send guard, but it is theoretically possible via programmatic clearing), the button would briefly flash enabled then immediately re-disable. More importantly, line 297 is dead logic — it is always overwritten. This is confusing to future maintainers and suggests a logic error was patched over rather than resolved cleanly.

**Fix:** Remove line 297 (`sendBtn.disabled = false;`) since line 303 is the authoritative re-evaluation:

```typescript
} else {
  // Error: card stays open; restore controls (user can retry)
  showToastFn(resp.error, true);
  sendBtn.textContent = 'Send';
  cancelBtn.disabled = false;
  textarea.readOnly = false;
  // Re-apply disabled rule based on current textarea content
  const hasText = textarea.value.trim().length > 0;
  sendBtn.disabled = !hasText;
}
```

---

### WR-03: Module-level `feedbackTimer` in `chip.ts` is a singleton — unsafe if chip is ever remounted

**File:** `entrypoints/review.content/chip.ts:399`

**Issue:** `feedbackTimer` lives at module scope. If the content script is re-injected (double ENTER_REVIEW on the same tab — possible via race conditions or developer tooling), a second `mountChip` call shares the same timer variable with the first chip's feedback span (which no longer exists in the DOM). A `clearTimeout` from the new chip's `showFeedback` would cancel the old chip's pending fade-out, and the `setTimeout` callback from the old chip's span would call `.style.display = 'none'` and `.textContent = ''` on a detached element — harmless but stale.

More dangerous: if the existing timer fires after the old chip is removed, it holds a closure reference to `feedback` (the old span), preventing GC of the old DOM subtree for the timer duration.

**Fix:** Move `feedbackTimer` inside `mountChip` scope so each chip instance owns its own timer:

```typescript
export function mountChip(container: HTMLElement, unmountFn: () => void): void {
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  // ... rest of mountChip; pass feedbackTimer into showFeedback via closure
```

---

### WR-04: `card-state.ts` module singleton is not reset on content-script re-injection

**File:** `entrypoints/review.content/card-state.ts:11`

**Issue:** The module-level `active` flag is set to `false` only when the module is first evaluated (fresh injection). If the SW injects the content script twice on the same tab without a page navigation (e.g., ENTER_REVIEW fired twice via race or retry), the second injection reuses the existing module cache and `active` may still be `true` from a card that was removed when the first UI was torn down. This causes `tryOpenCard()` to return `'focus-existing'` and attempt to focus `activeCard` (which is `null` in card.ts because `closeCard()` was called during `onRemove`) — a no-op that silently blocks card creation.

**Fix:** Add an explicit reset entry point called from `onRemove` in `index.ts`, or guard `closeCard` in `index.ts`'s `onRemove` to also call `closeCardState()` (it already does via `closeCard()` — but the issue is that re-injection does not re-evaluate the module). Document this invariant: the SW must not inject the CS twice on the same tab without a navigation in between.

---

## Info

### IN-01: `chip.ts` `wireSendButton` sends a hardcoded stub payload in production

**File:** `entrypoints/review.content/chip.ts:362`

**Issue:** The chip's Send button sends `comment: 'stickyfix relay proof'` — a hardcoded stub string — as the annotation content. This was appropriate as a relay proof of concept but is now shipped as the chip's actual send behavior. Users clicking the chip's Send button will file notes with this literal string as the comment body.

**Fix:** Either remove the chip's Send button entirely (the full-featured card in `card.ts` is the correct capture surface), or replace the hardcoded string with a real UI affordance (textarea in chip). At minimum, mark this as a known limitation in the UI.

---

### IN-02: `background.ts` line 482 uses `==` for null-check while codebase uses `===` elsewhere

**File:** `entrypoints/background.ts:482`

**Issue:** `sender.tab?.id == null` uses loose equality. Intentional (catches both `null` and `undefined`), but inconsistent with the rest of the file which uses `===`. The intent should be made explicit with a comment or by using `sender.tab?.id === undefined || sender.tab?.id === null`.

**Fix:**
```typescript
if (sender.tab?.id == null || sender.tab.id !== reqTabId) {
  // == null is intentional: covers both null (no tab) and undefined (non-tab sender)
```

---

### IN-03: `capture.test.ts` missing edge-case: DPR=0 and negative rect dimensions

**File:** `lib/test/capture.test.ts`

**Issue:** Tests cover DPR=1, 1.25, 2. There is no test for `dpr=0` (produces `{sx:0, sy:0, sw:0, sh:0}`) or negative width/height values (would produce negative canvas dimensions). Given that `cropToRect` would need to reject zero-dimension rects (see CR-02), a test case for `computeCropCoords` returning zeros and the expected `cropToRect` rejection would complete the coverage.

**Fix:** Add tests:
```typescript
test('DPR=0 produces zero crop coords', () => {
  const c = computeCropCoords(rect, 0);
  assert.deepStrictEqual(c, { sx: 0, sy: 0, sw: 0, sh: 0 });
});
```

---

### IN-04: `fab.ts` fallback drag (`_applyPointerEventsDrag`) viewport clamping uses `rect.left - startTransX` which can produce incorrect base anchoring after the element has been repositioned

**File:** `entrypoints/review.content/fab.ts:145-148`

**Issue:** `baseLeft = rect.left - startTransX` attempts to compute the element's natural (untranslated) left position. However, `rect` is captured at `pointerdown` time, after any previous drags have applied a transform. `rect.left` is the current translated position; `startTransX` is the current X translate offset. So `baseLeft = currentLeft - currentTranslateX` should equal the original CSS anchor position — this is mathematically correct for `position:fixed` with `right:auto; left:N`. But on the first drag (before left has been set from the initial `right:16px; top:16px` style), `startTransX=0` and `rect.left` is measured from the right edge, meaning `baseLeft` correctly reflects the actual left offset. This is fine, but the logic is non-obvious and fragile; a comment explaining the invariant would prevent future regressions.

**Fix:** Add a comment:
```typescript
// baseLeft/baseTop: natural (untranslated) anchor in fixed-position space.
// rect is measured after transforms, so subtracting the current translate
// recovers the element's anchor before any drag offset.
const baseLeft = rect.left - startTransX;
const baseTop = rect.top - startTransY;
```

---

_Reviewed: 2026-06-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
