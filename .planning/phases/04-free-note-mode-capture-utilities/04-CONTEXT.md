# Phase 4: Free-Note Mode + Capture Utilities - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the first **real** note: a developer in Review Mode taps a draggable `+` FAB, types a comment in a post-it card, hits **Send**, and a correctly named `.md` lands in the routed project's `notes/` dir — surfaced by a real toast. It also builds the **DPR-correct capture utility trio** (captureVisibleTab SW relay, double-rAF own-UI flush, DPR-correct canvas crop) as **standalone, unit-tested reusables** that Phases 5 (auto element-highlight `+1`) and 6 (region marquee `+N`) consume. This is the end-to-end vertical slice (note → disk) the roadmap targets at the end of Phase 4.

**In scope:**
- `+` FAB (draggable, default bottom-right) + single post-it card (textarea + Send + Cancel) inside the **existing** `createShadowRootUi` review mount (FREE-01/02).
- Free-note Send: build the `mode:'free'` §9.1 payload (url/title/timestamp-via-host/viewport, `screenshots: []`) and relay it through the existing `SFX_SEND_ANNOTATION` SW handler → host writes `0001-<ts>.md` (FREE-03).
- A shadow-root **toast** surface: success (auto-dismiss ~3s, names the file) / error (persists, names the reason) — the first real toast (FREE-04 / REL-01).
- **interactjs** introduced for FAB + post-it drag (viewport-clamped, operating inside the shadow root).
- The capture utility trio: built, unit-tested at DPR 1 / 1.25 / 2, and proven with **one** integration test round-tripping `captureVisibleTab` through the SW. (No consumer in free notes — see D-08.)
- A **re-map / "change project"** affordance on the chip (carry-forward from Phase-3 UAT).

**Out of scope (later phases):**
- Screenshots on free notes (FREE is text-only — D-08).
- 🎯 element picker + rich capture (Phase 5) — the first real *consumer* of the capture trio.
- 📷 region marquee crop (Phase 6) — the second consumer of the trio.
- Warm paper/post-it aesthetics, animations, mode color-coding (Phase 6).
- Exhaustive toast coverage across every failure path + multi-note stress (Phase 8). This phase ships the toast *surface* and the success + host-down cases; full matrix is Phase 8.
</domain>

<decisions>
## Implementation Decisions

### FAB + Post-It Card (FREE-01 / FREE-02)
- **D-01:** A draggable `+` **FAB**, default **bottom-right** (offset from the connection chip, which sits top-right), lives inside the **same** shadow-root review UI mounted by `createShadowRootUi` in `review.content/index.ts`. Rationale: one mount hosts all surfaces (chip + FAB + card + toast); no second injected root to manage or z-index against.
- **D-02:** Clicking the FAB opens **one** post-it card = a `<textarea>` for the comment + **Send** + **Cancel**. Enforce a **single active card**: if a card already exists, opening focuses/reuses it rather than spawning a second (PRD §6.5 "One active post-it at a time" — locked default for v1). Cancel discards the card.
- **D-03:** Styling is **functional-minimal** this phase (legible, clean, `px` units, smooth-enough drag). Warm-paper aesthetic, peel/shadow, and mode color-coding are **deferred to Phase 6** (UI-02/UI-03). Do not pre-build the paper look here.

### Drag Implementation
- **D-04:** Introduce **`interactjs@1.10.27`** (the project's chosen drag lib, per the stack table — selected specifically for FAB/post-it/chip drag + the future region marquee) for the **FAB and the post-it card**, with viewport clamping. interactjs must be wired to operate **inside the shadow root** (target the shadow-root elements; pointer events traverse the shadow boundary). Do **NOT** retrofit the Phase-3 chip drag in this phase — the chip keeps its proven pointer-events `makeDraggable` (`chip.ts`) to avoid a regression on a working surface (the developer's top frustration). interactjs adoption on the chip can come later if desired.

### Capture Utility Trio — ⚠️ KEY SCOPE DECISION
- **D-05:** Build **three** standalone, **unit-tested** reusable utilities (consumed by Phases 5/6):
  - **(a) captureVisibleTab SW relay** — content script → `chrome.runtime.sendMessage` → SW calls `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })` → dataURL returned. The **SW is the only privileged caller** (consistent with the Phase-3 SW-as-sole-HTTP/privileged-API relay boundary; `captureVisibleTab` requires `activeTab`/host perms the content script lacks). Add a new message type (e.g. `SFX_CAPTURE_TAB`) to the protocol + a SW handler.
  - **(b) double-`requestAnimationFrame` flush** — a helper that awaits **two** rAFs so the page/own-UI paints (e.g. hides stickyfix UI, double-rAF, then capture) before the screenshot, so the shot is clean page pixels (PRD §7.3 "hide stickyfix's own UI … then restore").
  - **(c) DPR-correct crop** — a canvas `drawImage(img, sx,sy,sw,sh, 0,0,dw,dh)` helper that multiplies the CSS rect by `devicePixelRatio` and `Math.round`s (Windows fractional-DPR safe, e.g. 1.25). Unit-tested at **DPR=1, 1.25, 2** (Success Criterion 4).
