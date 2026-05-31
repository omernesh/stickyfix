# Phase 4: Free-Note Mode + Capture Utilities — Pattern Map

**Mapped:** 2026-05-31
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `entrypoints/review.content/fab.ts` | component | event-driven | `entrypoints/review.content/chip.ts` | role-match |
| `entrypoints/review.content/card.ts` | component | request-response | `entrypoints/review.content/chip.ts` (`wireSendButton`) | role-match |
| `entrypoints/review.content/toast.ts` | component | event-driven | `entrypoints/review.content/chip.ts` (`showFeedback`) | role-match |
| `entrypoints/review.content/index.ts` (modify) | mount/orchestrator | event-driven | `entrypoints/review.content/index.ts` | exact |
| `entrypoints/review.content/chip.ts` (modify) | component | request-response | `entrypoints/review.content/chip.ts` | exact |
| `entrypoints/review.content/styles.css` (modify) | config/style | — | `entrypoints/review.content/styles.css` | exact |
| `lib/capture.ts` | utility | request-response + transform | `lib/routing.ts` / `lib/discovery.ts` | role-match (pure fn) |
| `lib/test/capture.test.ts` | test | — | `lib/test/routing.test.ts` | exact |
| `lib/types.ts` (modify) | config/protocol | — | `lib/types.ts` | exact |
| `entrypoints/background.ts` (modify) | service worker / handler | request-response | `entrypoints/background.ts` (`handleSendAnnotation`) | exact |

---

## Architectural Invariants (Surface in Every Plan)

**INVARIANT A — Never import from `background.ts` in content scripts.**
All message-type constants MUST live in `lib/types.ts` (side-effect-free). Importing from `background.ts` drags `chrome.runtime.onStartup.addListener` into the CS bundle where `onStartup` is `undefined` → crash. Documented at `lib/types.ts` lines 69–79.

**INVARIANT B — SW is the sole privileged-API caller.**
Content scripts NEVER call `chrome.tabs.captureVisibleTab` or `fetch 127.0.0.1`. Both relay through the SW via `chrome.runtime.sendMessage`. Same `return true` async-response pattern as all existing router cases (`background.ts` lines 392–456).

**INVARIANT C — DOM via `createElement`/`textContent` only.**
No `innerHTML` with any external string. Enforced unconditionally across `chip.ts`. Apply to `fab.ts`, `card.ts`, `toast.ts`.

**INVARIANT D — `sfx-*`/`stickyfix` namespace only.**
All element IDs, class names, and message-type strings must use the `sfx-` prefix. Clean-room check (`scripts/clean-room-check.mjs`) runs as part of `npm run check`.

**INVARIANT E — `interactjs` is for new surfaces only.**
The chip's working `makeDraggable` (pointer-events, `chip.ts` lines 415–494) is NOT replaced or touched. `interactjs` is introduced only for the FAB and card — D-04 is locked.

---

## Pattern Assignments

---

### `lib/types.ts` — ADD `SFX_CAPTURE_TAB` constant + `MsgCaptureTab` interface

**Analog:** `lib/types.ts` (existing constants block)

**Existing constant pattern** (lines 76–77):
```typescript
export const SFX_SET_ROUTE = 'SFX_SET_ROUTE' as const;
export const SFX_GET_TAB_ID = 'SFX_GET_TAB_ID' as const;
```

**Existing message interface pattern** (lines 83–116):
```typescript
export interface MsgEnterReview {
  type: typeof SFX_MSG.ENTER_REVIEW;
  tabId: number;
  origin: string;
}
// ... etc.
export type SfxMessage =
  | MsgEnterReview
  | MsgExitReview
  | ...;
```

**What to add** — mirror the `SFX_SET_ROUTE`/`SFX_GET_TAB_ID` block immediately after line 77:
```typescript
// Add alongside SFX_SET_ROUTE, SFX_GET_TAB_ID (side-effect-free — see invariant A comment above)
export const SFX_CAPTURE_TAB = 'SFX_CAPTURE_TAB' as const;

export interface MsgCaptureTab {
  type: typeof SFX_CAPTURE_TAB;
  tabId: number;
}
```

