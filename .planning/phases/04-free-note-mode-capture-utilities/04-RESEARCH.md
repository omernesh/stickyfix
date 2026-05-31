# Phase 4: Free-Note Mode + Capture Utilities - Research

**Researched:** 2026-05-31
**Domain:** Chrome MV3 content-script UI (WXT shadow root), interactjs drag, captureVisibleTab relay, DPR-correct canvas crop, toast surface
**Confidence:** HIGH (codebase verified; interactjs shadow-DOM behavior LOW — see Assumptions Log)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** FAB lives inside the same `createShadowRootUi` review mount — one mount hosts chip + FAB + card + toast.
- **D-02:** Single active post-it card; opening when one exists focuses/reuses it (PRD §6.5).
- **D-03:** Functional-minimal styling this phase (`px` units, clean, smooth drag). Warm-paper aesthetic deferred to Phase 6.
- **D-04:** `interactjs@1.10.27` introduced for FAB and post-it card drag only. Chip keeps its proven pointer-events `makeDraggable`. No retrofit.
- **D-05:** Build three standalone utilities: (a) `SFX_CAPTURE_TAB` SW relay, (b) double-rAF flush helper, (c) DPR-correct canvas crop — all unit-tested.
- **D-06 (CRITICAL):** Free-note payload = `screenshots: []`. No auto screenshot on Send. Capture trio is built and proven standalone; NOT wired into free-note Send.
- **D-07:** Toast surface: success auto-dismiss ~3s (shows filename from host response); error persists until dismissed.
- **D-08:** One `createShadowRootUi` mount. Free-note Send reuses existing `SFX_SEND_ANNOTATION` relay. No new HTTP transport.
- **D-09:** Re-map affordance: chip's routed label `.onclick =` opens `renderDropdown`. Use assignment (not `addEventListener`) to prevent listener stacking.

### Claude's Discretion

- Exact name for capture message type (`SFX_CAPTURE_TAB` suggested).
- FAB/card DOM structure and placement offsets.
- Toast element markup and stacking behavior.
- interactjs configuration specifics (restrict/modifiers vs manual clamp).
- How capture utilities are factored into pure-testable units.

### Deferred Ideas (OUT OF SCOPE)

- Warm post-it aesthetics + animations + mode color-coding (Phase 6).
- Element capture / picker (Phase 5).
- Region marquee capture (Phase 6).
- Exhaustive toast coverage (Phase 8).
- Screenshots on free notes (permanently out of FREE scope).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FREE-01 | Draggable `+` FAB opens a single post-it note card (textarea + Send/Cancel) | D-01/D-04: interactjs on FAB element reference; shadow-root open mode; pointer events composed |
| FREE-02 | Post-it card is draggable; only one active card at a time | D-02/D-04: interactjs on card element; single-card state enforced by module-level guard |
| FREE-03 | Send captures url/title/timestamp/viewport and POSTs; writes `notes/0001-<ts>.md` | D-06/D-08: reuses `SFX_SEND_ANNOTATION` with real mode:'free' payload; host returns `{ok,file,serial}` |
| FREE-04 | Toast confirms written filename on success | D-07: toast reads `resp.file` from `SFX_SEND_ANNOTATION` response |
| REL-01 (partial) | Failed Send surfaces visible toast — never silent drop | D-07: error toast persists; covers success + host-down paths this phase |
| capture-trio | DPR crop at DPR=1/1.25/2; double-rAF flush; captureVisibleTab SW relay | D-05: pure functions in `lib/capture.ts`; SW handler in `background.ts`; `SFX_CAPTURE_TAB` in `lib/types.ts` |
| D-09 re-map | "Change project" affordance on chip label | Reuses `renderDropdown` + `SFX_SET_ROUTE`; `.onclick =` assignment |
</phase_requirements>

---

## Summary

Phase 4 delivers the first end-to-end note: FAB → post-it → Send → `.md` on disk → toast. It also builds the DPR-correct capture utility trio as standalone reusables (consumed in Phases 5 and 6), proven via one integration test.

**The single most important constraint (D-06):** free notes are TEXT-ONLY. The capture trio is built and unit-tested this phase, but the `screenshots` field on free-note payloads is always `[]`. This separation keeps Phase 4 scope tight while de-risking the hardest pixel-fidelity path early.

All heavy lifting reuses proven Phase 3 infrastructure: the `createShadowRootUi` mount, the `SFX_SEND_ANNOTATION` relay (already proven end-to-end with a real host POST), the SW message router (`return true` async pattern), and `lib/types.ts` as the side-effect-free protocol module. New work is additive: FAB + card + toast DOM in the existing container, `interactjs` for drag, `SFX_CAPTURE_TAB` handler in the SW, and three pure utilities in `lib/capture.ts`.