- **D-06:** ⚠️ **THE MOST IMPORTANT DECISION FOR THE PLANNER — free notes stay TEXT-ONLY per FREE-03.** Free-note payload carries `screenshots: []` — **no** auto screenshot is added in this phase. PRD §7.3 confirms: "*(Free notes have no auto shot.)*" The capture trio is built + unit-tested + proven only via **one** integration test that round-trips `captureVisibleTab` through the SW; its real consumers are **Phase 5** (element `+1`) and **Phase 6** (region `+N`). This keeps FREE scope tight and de-risks the capture path early without coupling it to the free-note flow. **Do not wire capture into the free-note Send.**

### Toast (FREE-04 / REL-01)
- **D-07:** Introduce a shadow-root **toast** surface in the shared review UI (this is the *first real toast*). **Success:** auto-dismiss ~3s, shows the written filename (e.g. `✓ wrote notes\0001-<ts>.md`, from the host's `{ ok, file, serial }` response). **Error:** **persists until dismissed**, shows the failure reason (host down, 401, no host for origin). **Never silent** (REL-01 / PRD reliability constraint — a dropped note is a regression). The Phase-3 chip's inline `showFeedback` was a stub; the free-note Send uses the new toast. Exhaustive toast coverage across all flows remains **Phase 8**.

### Review UI Composition & Send Relay
- **D-08:** **One** `createShadowRootUi` mount hosts **all** review surfaces — connection chip (routing/status, from Phase 3), the `+` FAB, the active post-it card, and toasts. The free-note Send **reuses the existing `SFX_SEND_ANNOTATION` SW relay** with a real `mode:'free'` payload (the relay was proven end-to-end in Phase 3's stub; this phase just feeds it real comment text). No new annotation transport.

### Re-Map Affordance (carry-forward — Phase-3 UAT request)
- **D-09:** Add a small **"change project"** control so a mapped origin can be **re-pointed**: clicking the chip's routed label re-opens the project dropdown (same `renderDropdown` flow) and overwrites the mapping via the existing **`SFX_SET_ROUTE`** handler. Use **`.onclick =` assignment** (not `addEventListener`) for the re-bound label so re-renders don't **stack** listeners. Low-risk, reuses proven Phase-3 paths.

### Claude's Discretion
- Exact new message-type name for the capture relay (`SFX_CAPTURE_TAB` suggested), FAB/card DOM structure and placement offsets, the toast element markup and stacking behavior, interactjs configuration specifics (restrict/modifiers vs manual clamp), and how the capture utilities are factored into pure-testable units (the crop + DPR math should be pure functions testable under `node:test` without the chrome API). Keep the `sfx-*`/`stickyfix` namespace; clean-room gate stays green.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase spec & contracts
- `PRD.md` §7.3 — Capture mechanics: `captureVisibleTab` + canvas `drawImage` crop, **multiply CSS rect by `devicePixelRatio`**, **hide own UI before capture / restore after** (the spec source for the capture trio).
- `PRD.md` §9.1 — Annotation payload shape (the `mode:'free'` free-note payload this phase builds for real; `screenshots: []`).
- `PRD.md` §9.2 — Note file format on disk (frontmatter + body; confirms the host-side filename `0001-<ts>.md` the toast reports).
- `PRD.md` §6.5 / §14 — "One active post-it at a time" (D-02) and acceptance criterion #4 (free note → `notes/0001-<ts>.md` + toast naming the file).
- `PRD.md` §7.5 — Error handling / no silent failures (toast on every failed Send — D-07).
- `.planning/ROADMAP.md` — Phase 4 goal + Success Criteria (FAB→post-it→Send→.md; DPR crop tested at 1/1.25/2; double-rAF flush; trio is reusable for Phases 5/6).
- `.planning/REQUIREMENTS.md` — **FREE-01..FREE-04** (this phase's requirements); **REL-01** (no silent drop — the toast obligation lands here even though full REL coverage is Phase 8).

### Prior phase (must read — this phase extends it)
- `.planning/phases/03-extension-skeleton-sw-relay-proof/03-CONTEXT.md` — carry-forward: SW-as-sole-privileged-caller boundary (D-01/D-05), the shadow-root mount pattern, storage schema, routing resolution order, the proven `SFX_SEND_ANNOTATION` relay this phase reuses.

### Code the planner MUST read (extend, don't rewrite)
- `entrypoints/review.content/index.ts` — the single `createShadowRootUi` mount + `mountChip`/`teardownChip` wiring; add FAB/card/toast into this **same** mount (D-08).
- `entrypoints/review.content/chip.ts` — the existing pointer-events `makeDraggable`, the `SFX_GET_ROUTE`/`SFX_SET_ROUTE` flow (for the D-09 re-map), `renderDropdown`, and the `wireSendButton` stub the real Send replaces. createElement/textContent-only DOM (no innerHTML) is the established XSS-safe pattern — follow it.
- `entrypoints/background.ts` — the SW `onMessage` router (`case SFX_MSG.SEND_ANNOTATION`, `SFX_SET_ROUTE`); add the `captureVisibleTab` handler here (`return true` async-response pattern).
- `lib/types.ts` — `SFX_MSG` constant map + `SFX_SET_ROUTE`/`SFX_GET_TAB_ID`; add the new capture message type here (NOT in background.ts — importing from background.ts into the content script drags SW registrations and crashes the CS; documented in the file).
- `host/src/types.ts` — `AnnotationPayload` (`mode:'free'|'element'`, `screenshots?: Screenshot[]`) the free-note payload must match exactly.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`createShadowRootUi` mount** (`index.ts`): already configured (`cssInjectionMode:'ui'`, `position:'inline'`, z-index 2147483647 via `:host`). The FAB, post-it card, and toast attach into the **same** `container` passed to `onMount` — no new mount needed.
- **`SFX_SEND_ANNOTATION` relay** (`chip.ts` `wireSendButton` → `background.ts` `handleSendAnnotation`): the full content-script → SW → host `POST /annotation` path with token + routing is already proven. The real free-note Send swaps the stub comment for the textarea value.
- **`SFX_SET_ROUTE` + `renderDropdown`** (`chip.ts`): reused verbatim for the D-09 re-map affordance.
- **`getTabId()` helper** (`chip.ts`): content-script tabId lookup via the SW — the FAB/card Send reuses it.

### Established Patterns
- **DOM via `createElement`/`textContent` only — no `innerHTML`** with external strings (XSS-safe; enforced across `chip.ts`). Apply to FAB/card/toast.
- **SW owns all privileged calls** — content scripts never `fetch` 127.0.0.1 and (D-05) never call `captureVisibleTab`; both relay through the SW. Same `return true` async-`sendResponse` pattern as the existing router cases.
- **Message types live in `lib/types.ts`** (side-effect-free), never imported from `background.ts` into the content script (documented crash hazard).
- **`npm run check`** = `tsc --noEmit` ×2 + clean-room grep + host tests + smoke. Pure capture math (DPR crop) should be factored as **chrome-API-free pure functions** unit-tested under `node:test` to satisfy Success Criterion 4 (DPR 1/1.25/2) without a browser.

### Integration Points
- FAB/card Send → existing `SFX_SEND_ANNOTATION` → `handleSendAnnotation` → host `POST /annotation` → `{ ok, file, serial }` → **toast** (D-07).
- New `SFX_CAPTURE_TAB` (or similar) → SW `chrome.tabs.captureVisibleTab` → dataURL → (Phase 5/6 consumers; proven via one integration test this phase).
- Re-map: chip label `.onclick` → `renderDropdown` → `SFX_SET_ROUTE` (D-09).
</code_context>

<specifics>
## Specific Ideas

- The single most planner-relevant constraint: **D-06 — do NOT add a screenshot to the free-note payload.** The capture trio is built and tested *standalone* this phase and only *consumed* in Phases 5/6. Building it now de-risks the hardest pixel-fidelity path (DPR, own-UI flush) early while keeping FREE text-only.
- Success toast should echo the host's exact returned `file` field (e.g. `0001-20260531-143022.md`), not a client-reconstructed name — the host owns the serial/timestamp.
- DPR crop must `Math.round` after multiplying by `devicePixelRatio` so **fractional DPR (1.25)** crops don't misalign — this is the explicit Windows case in Success Criterion 4.
- Keep the chip's working pointer-events drag untouched (D-04) — introduce interactjs only on the new FAB/card surfaces.
</specifics>

<deferred>
## Deferred Ideas

- **Warm post-it aesthetics + animations + mode color-coding** — Phase 6 (UI-02/UI-03).
- **Element capture** (🎯 picker, selector/fiber/styles/outerHTML, auto-highlight `+1`) — Phase 5 (first real consumer of the capture trio).
- **Region marquee capture** (📷 camera, scrim, drag-rect, `+N` thumbnails) — Phase 6 (second consumer of the trio).
- **Exhaustive toast coverage** across every failure path (401, 413, SW-evicted-mid-flight, no-host) + multi-note stress — Phase 8. This phase ships the toast surface + success and host-down paths only.
- **Screenshots on free notes** — out of FREE scope permanently (free notes are text-only per FREE-03 / PRD §7.3); manual region crops on a free note arrive via the Phase-6 camera, not as an auto shot.

### Reviewed Todos (not folded)
None — discussion stayed within phase scope.
</deferred>

---

*Phase: 4-Free-Note Mode + Capture Utilities*
*Context gathered: 2026-05-31*