Do NOT add `MsgCaptureTab` to the `SfxMessage` union — that union is for messages the standard router switch handles via `SFX_MSG.*`. `SFX_CAPTURE_TAB` is a separate top-level const (same pattern as `SFX_SET_ROUTE`) and its handler is added to the router switch by `case SFX_CAPTURE_TAB:`.

---

### `entrypoints/background.ts` — ADD `handleCaptureTab` + router case

**Analog:** `entrypoints/background.ts`, handler `handleSendAnnotation` (lines 280–354) + router case (lines 435–440)

**Handler pattern** (lines 280–310, condensed to the invariant structure):
```typescript
async function handleSendAnnotation(
  tabId: number,
  payload: AnnotationPayload
): Promise<AnnotationResponse> {
  // 1. Re-read storage (MV3 SW may have been recycled — Pitfall 1)
  const state = await loadStorageState();

  // 2. Derive origin from the tab URL (anti-spoof — T-03-01)
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { ok: false, error: 'Cannot determine tab origin' };
  }
  // ... rest of handler
}
```

**New handler to add** — mirror the same structure:
```typescript
async function handleCaptureTab(
  tabId: number
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.windowId) return { ok: false, error: 'No windowId for tab' };
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } catch (e: unknown) {
    return { ok: false, error: String(e) };
  }
}
```

**Router case pattern** (lines 435–440):
```typescript
case SFX_MSG.SEND_ANNOTATION:
  handleSendAnnotation(msg.tabId, msg.payload)
    .then(sendResponse)
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: String(err) })
    );
  return true;  // MANDATORY — async handler keeps channel open
```

**New router case to add** — identical structure, add after existing cases before `default`:
```typescript
case SFX_CAPTURE_TAB:
  handleCaptureTab((msg as MsgCaptureTab).tabId)
    .then(sendResponse)
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: String(err) })
    );
  return true; // MANDATORY — captureVisibleTab is async
```

Also update the import at line 19 to include `SFX_CAPTURE_TAB` and `MsgCaptureTab`:
```typescript
import { SFX_MSG, SFX_SET_ROUTE, SFX_GET_TAB_ID, SFX_CAPTURE_TAB } from '../lib/types.js';
import type {
  SfxMessage,
  SfxResponse,
  HostEntry,
  AnnotationPayload,
  MsgCaptureTab,    // ADD
} from '../lib/types.js';
```

And update the `onMessage` listener signature union at line 394 to include `MsgCaptureTab`:
```typescript
(
  msg: SfxMessage | MsgSetRoute | MsgGetTabId | MsgCaptureTab,
  ...
)
```

---

### `lib/capture.ts` — NEW pure utility module

**Analog:** `lib/routing.ts` / `lib/discovery.ts` (pure functions, zero chrome API surface, importable by node:test)

**Key constraint:** `captureTab()` calls `chrome.runtime.sendMessage` (browser API), so it cannot be tested under `node:test`. The pure math function `computeCropCoords()` has zero browser dependencies and IS testable. Factor them separately.

**Import pattern** (mirror `lib/routing.ts` style — no side-effect imports, types-only from lib):
```typescript
// lib/capture.ts
// No chrome.* imports at module level — captureTab() uses chrome.runtime inside fn body.
// computeCropCoords() and waitTwoRafs() are pure / browser-built-in only.
import { SFX_CAPTURE_TAB } from './types.js';
```

**`computeCropCoords` — pure, node:test-safe:**
```typescript
export function computeCropCoords(
  rect: { x: number; y: number; width: number; height: number },
  dpr: number
): { sx: number; sy: number; sw: number; sh: number } {
  return {
    sx: Math.round(rect.x * dpr),
    sy: Math.round(rect.y * dpr),
    sw: Math.round(rect.width * dpr),
    sh: Math.round(rect.height * dpr),
  };
}
```
`Math.round` after DPR multiply is mandatory — Windows 125% DPR=1.25 produces fractional pixels without it (PRD §7.3 / RESEARCH.md Pitfall 4).