**Primary recommendation:** Implement in two parallel streams — (A) FAB/card/toast/Send/re-map UI work in `review.content/`, (B) capture utilities in `lib/capture.ts` + SW handler — then integrate via a single integration test that proves the `SFX_CAPTURE_TAB` round-trip. Unit tests for the crop math run under `node:test` with no Chrome API.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| FAB + post-it card DOM | Content Script (shadow root) | — | UI lives inside `createShadowRootUi`; no server involvement |
| Drag (FAB + card) | Content Script (interactjs) | — | interactjs attaches to element references directly; pointer events are composed |
| Free-note payload build | Content Script | — | page context provides url/title/viewport; timestamps assigned by host |
| Send relay | Service Worker | Content Script triggers | SW is sole HTTP client (EXT-05); content script sends `SFX_SEND_ANNOTATION` |
| Toast render | Content Script (shadow root) | — | reads `resp.file` from `SFX_SEND_ANNOTATION` response |
| `captureVisibleTab` call | Service Worker | — | SW has `activeTab`/`tabs` perms; content script cannot call this API |
| Double-rAF flush | Content Script (helper fn) | — | `requestAnimationFrame` is a browser API available in content script context |
| DPR canvas crop | Content Script (pure fn) | — | pure function; tested under `node:test` with DPR=1/1.25/2 (no Chrome API needed for math) |
| Re-map affordance | Content Script (chip) | SW (`SFX_SET_ROUTE`) | same flow as Phase 3 one-time dropdown |

---

## Standard Stack

### Core (no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `interactjs` | 1.10.27 | FAB + card drag with viewport clamping | Chosen in CLAUDE.md; only mainstream drag lib with built-in modifiers; MIT; TS typings at `index.d.ts` |
| WXT / `createShadowRootUi` | 0.20.26 | Shadow-root UI mount (already exists) | Reuse existing mount from Phase 3 |
| `node:test` | Node 20 built-in | Unit tests for pure capture utilities | Already used in `host/test/` and `lib/test/`; zero new deps |
| `chrome.tabs.captureVisibleTab` | Chrome MV3 API | Full-viewport PNG capture | Real pixels; native; SW-only |

**interactjs is NOT yet in package.json** — must be added as a dependency. [VERIFIED: npm registry — `npm view interactjs version` returned `1.10.27`]

### Installation

```bash
npm install interactjs@1.10.27
```

No other new runtime dependencies. Host-side: no changes. `node:test` is a Node 20 built-in.

### Version Verification

```
interactjs: npm view interactjs version → 1.10.27 (verified 2026-05-31) [VERIFIED: npm registry]
```

---

## Package Legitimacy Audit

| Package | Registry | Age | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|
| `interactjs` | npm | ~9 years | N/A (established lib, listed in CLAUDE.md) | Approved — specified in project CLAUDE.md stack table |

**Packages removed:** none.
**Packages flagged:** none.

Note: slopcheck was not run because `interactjs` is explicitly specified in `CLAUDE.md` as the approved drag library — this is a project-level locked decision, not a new package discovery.

---

## Architecture Patterns

### System Architecture Diagram

```
[User clicks FAB in shadow root]
         |
         v
[post-it card opens (single-active-card guard)]
         |
         v
[User types comment, clicks Send]
         |
         v
[content script: build mode:'free' payload
  { mode:'free', comment, page, viewport, screenshots:[] }]
         |
         v  chrome.runtime.sendMessage(SFX_SEND_ANNOTATION)
[Service Worker: handleSendAnnotation]
  → resolves route (origin → host)
  → attaches token
  → POST http://127.0.0.1:<port>/annotation
         |
         v
[Host writes 0001-<ts>.md]
  → returns { ok:true, file:'0001-<ts>.md', serial:'0001' }
         |
         v
[content script: toast success (shows resp.file, auto-dismiss 3s)]
  or toast error (persists, shows reason)

━━━ Capture Trio (standalone, no free-note wiring) ━━━

[lib/capture.ts]
  captureTab():
    content script → SFX_CAPTURE_TAB → SW
    SW: chrome.tabs.captureVisibleTab(windowId, {format:'png'})
    → dataURL returned to content script

  waitTwoRafs(): Promise<void>
    → new Promise(resolve => requestAnimationFrame(() =>
         requestAnimationFrame(resolve)))

  cropToRect(dataUrl, rect, dpr): Promise<string>
    → pure canvas drawImage math
    → sx = Math.round(rect.x * dpr)
    → sy = Math.round(rect.y * dpr)
    → sw = Math.round(rect.width * dpr)
    → sh = Math.round(rect.height * dpr)
    → canvas(sw, sh).drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    → canvas.toDataURL('image/png')
```

### Recommended Project Structure