**`cropToRect` — browser canvas, not node:test-safe:**
```typescript
export function cropToRect(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  dpr: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { sx, sy, sw, sh } = computeCropCoords(rect, dpr);
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

**`waitTwoRafs` — browser rAF, not node:test-safe:**
```typescript
export function waitTwoRafs(): Promise<void> {
  return new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}
```

**`captureTab` — chrome.runtime.sendMessage relay:**
```typescript
export function captureTab(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: SFX_CAPTURE_TAB, tabId },
      (resp: { ok: true; dataUrl: string } | { ok: false; error: string } | undefined) => {
        if (chrome.runtime.lastError || !resp) {
          reject(new Error(chrome.runtime.lastError?.message ?? 'no response'));
          return;
        }
        if (resp.ok) resolve(resp.dataUrl);
        else reject(new Error(resp.error));
      }
    );
  });
}
```

Mirror the `getTabId()` pattern from `chip.ts` lines 505–520 — same Promise wrapping, same `chrome.runtime.lastError` guard, same `sendMessage` callback shape.

---

### `lib/test/capture.test.ts` — NEW unit test for `computeCropCoords`

**Analog:** `lib/test/routing.test.ts` (exact match — same framework, same file structure)

**File header pattern** (lines 1–17 of `routing.test.ts`):
```typescript
/**
 * node:test unit tests for lib/capture.ts
 *
 * Covers DPR=1/1.25/2 math for computeCropCoords (Success Criterion 4).
 * Zero chrome API surface — runs with plain node:test.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeCropCoords } from '../capture.js';   // .js extension — ESM node resolution
```

**Test pattern** (mirror `describe` + `test` shape from `routing.test.ts` lines 48–120):
```typescript
const rect = { x: 10, y: 20, width: 100, height: 50 };

describe('computeCropCoords', () => {
  test('DPR=1 identity — no rounding needed', () => {
    const c = computeCropCoords(rect, 1);
    assert.deepStrictEqual(c, { sx: 10, sy: 20, sw: 100, sh: 50 });
  });

  test('DPR=1.25 (Windows 125% fractional DPR) — Math.round required', () => {
    const c = computeCropCoords(rect, 1.25);
    assert.deepStrictEqual(c, {
      sx: Math.round(10 * 1.25),   // 13 (raw: 12.5)
      sy: Math.round(20 * 1.25),   // 25
      sw: Math.round(100 * 1.25),  // 125
      sh: Math.round(50 * 1.25),   // 63 (raw: 62.5)
    });
  });

  test('DPR=2 (HiDPI) — exact doubles', () => {
    const c = computeCropCoords(rect, 2);
    assert.deepStrictEqual(c, { sx: 20, sy: 40, sw: 200, sh: 100 });
  });
});
```

**package.json `test:lib` script update** — add the compiled capture test to the node --test invocation:
```
"test:lib": "tsc -p tsconfig.lib.json && node --test dist/lib/lib/test/routing.test.js dist/lib/lib/test/discovery.test.js dist/lib/lib/test/capture.test.js"
```

Note: the double `lib/lib/` in the compiled path is the existing convention visible in the current `test:lib` script — mirror it exactly.

---

### `entrypoints/review.content/fab.ts` — NEW FAB component

**Analog:** `entrypoints/review.content/chip.ts` — `mountChip` function (lines 85–192) for DOM structure; `makeDraggable` (lines 415–494) for drag pattern reference (but FAB uses `interactjs`, not pointer-events).

**Module export pattern** (mirror `chip.ts` — exported factory function, no class):
```typescript
// fab.ts
import interact from 'interactjs';

/**
 * Render the + FAB and wire interactjs drag.
 * Returns the fab element so card.ts/index.ts can reference it.
 *
 * @param container  The shadow-root container from createShadowRootUi onMount
 * @param onOpen     Called when FAB is clicked and no active card exists
 */
export function mountFab(
  container: HTMLElement,
  onOpen: () => void
): HTMLButtonElement {
  const fab = document.createElement('button');
  fab.id = 'sfx-fab';
  fab.setAttribute('aria-label', 'Add note');
  fab.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('span');
  icon.className = 'sfx-fab-icon';
  icon.textContent = '+';
  fab.appendChild(icon);

  container.appendChild(fab);

  fab.addEventListener('click', onOpen);

  // interactjs drag — direct element ref (NOT CSS selector — RESEARCH.md Pitfall 2)
  let x = 0;
  let y = 0;
  interact(fab).draggable({
    listeners: {
      start(event: Interact.DragEvent) {
        const style = window.getComputedStyle(event.target as HTMLElement);
        const matrix = new DOMMatrixReadOnly(style.transform);
        x = matrix.m41;
        y = matrix.m42;
      },
      move(event: Interact.DragEvent) {
        x += event.dx;
        y += event.dy;
        (event.target as HTMLElement).style.transform = `translate(${x}px, ${y}px)`;
      },
    },
    modifiers: [
      interact.modifiers.restrictRect({ restriction: 'window', endOnly: false }),
    ],
  });

  return fab;
}
```

**DOM pattern:** `document.createElement` only, `textContent` for text (INVARIANT C). `sfx-fab`, `sfx-fab-icon` CSS class names (INVARIANT D).

**interactjs spike note:** Per RESEARCH.md Assumption A2/A3, the first task in Wave 1 must confirm `interact(el)` + `restrictRect({restriction:'window'})` works inside the WXT open shadow root. Fallback to `makeDraggable` pointer-events pattern from `chip.ts` lines 415–494 if the modifier fails.

---

### `entrypoints/review.content/card.ts` — NEW post-it card component

**Analog:** `entrypoints/review.content/chip.ts` — `wireSendButton` (lines 327–373) for the Send relay pattern; `renderDropdown` (lines 223–316) for the single-active guard; `showFeedback` for the inline feedback predecessor.

**Module-level active-card guard** (no equivalent in chip.ts — new pattern):
```typescript
// card.ts — single-active-card enforcement (D-02)
let activeCard: HTMLElement | null = null;
```

**`openCard` export — mirror `mountChip` structure:**
```typescript
export function openCard(
  container: HTMLElement,
  tabId: number,
  onDismiss: () => void,         // called on Cancel or after Send success
  showToast: (msg: string, isError: boolean) => void
): void {
  if (activeCard) {
    // D-02: focus existing card textarea — do NOT spawn a second
    (activeCard.querySelector('#sfx-card-textarea') as HTMLTextAreaElement | null)?.focus();
    return;
  }
  // ... build DOM via createElement/textContent only (INVARIANT C)
  // ... wire interactjs drag on header (INVARIANT E — chip's makeDraggable untouched)
  // ... wire Send button per wireSendButton pattern
  activeCard = card;
}