```
entrypoints/
  review.content/
    index.ts          # existing — add FAB/card/toast into onMount container
    chip.ts           # existing — add re-map (.onclick) affordance (D-09)
    fab.ts            # NEW: renderFab(), interactjs drag setup
    card.ts           # NEW: renderCard(), single-active-card guard, Send wiring
    toast.ts          # NEW: showToast(msg, isError), auto-dismiss, placement
    styles.css        # existing — add FAB/card/toast CSS rules
lib/
  capture.ts          # NEW: captureTab(), waitTwoRafs(), cropToRect() — pure fns
  types.ts            # ADD: SFX_CAPTURE_TAB constant + MsgCaptureTab interface
entrypoints/
  background.ts       # ADD: SFX_CAPTURE_TAB handler (handleCaptureTab)
lib/test/
  capture.test.ts     # NEW: node:test unit tests for cropToRect at DPR=1/1.25/2
```

### Pattern 1: interactjs Drag Inside Shadow Root (open mode)

**What:** WXT's `createShadowRootUi` produces an **open** shadow root. Pointer events (`pointerdown`, `pointermove`, `pointerup`) are `composed: true` — they cross shadow boundaries and bubble to `document`. interactjs attaches its internal listeners to `document` by default and uses `event.composedPath()` / `event.target` retargeting to locate the interactive element. When you pass a **direct element reference** (not a CSS selector string) to `interact(el)`, interactjs does not need to query-select within any context — it binds directly to the DOM node.

**When to use:** Pass the element reference directly. No `context` option needed when the element is already in hand (the `context` option is only relevant for CSS-selector-based delegation where interactjs needs to know which document to query).

**Viewport clamping:** Use `interact.modifiers.restrictRect` with `restriction: 'window'` — this restricts to `window` bounds automatically. No need for manual `Math.max/min` clamp as in `makeDraggable`.

**Example:**
```typescript
// Source: interactjs docs — https://interactjs.io/docs/restriction/ [ASSUMED]
// Pattern confirmed from interactjs 1.10.27 API shape [VERIFIED: npm registry]
import interact from 'interactjs';

export function makeDraggableInteract(el: HTMLElement): void {
  // Element starts at fixed position (set via CSS or inline style before this call)
  let x = 0;
  let y = 0;

  interact(el)   // direct element ref — no context option needed
    .draggable({
      listeners: {
        start(event: Interact.DragEvent) {
          // Read current CSS transform offset on first drag
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
        interact.modifiers.restrictRect({
          restriction: 'window',  // clamp to viewport
          endOnly: false,
        }),
      ],
    });
}
```

**Alternative if restrict modifier has issues in shadow root:** Fall back to manual clamp in the `move` listener — same pattern as the chip's `makeDraggable`. Budget one spike task to confirm `restrictRect` works before committing.

**Key insight:** The FAB and post-it card need `position: fixed` so viewport clamping makes sense. The card starts at a fixed offset from the FAB's last position (or a screen-center default).

### Pattern 2: `SFX_CAPTURE_TAB` — captureVisibleTab SW Relay

**What:** Content script cannot call `chrome.tabs.captureVisibleTab` — it is a SW/background-only API. The relay pattern mirrors Phase 3's `SFX_SEND_ANNOTATION`.

**Message type:** Add `SFX_CAPTURE_TAB = 'SFX_CAPTURE_TAB'` to `lib/types.ts` (side-effect-free module, NOT in `background.ts`).

**SW handler:**
```typescript
// In background.ts — handleCaptureTab
// Source: Chrome Extensions docs — chrome.tabs.captureVisibleTab [VERIFIED: MDN/Chrome docs]
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

**Permissions:** `chrome.tabs.captureVisibleTab` requires `tabs` permission (already in manifest from Phase 3 EXT-01) plus the tab's origin in `host_permissions`. The SW already has `host_permissions: ["<all_urls>"]` optional — but `captureVisibleTab` only requires `tabs` + `activeTab`. [VERIFIED: Chrome docs — `captureVisibleTab` needs either `<all_urls>` host permission or `activeTab` for the active tab]

**Important:** `captureVisibleTab` captures the VISIBLE VIEWPORT only (no scrolling). Returns a full-viewport PNG at device pixel resolution (DPR-multiplied dimensions).

### Pattern 3: Double-rAF Flush

**What:** After hiding the shadow-root UI (e.g. `shadowHost.style.visibility = 'hidden'`), two `requestAnimationFrame` calls ensure the browser has committed a paint cycle with the UI hidden before capture occurs.

**Why two:** One rAF schedules a paint; the second ensures the previous frame has been composited. One rAF is insufficient in Chrome's rendering pipeline for guaranteed pixel flush. [ASSUMED — well-known rendering pipeline convention; not found in Chrome official docs]

```typescript
// lib/capture.ts
export function waitTwoRafs(): Promise<void> {
  return new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}