export function closeCard(): void {
  activeCard?.remove();
  activeCard = null;
}
```

**Send relay pattern** — copy exactly from `chip.ts` lines 336–373 (`wireSendButton`), replacing the stub comment with real `textarea.value.trim()`:
```typescript
// From chip.ts wireSendButton — lines 336-373 (the relay proof this phase makes real)
sendBtn.addEventListener('click', () => {
  sendBtn.disabled = true;

  const payload: AnnotationPayload = {
    mode: 'free',
    comment: textarea.value.trim(),    // REAL comment — replaces 'stickyfix relay proof'
    page: { url: window.location.href, title: document.title },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    screenshots: [],    // D-06: ALWAYS empty for free notes — never add capture here
  };

  chrome.runtime.sendMessage(
    { type: SFX_MSG.SEND_ANNOTATION, tabId, payload },
    (resp: AnnotationResponse | undefined) => {
      sendBtn.disabled = false;
      if (chrome.runtime.lastError || !resp) {
        showToast('Extension error: ' + (chrome.runtime.lastError?.message ?? 'no response'), true);
        return;
      }
      if (resp.ok) {
        showToast(`wrote notes\\${resp.file}`, false);   // resp.file from host — never reconstruct
        closeCard();
        onDismiss();
      } else {
        showToast(resp.error, true);
        // Error: card stays open (Send + Cancel re-enabled)
      }
    }
  );
});
```

**`lastError` guard pattern** (chip.ts line 360): `chrome.runtime.lastError || !resp` — always check both.

**D-06 enforcement:** `screenshots: []` is a comment-annotated constant, never conditionally populated in this file. The capture trio is in `lib/capture.ts` and never imported by `card.ts`.

---

### `entrypoints/review.content/toast.ts` — NEW toast surface

**Analog:** `entrypoints/review.content/chip.ts` — `showFeedback` (lines 385–404) for the auto-dismiss timer pattern. Toast is a promoted, richer version.

**`showFeedback` predecessor** (lines 385–404 — the pattern to extend):
```typescript
function showFeedback(feedback: HTMLSpanElement, msg: string, isError: boolean): void {
  if (feedbackTimer !== null) {
    clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }
  feedback.textContent = msg;     // textContent only (INVARIANT C)
  feedback.className = isError ? 'sfx-chip-feedback sfx-feedback-error' : 'sfx-chip-feedback';
  feedback.style.display = '';
  if (!isError) {
    feedbackTimer = setTimeout(() => {
      feedback.style.display = 'none';
      feedback.textContent = '';
      feedbackTimer = null;
    }, 1500);
  }
}
```

**New `showToast` export** — same timer + textContent pattern, promoted to independent DOM element:
```typescript
// toast.ts
export function showToast(container: HTMLElement, msg: string, isError: boolean): void {
  // Build: stripe + body(icon + msg span) + optional dismiss button
  // ALL via createElement/textContent — no innerHTML (INVARIANT C)
  const toast = document.createElement('div');
  toast.className = isError ? 'sfx-toast sfx-toast-error' : 'sfx-toast';
  toast.setAttribute('role', isError ? 'alert' : 'status');
  toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');

  const stripe = document.createElement('div');
  stripe.className = 'sfx-toast-stripe';
  toast.appendChild(stripe);

  const body = document.createElement('div');
  body.className = 'sfx-toast-body';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'sfx-toast-icon';
  iconSpan.textContent = isError ? '✕' : '✓';
  body.appendChild(iconSpan);

  const msgSpan = document.createElement('span');
  msgSpan.className = 'sfx-toast-msg';
  msgSpan.textContent = msg.slice(0, 200);   // truncate; textContent — never innerHTML
  body.appendChild(msgSpan);
  toast.appendChild(body);

  if (isError) {
    const dismiss = document.createElement('button');
    dismiss.className = 'sfx-toast-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss error');
    dismiss.textContent = '×';
    dismiss.onclick = () => toast.remove();   // .onclick = (not addEventListener — idempotent)
    toast.appendChild(dismiss);
  }

  container.appendChild(toast);

  if (!isError) {
    // Mirror showFeedback auto-dismiss (chip.ts line 396)
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);   // after CSS opacity transition
    }, 3000);
  }
}
```

**Key difference from `showFeedback`:** Toast is an independent DOM element appended to `container` (not a pre-existing span toggled with `display:none`). Error toasts persist until the dismiss button is clicked — they are NOT auto-dismissed by a second toast arrival (UI-SPEC §3).

---

### `entrypoints/review.content/index.ts` — MODIFY (add FAB/card/toast into onMount)

**Analog:** `entrypoints/review.content/index.ts` (exact — extend the existing `onMount`/`onRemove` pattern)

**Existing `onMount` pattern** (lines 31–43):
```typescript
onMount(container: HTMLElement) {
  mountChip(container, () => ui.remove());
  return { container };
},

onRemove(elements: { container: HTMLElement } | undefined) {
  if (elements?.container) {
    teardownChip(elements.container);
  }
},
```

**Extension pattern** — add FAB/card/toast into the SAME `container` (D-01/D-08):
```typescript
import { mountChip, teardownChip } from './chip.js';
import { mountFab } from './fab.js';
import { openCard, closeCard } from './card.js';
import { showToast } from './toast.js';
// ...
onMount(container: HTMLElement) {
  mountChip(container, () => ui.remove());

  // Shared toast: card.ts calls this; signature: (msg, isError) => void
  const toast = (msg: string, isError: boolean) => showToast(container, msg, isError);

  // FAB — opens card; card calls toast on Send result
  mountFab(container, () => {
    openCard(container, /* tabId from chip's getTabId() — see coordination note */, () => {}, toast);
  });

  return { container };
},
```

**tabId coordination:** `getTabId()` is currently private to `chip.ts`. Either export it from `chip.ts`, or `index.ts` calls it once and passes `tabId` into `mountFab`/`openCard`. The chip's existing `getTabId` (lines 505–520) is the canonical implementation — do not duplicate.

---

### `entrypoints/review.content/chip.ts` — MODIFY (re-map affordance D-09)

**Analog:** `entrypoints/review.content/chip.ts` — `renderRoutedLabel` (lines 208–216) is where the re-map `.onclick` is added.

**Existing `renderRoutedLabel`** (lines 208–216):
```typescript
function renderRoutedLabel(
  label: HTMLSpanElement,
  dot: HTMLSpanElement,
  host: HostEntry
): void {
  label.textContent = `→ ${host.name} · ${host.notesDir}`;
  dot.classList.remove('sfx-dot-error');
}
```

**Add re-map `.onclick` here** (D-09 — assignment not addEventListener to prevent stacking):
```typescript
function renderRoutedLabel(
  label: HTMLSpanElement,
  dot: HTMLSpanElement,
  host: HostEntry,
  // Pass through for re-map dropdown re-open:
  chip: HTMLDivElement,
  feedback: HTMLSpanElement,
  sendBtn: HTMLButtonElement,
  tabId: number,
  origin: string
): void {
  label.textContent = `→ ${host.name} · ${host.notesDir}`;
  dot.classList.remove('sfx-dot-error');

  // D-09: re-map affordance — .onclick = (not addEventListener) prevents stacking
  label.onclick = () => {
    renderDropdown(chip, label, dot, feedback, sendBtn, tabId, origin);
  };
  // UI-SPEC §4: cursor + tooltip signal clickability
  label.style.cursor = 'pointer';
  label.title = 'Change project';
}
```

All call sites of `renderRoutedLabel` within `chip.ts` (lines 150 and 305) must be updated to pass the additional parameters.

---

### `entrypoints/review.content/styles.css` — MODIFY (add FAB/card/toast CSS)

**Analog:** `entrypoints/review.content/styles.css` (exact — extend the same file)

**Established CSS invariants** (lines 1–25 of styles.css):
```css
:host {
  all: initial;           /* zero inheritance from host page */
  display: block;
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;   /* host page not blocked except at interactive elements */
  z-index: 2147483647;
  box-sizing: border-box;
}
```

**Button pattern** (lines 99–127):
```css
.sfx-chip-btn {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 12px;
  padding: 3px 8px;
  border: 1px solid #cccccc;
  border-radius: 4px;
  background: #f0f0f0;
  color: #111111;
  cursor: pointer;
  line-height: 1;
}
```

**New CSS rules to append** — mirror the established conventions:
- `px` units only (no `rem`)
- `pointer-events: auto` on every interactive element (`:host` has `pointer-events:none`)
- `position: fixed` for viewport-anchored surfaces
- neutral palette matching chip (`#ffffff` bg, `#cccccc` border, `#111111` text)
- `system-ui, -apple-system, sans-serif` font

Sections to add: `#sfx-fab`, `#sfx-card` + children (`.sfx-card-header`, `.sfx-card-body`, `.sfx-card-footer`, `#sfx-card-textarea`, `#sfx-card-send`, `#sfx-card-cancel`), `.sfx-toast` + children, `.sfx-chip-label` re-map cursor/tooltip states.

---

## Shared Patterns