```

**Usage pattern (Phases 5/6 consumers):**
```typescript
// hide own UI
shadowHost.style.visibility = 'hidden';
await waitTwoRafs();
const result = await captureTab(tabId);
// restore UI
shadowHost.style.visibility = '';
```

**Note for Phase 4:** `waitTwoRafs` is built and tested here but NOT called in free-note Send (D-06). The integration test will exercise it standalone.

### Pattern 4: DPR-Correct Canvas Crop

**What:** Given a CSS-pixel rect and the full-viewport PNG from `captureVisibleTab` (at device pixel resolution), crop via canvas `drawImage`.

**Critical detail:** `Math.round` after multiplying by DPR is mandatory. Windows at 125% DPR = 1.25. Without rounding, `rect.x * 1.25` can produce fractional pixel offsets that cause sub-pixel misalignment in the crop.

```typescript
// lib/capture.ts — pure function, no Chrome API dependency
// Source: PRD §7.3 spec [VERIFIED: PRD.md read]
export function cropToRect(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  dpr: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sx = Math.round(rect.x * dpr);
      const sy = Math.round(rect.y * dpr);
      const sw = Math.round(rect.width * dpr);
      const sh = Math.round(rect.height * dpr);

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

**Unit-testability:** For `node:test` unit tests (no browser), test the MATH only — verify `Math.round(rect.x * dpr)` etc. at DPR=1, 1.25, 2 without needing a real canvas. Extract the coordinate calculation as a pure helper:

```typescript
// Testable under node:test (no DOM needed)
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

Tests assert exact integer pixel coords at DPR=1 (identity), DPR=1.25 (Windows fractional), DPR=2 (HiDPI).

### Pattern 5: Free-Note Payload

**What:** The free-note Send builds a `mode:'free'` `AnnotationPayload` from the page context. No element context. No screenshots.

```typescript
// Matches host/src/types.ts AnnotationPayload exactly [VERIFIED: codebase read]
const payload: AnnotationPayload = {
  mode: 'free',
  comment: textarea.value.trim(),
  page: {
    url: window.location.href,
    title: document.title,
  },
  viewport: {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  },
  screenshots: [],  // D-06: always empty for free notes
};
```

The host returns `{ ok: true, file: '0001-20260531-143022.md', serial: '0001' }`. The toast reads `resp.file` verbatim — do NOT reconstruct the filename client-side. The host owns serial assignment.

### Pattern 6: Toast Surface

**What:** A fixed-position toast div in the shadow root container. Two states: success (green, auto-dismiss) and error (red, persists).

```typescript
// toast.ts — shadow-root toast (no innerHTML with external strings)
export function showToast(container: HTMLElement, msg: string, isError: boolean): void {
  // Remove any existing non-error toast; keep errors until dismissed
  const existing = container.querySelector('.sfx-toast') as HTMLElement | null;
  if (existing && !existing.classList.contains('sfx-toast-error')) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.className = isError ? 'sfx-toast sfx-toast-error' : 'sfx-toast';
  toast.textContent = msg;          // textContent only — no innerHTML (XSS pattern)
  toast.setAttribute('role', 'status');
  container.appendChild(toast);

  if (!isError) {
    setTimeout(() => toast.remove(), 3000);
  } else {
    // Error toast: dismiss button
    const dismiss = document.createElement('button');
    dismiss.className = 'sfx-toast-dismiss';
    dismiss.textContent = '×';
    dismiss.onclick = () => toast.remove();
    toast.appendChild(dismiss);
  }
}
```

Placement: bottom-center of the viewport (`position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%)`). Z-index within shadow root — inherits from `:host` (`2147483647`).

### Pattern 7: Single-Active-Card Enforcement

**What:** Module-level `let activeCard: HTMLElement | null = null` in `card.ts`. On FAB click, if `activeCard` exists, focus its textarea; else render a new card. On Cancel/Send complete, set `activeCard = null` and remove the card DOM.

```typescript
// card.ts
let activeCard: HTMLElement | null = null;

export function openCard(container: HTMLElement, onSend: ..., onCancel: ...): void {
  if (activeCard) {
    // Already open — focus existing textarea
    activeCard.querySelector('textarea')?.focus();
    return;
  }
  // ... render new card, assign activeCard
}

export function closeCard(): void {
  activeCard?.remove();
  activeCard = null;
}
```

### Pattern 8: Re-Map Affordance (D-09)

**What:** The chip's routed label becomes re-clickable to re-open the project dropdown.

**Critical implementation detail:** Use `.onclick =` assignment (not `addEventListener`). The chip's route-resolve flow calls `renderRoutedLabel` and `wireSendButton` on completion. If the label is re-rendered (e.g. after re-map), stacking `addEventListener` calls would fire the handler multiple times. `.onclick =` is idempotent — last assignment wins.

```typescript
// chip.ts — inside renderRoutedLabel(), after textContent is set
label.onclick = () => {
  renderDropdown(chip, label, dot, feedback, sendBtn, tabId, origin);
};
```

### Anti-Patterns to Avoid

- **CSS selector string in `interact()`:** `interact('.sfx-fab')` uses document-level querySelector and may not find shadow-root elements. Pass the element reference directly: `interact(fabEl)`.
- **`innerHTML` with any external string in toast/card:** All text from the host response (`resp.file`, `resp.error`) goes into `textContent` only — never `innerHTML`. These strings come from the developer's own machine but the XSS pattern is enforced unconditionally.
- **Importing from `background.ts` in content scripts:** `SFX_CAPTURE_TAB` MUST be added to `lib/types.ts`, not defined in `background.ts`. The crash hazard (SW `onStartup` registration dragged into the CS bundle) is documented in `lib/types.ts` line 69-79.
- **Client-side timestamp/filename reconstruction:** The toast must show `resp.file` (the host's actual written filename). Never reconstruct `<serial>-<ts>.md` in the content script — the host owns the serial and the exact timestamp.
- **`return true` missing in SW handler for `SFX_CAPTURE_TAB`:** `chrome.tabs.captureVisibleTab` is async. The SW handler MUST `return true` synchronously so Chrome keeps the message channel open.
- **One rAF (not two) before capture:** One rAF schedules a frame but doesn't guarantee the browser has composited the hidden state. Two rAFs are the correct flush.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag + viewport clamp (FAB/card) | Manual pointer-events drag | `interactjs@1.10.27` | `restrictRect({restriction:'window'})` handles clamp; inertia/snap available later; 60+ LOC otherwise |
| Unique CSS selectors (Phase 5 prep) | Custom selector heuristics | `@medv/finder` (Phase 5) | Upstream showed why fragile; finder is MIT, 1.5 kB, proven |
| YAML frontmatter serialization | Hand-rolled YAML | `yaml` eemeli (host, already installed) | Colons/quotes in URLs and titles silently break hand-rolled YAML |

**Key insight:** The chip's existing `makeDraggable` is NOT being replaced. interactjs is introduced only for the new FAB and card — this minimizes regression risk on the working chip.

---

## Common Pitfalls

### Pitfall 1: SW Message Channel Closes Before Async Response

**What goes wrong:** SW handler for `SFX_CAPTURE_TAB` does NOT return `true` synchronously → Chrome closes the channel → `sendResponse` is a no-op → content script's callback never fires → silent hang.
**Why it happens:** `chrome.tabs.captureVisibleTab` is async. The `onMessage` listener must `return true` before awaiting.
**How to avoid:** Every async branch in the `onMessage` router `return true`. Pattern already established for all existing handlers.
**Warning signs:** Content script's `chrome.runtime.sendMessage` callback never fires; no error in console.

### Pitfall 2: interactjs Selector-Based Registration Misses Shadow-Root Elements

**What goes wrong:** `interact('.sfx-fab')` searches `document` — the FAB is in the shadow root, not `document`, so interactjs finds nothing.
**Why it happens:** The `context` option (which could scope the querySelector) defaults to `document`. Shadow roots are separate trees.
**How to avoid:** Always pass the element reference directly: `interact(fabElement).draggable(...)`. No `context` option needed.
**Warning signs:** Drag silently does nothing; no errors.

### Pitfall 3: Single-rAF Capture Leaks Own-UI Pixels

**What goes wrong:** After hiding shadow-root UI, one `requestAnimationFrame` fires before the browser composites the new visual state — stickyfix elements are still visible in the captured PNG.
**Why it happens:** rAF fires before paint; a second rAF ensures the previous frame was committed.
**How to avoid:** Always use `waitTwoRafs()` (two nested rAFs) before `captureVisibleTab`.
**Warning signs:** Own-UI pixels appear in screenshot; chip or FAB visible in the captured image.

### Pitfall 4: Fractional DPR Without `Math.round` Causes Misaligned Crops

**What goes wrong:** On Windows 125% scale (DPR=1.25), `rect.x * 1.25` = fractional pixels. Canvas `drawImage` with fractional `sx/sy` parameters produces blurry/misaligned crops.
**Why it happens:** CSS rects are in CSS pixels (floats); the captured bitmap is in device pixels (integers). Multiplication may not produce an integer.
**How to avoid:** Always `Math.round` all four crop coordinates after DPR multiplication.
**Warning signs:** Crops are slightly misaligned or blurry at 125% system scale. Test on developer's Windows machine with 125% display scaling.

### Pitfall 5: Listener Stacking on Re-Map

**What goes wrong:** `label.addEventListener('click', ...)` called multiple times (e.g. after route re-resolve) → multiple dropdown renders fire on a single click.
**Why it happens:** Phase 3 chip flow may call `renderRoutedLabel` more than once in some error-then-success flows.
**How to avoid:** Use `label.onclick = () => {...}` (D-09). `.onclick` assignment is idempotent.
**Warning signs:** Two dropdowns appear; rapid-fire SFX_SET_ROUTE calls.

### Pitfall 6: `SFX_CAPTURE_TAB` Defined in `background.ts` Instead of `lib/types.ts`

**What goes wrong:** Content script imports the new constant from `background.ts` → SW registrations (`chrome.runtime.onStartup.addListener`) are dragged into the CS bundle → `onStartup` is undefined in content-script context → crash on startup.
**Why it happens:** `background.ts` has side-effect top-level code. `lib/types.ts` is side-effect-free. [VERIFIED: documented in `lib/types.ts` lines 69-79]
**How to avoid:** Add all new message-type constants to `lib/types.ts` only.

### Pitfall 7: Toast Shows `undefined` for Filename

**What goes wrong:** Toast shows `✓ undefined` instead of `✓ 0001-20260531-143022.md`.
**Why it happens:** Content script reconstructs filename client-side or reads wrong field name. The host returns `file` (not `filename` or `path`).
**How to avoid:** Read `resp.file` directly from the `SfxResponse<{file:string;serial:string}>` shape. [VERIFIED: `background.ts` handleSendAnnotation — line 338 `body.file`]

### Pitfall 8: `captureVisibleTab` Captures Wrong Window

**What goes wrong:** The screenshot is the wrong window or a blank/incorrect capture.
**Why it happens:** `captureVisibleTab(windowId)` requires the correct `windowId`, not the `tabId`. `chrome.tabs.get(tabId).windowId` is the correct source.
**How to avoid:** Always derive `windowId` from `chrome.tabs.get(tabId)` in the SW handler — never assume `windowId === tabId`.

---

## Code Examples

### Example 1: SFX_CAPTURE_TAB Addition to lib/types.ts

```typescript
// lib/types.ts — add alongside SFX_SET_ROUTE, SFX_GET_TAB_ID
export const SFX_CAPTURE_TAB = 'SFX_CAPTURE_TAB' as const;