### 1. `chrome.runtime.sendMessage` Callback Pattern
**Source:** `chip.ts` lines 355–373 (`wireSendButton`), lines 136–163 (route resolve)
**Apply to:** `card.ts` (Send), `lib/capture.ts` (`captureTab`)
```typescript
chrome.runtime.sendMessage(
  { type: SFX_MSG.SEND_ANNOTATION, tabId, payload },
  (resp: AnnotationResponse | undefined) => {
    // WR-02: ALWAYS guard both lastError AND resp
    if (chrome.runtime.lastError || !resp) {
      // surface error — never silent (REL-01)
      return;
    }
    if (resp.ok) { /* success path */ }
    else { /* error path — show toast */ }
  }
);
```

### 2. SW Message Router `return true` Pattern
**Source:** `background.ts` lines 392–456 (entire router)
**Apply to:** new `case SFX_CAPTURE_TAB:` in `background.ts`
```typescript
case SFX_MSG.SEND_ANNOTATION:        // pattern to copy
  handleSendAnnotation(msg.tabId, msg.payload)
    .then(sendResponse)
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: String(err) })
    );
  return true; // MANDATORY for every async handler
```

### 3. DOM Construction (XSS-safe)
**Source:** `chip.ts` throughout (`mountChip` lines 87–124, `renderDropdown` lines 237–279)
**Apply to:** `fab.ts`, `card.ts`, `toast.ts`
```typescript
// CORRECT — textContent only
const el = document.createElement('span');
el.textContent = hostDerivedString;     // safe
el.className = 'sfx-some-class';       // safe — controlled string

// WRONG — never do this with external strings
el.innerHTML = hostDerivedString;      // XSS hazard — forbidden
```

### 4. `.onclick` Assignment (Idempotent)
**Source:** D-09 requirement, referenced in `renderDropdown` change handler (`chip.ts` line 283 uses `addEventListener` — the re-map uses `.onclick` INSTEAD)
**Apply to:** `chip.ts` re-map label; `toast.ts` dismiss button
```typescript
// CORRECT (idempotent — last write wins; safe across re-renders)
label.onclick = () => renderDropdown(...);

// WRONG (stacks on re-render — avoid for elements that may be re-wired)
label.addEventListener('click', () => renderDropdown(...));
```

### 5. Storage Re-Read at Handler Top
**Source:** `background.ts` lines 71, 99, 113, 156, 180, 242, 285 (every handler)
**Apply to:** `handleCaptureTab` in `background.ts`
```typescript
// Pattern: MV3 SW is ephemeral — module globals are zeroed after ~30s idle.
// Re-read chrome.storage.local at the top of every handler.
const state = await loadStorageState();
```
Note: `handleCaptureTab` does NOT need storage state (it only needs `tabId` → `windowId`), but it MUST still use `chrome.tabs.get(tabId)` to derive `windowId` — never trust `windowId` from the message body.

---

## Drag Pattern Divergence (Flag for Planner)

The chip uses hand-rolled pointer-events drag (`makeDraggable` in `chip.ts` lines 415–494). Phase 4 introduces `interactjs` for the FAB and card. These are two different drag implementations coexisting intentionally (D-04).

| Surface | Drag Impl | Location | Status |
|---------|-----------|----------|--------|
| Connection chip (`#sfx-chip`) | Pointer-events `makeDraggable` | `chip.ts` lines 415–494 | Proven — DO NOT TOUCH |
| FAB (`#sfx-fab`) | `interactjs@1.10.27` | `fab.ts` (new) | New — spike required |
| Post-it card (`#sfx-card`) | `interactjs@1.10.27` (header-only) | `card.ts` (new) | New — spike required |

The spike task (confirm `interact(el)` + `restrictRect({restriction:'window'})` in WXT open shadow root) must be the first task in Wave 1 per RESEARCH.md Assumption A2. If the spike fails, fallback is the `makeDraggable` pointer-events pattern from `chip.ts`.

---

## No Analog Found

All Phase 4 files have close analogs in the codebase. No files require falling back to RESEARCH.md patterns as the sole reference.

---

## Metadata

**Analog search scope:** `entrypoints/review.content/`, `entrypoints/background.ts`, `lib/`, `lib/test/`, `host/src/types.ts`
**Files read:** 10 source files
**Pattern extraction date:** 2026-05-31