export interface MsgCaptureTab {
  type: typeof SFX_CAPTURE_TAB;
  tabId: number;
}
```

### Example 2: SW Router Addition for SFX_CAPTURE_TAB

```typescript
// background.ts onMessage router — add case:
case SFX_CAPTURE_TAB:
  handleCaptureTab((msg as MsgCaptureTab).tabId)
    .then(sendResponse)
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: String(err) })
    );
  return true; // MANDATORY — async handler
```

### Example 3: Content Script captureTab() Helper

```typescript
// lib/capture.ts
import { SFX_CAPTURE_TAB } from './types.js';

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

### Example 4: node:test Unit Test for computeCropCoords

```typescript
// lib/test/capture.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCropCoords } from '../capture.js';

const rect = { x: 10, y: 20, width: 100, height: 50 };

test('DPR=1 (identity)', () => {
  const c = computeCropCoords(rect, 1);
  assert.deepStrictEqual(c, { sx: 10, sy: 20, sw: 100, sh: 50 });
});

test('DPR=1.25 (Windows 125% — Math.round required)', () => {
  const c = computeCropCoords(rect, 1.25);
  assert.deepStrictEqual(c, {
    sx: Math.round(10 * 1.25),  // 13 (was 12.5)
    sy: Math.round(20 * 1.25),  // 25
    sw: Math.round(100 * 1.25), // 125
    sh: Math.round(50 * 1.25),  // 63 (was 62.5)
  });
});

test('DPR=2 (HiDPI)', () => {
  const c = computeCropCoords(rect, 2);
  assert.deepStrictEqual(c, { sx: 20, sy: 40, sw: 200, sh: 100 });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `interact.js` (hyphenated npm pkg, v1.2.8) | `interactjs@1.10.27` | 2017+ | `interactjs` is the monorepo's public bundle with current typings; the old hyphenated package is stale |
| Manual pointer-events drag (chip) | interactjs for new surfaces | Phase 4 | Chip keeps proven pointer-events implementation; new surfaces use interactjs |
| `showFeedback` (inline chip stub) | Full shadow-root toast | Phase 4 | Toast is separate DOM, proper ARIA role, persistent for errors |

**Deprecated/outdated:**
- `interact.js` (hyphenated package): stale at 1.2.8. Use `interactjs`.
- `@interactjs/interact` (scoped package): README explicitly says "not for independent use". Use `interactjs`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Two rAFs guarantee the browser paints the hidden shadow-root state before `captureVisibleTab` fires | Pattern 3 (double-rAF) | One rAF may be sufficient; or two may still race on slow machines. Risk: own-UI pixels appear in capture. Mitigated: integration test will visually verify |
| A2 | `interact(el)` (direct element ref) works inside WXT's open shadow root without `context` option — pointer events are `composed:true` and reach document-level interactjs listeners | Pattern 1 (interactjs drag) | If wrong: drag silently fails on shadow-root elements. Mitigation: spike task early in Wave 1; fallback is manual pointer-events drag (chip pattern) |
| A3 | `interact.modifiers.restrictRect({ restriction: 'window' })` clamps to viewport correctly for `position:fixed` elements in a shadow root | Pattern 1 (viewport clamp) | If wrong: FAB/card drift off-screen. Fallback: manual clamp in move listener (same as chip's `makeDraggable`) |
| A4 | `chrome.tabs.captureVisibleTab` requires only `tabs` permission (already in manifest) for active-tab captures in the SW | Pattern 2 (captureVisibleTab) | If wrong: permission error at runtime. The manifest has `activeTab` + `tabs` from Phase 3; this should be sufficient |

**Highest-risk assumption: A2.** Plan must include an explicit spike task (interactjs element-ref drag in the shadow root) before building the full FAB/card UI on top of it.

---

## Open Questions

1. **interactjs shadow-root drag (A2/A3)**
   - What we know: pointer events are `composed:true`; interactjs has basic shadow DOM support since v1.2.3; direct element refs avoid selector-scope issues
   - What's unclear: whether `restrictRect({restriction:'window'})` correctly reads `window` dimensions for positioning a `position:fixed` element in a WXT shadow root
   - Recommendation: Spike task in Wave 1, Plan 04-01 — confirm drag + clamp works before building card UI on top

2. **interactjs `transform` vs `top/left` positioning**
   - What we know: interactjs canonical pattern uses `translate()` transform; chip uses `top/left` positioning
   - What's unclear: whether FAB + card should use `transform` (interactjs default) or `top/left` (chip pattern); they must be `position:fixed`
   - Recommendation: Use `transform: translate(x, y)` for interactjs-managed elements; start at `position: fixed; bottom: 72px; right: 16px` for FAB (CSS initial position below chip)

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 20+ | `node:test` (capture tests) | ✓ | (assumed from Phase 1-3 passing) | — |
| `interactjs@1.10.27` | FAB + card drag | ✗ (not installed) | — | `npm install interactjs@1.10.27` in Wave 0 |
| Chrome MV3 / `captureVisibleTab` | capture integration test | Manual UAT only | — | Unit test math only; full round-trip is manual |

**Missing with install step:**
- `interactjs` — must be installed before any drag code compiles.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 20 built-in) |
| Config file | none — invoked directly via `node --test` |
| Quick run command | `npm run test:lib` (add capture.test.js to the list) |
| Full suite command | `npm run check` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FREE-01 | FAB renders and drag-initializes | Manual-Chrome-UAT | — (no DOM in node:test) | ❌ Wave 0 n/a |
| FREE-02 | Single active card enforced (second FAB click focuses existing) | Manual-Chrome-UAT | — | ❌ Wave 0 n/a |
| FREE-02 | `openCard` guard (module-level `activeCard` logic) | Unit (`node:test`) | `node --test dist/lib/lib/test/card-state.test.js` | ❌ Wave 0 |
| FREE-03 | Free-note payload shape matches `AnnotationPayload` | TypeScript compile-time | `tsc --noEmit` | ✓ (type-checked) |
| FREE-04 | Toast shows `resp.file` value | Manual-Chrome-UAT | — | ❌ Wave 0 n/a |
| REL-01 (partial) | Error toast appears for host-down case | Manual-Chrome-UAT | — | ❌ Wave 0 n/a |
| capture-trio: DPR math | `computeCropCoords` at DPR=1/1.25/2 | Unit (`node:test`) | `node --test dist/lib/lib/test/capture.test.js` | ❌ Wave 0 |
| capture-trio: SW relay | `SFX_CAPTURE_TAB` round-trip returns dataURL | Integration (manual Chrome + running host) | Manual UAT | ❌ Wave 0 n/a |
| capture-trio: double-rAF | `waitTwoRafs` resolves after two frames | Manual-Chrome-UAT / not unit-testable | — | ❌ Wave 0 n/a |
| D-09 re-map | Re-clicking label re-opens dropdown | Manual-Chrome-UAT | — | ❌ Wave 0 n/a |

### Classification: Unit-Testable vs Manual-Chrome-UAT

**Pure unit-testable (node:test, no Chrome API):**
- `computeCropCoords(rect, dpr)` — pure math, no DOM: test DPR=1/1.25/2 [SUCCESS CRITERION 4]
- `openCard` single-active-card guard state machine — pure module logic (if card.ts is factored to separate state from DOM)

**Manual-Chrome-UAT required (browser context / Chrome API):**
- FAB drag, viewport clamping (interactjs in shadow root)
- `captureVisibleTab` round-trip (SW privilege required)
- Double-rAF flush visual verification (own-UI absent from screenshot)
- Toast visuals (success auto-dismiss, error persist + dismiss button)
- Free-note end-to-end (FAB → Send → `.md` on disk → toast)
- Re-map affordance (label → dropdown → new route)

### Sampling Rate

- **Per task commit:** `npm run check` (tsc + clean-room grep + host tests + lib tests)
- **Per wave merge:** `npm run check` + manual-Chrome-UAT checklist
- **Phase gate:** Full `npm run check` green + all Manual-Chrome-UAT items confirmed before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `lib/capture.ts` — exports `captureTab()`, `waitTwoRafs()`, `cropToRect()`, `computeCropCoords()`
- [ ] `lib/test/capture.test.ts` — covers DPR=1/1.25/2 for `computeCropCoords` (SUCCESS CRITERION 4)
- [ ] Update `tsconfig.lib.json` to include `lib/capture.ts` in compilation
- [ ] Update `package.json` `test:lib` script to include `dist/lib/lib/test/capture.test.js`
- [ ] `npm install interactjs@1.10.27` — must precede any drag code

---

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — (this is a local-only developer tool; no user auth) |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | Yes | `textContent` only for all external strings (toast message, filename from host) — no `innerHTML`; body cap 12 MB enforced at host |
| V6 Cryptography | No | — |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via toast or card text from host response | Tampering | All host-derived strings (`resp.file`, `resp.error`) go into `textContent` only — never `innerHTML`. Pattern enforced in chip.ts and must continue in fab.ts/card.ts/toast.ts |
| Content script fetch to localhost | Elevation of Privilege | SW relay invariant — content scripts NEVER fetch 127.0.0.1 directly; ALL HTTP via `SFX_SEND_ANNOTATION` through SW. captureVisibleTab also relayed through SW for the same reason |
| Message spoofing (SFX_CAPTURE_TAB) | Spoofing | SW derives `windowId` from `chrome.tabs.get(tabId)` — not from the message body. Tab origin is already anti-spoofed for `SFX_SEND_ANNOTATION` (T-03-01 pattern from Phase 3) |
| Shadow-root isolation bypass | Tampering | WXT `createShadowRootUi` with `cssInjectionMode:'ui'` isolates styles; `:host { all:initial }` prevents host-page style inheritance |

---

## Sources

### Primary (HIGH confidence)
- `D:\docker\stickyfix\entrypoints\review.content\chip.ts` — existing drag pattern, SFX_SEND_ANNOTATION wiring, renderDropdown, wireSendButton
- `D:\docker\stickyfix\entrypoints\review.content\index.ts` — createShadowRootUi mount pattern
- `D:\docker\stickyfix\entrypoints\background.ts` — SW onMessage router, handleSendAnnotation pattern, `return true` async pattern
- `D:\docker\stickyfix\lib\types.ts` — SFX_MSG constants, import hazard documentation (lines 69-79)
- `D:\docker\stickyfix\host\src\types.ts` — AnnotationPayload shape
- `D:\docker\stickyfix\PRD.md` §7.3 — captureVisibleTab + canvas drawImage spec, DPR multiply spec, hide-own-UI spec
- `D:\docker\stickyfix\PRD.md` §9.1/9.2 — Payload and note file format
- `D:\docker\stickyfix\.planning\phases\04-free-note-mode-capture-utilities\04-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)
- npm registry: `npm view interactjs version` → 1.10.27 confirmed
- interactjs changelog (via WebFetch): shadow DOM basic support since v1.2.3; `context` option since v1.3.0 for CSS-selector delegation scope
- Chrome Extensions docs (training knowledge verified against codebase pattern): `captureVisibleTab` is SW-only; `tabs` + `activeTab` permissions sufficient

### Tertiary (LOW confidence / ASSUMED)
- Two-rAF flush as the standard browser paint-cycle guarantee — well-known web development convention, not found in Chrome official docs
- `interact.modifiers.restrictRect({restriction:'window'})` viewport clamping behavior for `position:fixed` elements in shadow root — unverified in WXT context (see Assumption A2/A3)
- interactjs direct element reference works without `context` option in open shadow roots — derived from `composed:true` event behavior; not confirmed by interactjs docs specifically

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified against npm registry or locked in CLAUDE.md
- Architecture: HIGH — all patterns derived from reading the existing codebase directly
- interactjs shadow-root drag: LOW — A2/A3 require a spike; fallback is chip's proven `makeDraggable`
- Pitfalls: HIGH — all derived from the actual codebase reading existing patterns and documented hazards

**Research date:** 2026-05-31
**Valid until:** 2026-07-01 (interactjs and WXT are stable; shadow-root behavior is browser-spec-governed)
