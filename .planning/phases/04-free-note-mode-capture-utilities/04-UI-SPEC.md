---
phase: 4
slug: free-note-mode-capture-utilities
type: UI-SPEC
status: draft
scope: functional-minimal
shadcn_initialized: false
preset: none
created: 2026-05-31
---

# Phase 4 — UI Design Contract (functional-minimal)

> **Scope note:** Functional-minimal only. Warm-paper post-it aesthetics,
> peel/shadow texture, mode color-coding, and animations are **deferred to
> Phase 6** (UI-02/UI-03). This contract specifies behavior, structure, and a
> clean neutral baseline — not final brand styling. All surfaces live inside
> the ONE shared `createShadowRootUi` shadow root already hosting the
> connection chip.

---

## Design System

| Property | Value | Source |
|----------|-------|--------|
| Tool | none | CONTEXT.md D-03 / Phase 3 precedent |
| Preset | not applicable | vanilla DOM in shadow root |
| Component library | none — createElement/textContent only | chip.ts established pattern |
| Icon library | Unicode glyphs inline (no icon lib) | Phase 3 precedent |
| Font | `system-ui, -apple-system, sans-serif` | styles.css established |

---

## Spacing Scale

Declared values (multiples of 4, px only — rem refers to host page `<html>`
font-size which may be anything; see WXT FAQ / styles.css header):

| Token | Value | Usage in this phase |
|-------|-------|---------------------|
| xs | 4px | Icon gaps, dot-to-text gap in toast |
| sm | 8px | FAB padding, card button gap, toast padding horizontal |
| md | 16px | Card internal padding, toast vertical padding |
| lg | 24px | Card min-width breathing room calculation |
| xl | 32px | FAB default offset from viewport edges |
| 2xl | 48px | Min touch target for FAB (44px rounded to scale) |

Exceptions:
- FAB touch target: minimum 44px × 44px to meet a11y minimum. Achieved via
  `width:44px; height:44px` with centered content — not a spacing token.
- FAB offset from chip: chip is at `top:16px right:16px`; FAB default is
  `bottom:32px right:32px` so it occupies the opposite quadrant with clear
  visual separation.

---

## Typography

All px, all `system-ui, -apple-system, sans-serif` (same face as chip):

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Body | 14px | 400 | 1.5 | Textarea content, card body |
| Label | 13px | 400 | 1.0 | Chip label, card header text, toast message |
| Action | 12px | 600 | 1.0 | Send/Cancel button labels, toast dismiss × |
| FAB glyph | 20px | 400 | 1.0 | `+` character inside the FAB |

Two weights declared: regular (400) + semibold (600). No other weights.

---

## Color

Neutral functional palette. Matches the existing chip palette — NO new hues
introduced this phase. Warm post-it colors are Phase 6.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#ffffff` | Card background, FAB background, toast background |
| Secondary (30%) | `#f0f0f0` | Card header drag-handle zone, button default bg, toast border-adjacent area |
| Accent (10%) | `#1d6ed8` | Send button background ONLY when enabled |
| Destructive | `#dc2626` | Error toast border-left stripe; error toast text; no other use |
| Success | `#16a34a` | Success toast border-left stripe; check glyph; no other use |
| Border | `#cccccc` | Card border, FAB border, toast border (matches chip) |
| Text primary | `#111111` | All body/label text (matches chip) |
| Text muted | `#666666` | Placeholder text in textarea, Cancel button text, dismiss × |
| Disabled | `#999999` | Send button text + border when disabled |
| Disabled bg | `#f0f0f0` | Send button background when disabled |

Accent (`#1d6ed8`) reserved for: **Send button background only** (enabled state).
Send button text on accent: `#ffffff`.

---

## Surface Specifications

### 1. `+` FAB (FREE-01)

**Purpose:** opens the post-it card.

**DOM structure:**
```
#sfx-fab   (button)
  └─ span.sfx-fab-icon  "+")
```

**Appearance:**
- `position: fixed; bottom: 32px; right: 32px`
- `width: 44px; height: 44px; border-radius: 50%`
- Background `#ffffff`; border `1px solid #cccccc`; box-shadow `0 2px 8px rgba(0,0,0,0.15)`
- `+` glyph: 20px, color `#111111`, centered via `display:flex; align-items:center; justify-content:center`
- `pointer-events: auto` (host shadow root has `pointer-events:none` — FAB must set its own)
- `cursor: pointer; user-select: none`
- `z-index` is not needed on the element itself — `:host` in the shadow root already declares `z-index: 2147483647` and `position: fixed` with full viewport coverage

**States:**
| State | Visual |
|-------|--------|
| Default | `#ffffff` bg, `#cccccc` border |
| Hover | `#f0f0f0` bg |
| Active (pressed) | `#e0e0e0` bg |
| Card open (FAB still visible) | No state change on FAB itself; card focused |

**Interaction:**
- Click → if no active card: create and show the post-it card; focus the textarea immediately.
- Click → if card already active: focus the existing card textarea; do NOT spawn a second card (D-02).
- Drag: interactjs with `restrict: { restriction: 'window', endOnly: false }` modifier. FAB position is ephemeral (not persisted). Minimum drag threshold: 4px (prevent drag-on-intent-click).

**Keyboard/a11y:**
- `role="button"` (native `<button>` element — implicit)
- `aria-label="Add note"` on `#sfx-fab`
- When card is open: `aria-expanded="true"` on `#sfx-fab`
- Tab-reachable; Enter/Space activates same as click

---

### 2. Post-it Note Card (FREE-01, FREE-02)

**Purpose:** compose and send a free-mode text note.

**DOM structure:**
```
#sfx-card                         (div, draggable)
  ├─ .sfx-card-header             (div — drag handle zone; non-interactive)
  │    └─ .sfx-card-header-label  (span "Free note")
  ├─ .sfx-card-body               (div)
  │    └─ #sfx-card-textarea      (textarea)
  └─ .sfx-card-footer             (div)
       ├─ #sfx-card-send          (button "Send")
       └─ #sfx-card-cancel        (button "Cancel")
```

**Appearance:**
- `position: fixed` with default open position: `bottom: 88px; right: 32px`
  (32px above FAB, so FAB remains visible)
- `width: 300px` (fixed — not responsive; shadow root is isolated from page layout)
- `min-height: 160px`
- Background `#ffffff`; border `1px solid #cccccc`; border-radius `6px`
- Box-shadow `0 4px 16px rgba(0,0,0,0.18)` (slightly more prominent than chip — it is a modal-like card)
- `pointer-events: auto`

**Header (`#sfx-card-header`):**
- `padding: 8px 12px`
- Background `#f0f0f0`; border-bottom `1px solid #cccccc`; border-radius `6px 6px 0 0`
- Label: 13px, color `#111111`, text "Free note"
- `cursor: grab` when draggable; `cursor: grabbing` during active drag
- This is the ONLY drag-initiating zone (pointer down on header = drag; pointer down on body/footer = not drag)

**Body:**
- `padding: 8px`
- `#sfx-card-textarea`:
  - `width: 100%; box-sizing: border-box`
  - `min-height: 100px; resize: vertical`
  - `font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; color: #111111`
  - `border: 1px solid #cccccc; border-radius: 4px; padding: 6px 8px`
  - `background: #ffffff`
  - Placeholder: "Type your note…" (color `#666666`)
  - `outline` on focus: `2px solid #1d6ed8; outline-offset: 1px` (visible keyboard focus ring)
  - `all: unset` NOT applied here — the textarea must retain browser default form field behavior; only explicit properties listed above are applied

**Footer:**
- `padding: 8px; display: flex; flex-direction: row; gap: 8px; justify-content: flex-end`
- `border-top: 1px solid #f0f0f0`

**Send button (`#sfx-card-send`):**
- `font-family: system-ui; font-size: 12px; font-weight: 600; padding: 5px 12px`
- `border-radius: 4px; border: none; cursor: pointer`
- **Enabled:** background `#1d6ed8`; color `#ffffff`
- **Disabled** (textarea empty OR sending in-flight): background `#f0f0f0`; color `#999999`; border `1px solid #cccccc`; cursor `not-allowed`
- Hover (enabled only): background `#1558b0`

**Cancel button (`#sfx-card-cancel`):**
- `font-family: system-ui; font-size: 12px; font-weight: 400; padding: 5px 12px`
- `border-radius: 4px; border: 1px solid #cccccc; background: #f0f0f0; color: #666666; cursor: pointer`
- Hover: background `#e0e0e0`

**Single-card enforcement (D-02):**
- A module-level reference (`let activeCard: HTMLElement | null`) tracks the one live card.
- If `activeCard !== null` when FAB is clicked: call `activeCard.querySelector('textarea')?.focus()` and return immediately — do NOT create a second card.
- On Cancel or after Send completes: set `activeCard = null` and remove `#sfx-card` from the container.

**Send disabled rule:** Send is disabled when textarea value is empty (after trim) OR when a send is in-flight. Reason: an empty-comment note provides no value; PRD §6.5 implies a comment field. Assumption: empty send disabled is the right default — noted here as a discrete decision in case Phase 6 overrides.

**States:**

| State | Visual |
|-------|--------|
| Open, empty | textarea focused; Send disabled |
| Open, has text | Send enabled (blue) |
| Sending (in-flight) | Send disabled, text "Sending…"; Cancel disabled; textarea `readonly` |
| Error returned | Restore Send + Cancel; show error toast (see §4); card remains open |
| Success | Card removed; success toast shown |

**Drag (interactjs):**
- Interact target: `#sfx-card`; drag handle restricted to `.sfx-card-header`
- Modifier: `interact.modifiers.restrict({ restriction: 'window', endOnly: false })`
- `inertia: false` (no slide — functional minimal; Phase 6 can add inertia)
- Drag starts on `pointerdown` on header; pointer down on textarea/buttons does NOT start drag (interactjs `allowFrom: '.sfx-card-header'`)

**Keyboard:**
- `Esc` inside the textarea → cancel (same as Cancel button click)
- `Tab` cycles: textarea → Send → Cancel → textarea
- `Enter` in textarea → newline (not Send — this is a multi-line textarea)
- `Ctrl+Enter` (or `Cmd+Enter` on mac) → Send (if enabled). Assumption: keyboard shortcut for Send aids power-user flow; consistent with most note-taking UIs.

**Focus management:**
- On card open: `#sfx-card-textarea` receives `focus()` immediately after DOM insertion (next microtask — `Promise.resolve().then(() => textarea.focus())`)
- On card close (Cancel or Success): `#sfx-fab` receives `focus()` to restore keyboard position

**A11y:**
- `role="dialog"` on `#sfx-card`; `aria-label="Add free note"`
- `aria-modal="false"` — the card is NOT a true modal; page interaction must remain possible
- Send: `aria-label="Send note"` when enabled; `aria-label="Send note (empty)"` when disabled
- Cancel: `aria-label="Cancel note"`

---

### 3. Toast Surface (FREE-04, REL-01)

**Purpose:** success or error feedback after Send. Never silent.

**DOM structure (one toast element per notification, appended to container):**
```
.sfx-toast                   (div)
  ├─ .sfx-toast-stripe       (div — 4px left border, color-coded)
  ├─ .sfx-toast-body         (div)
  │    ├─ .sfx-toast-icon    (span — glyph)
  │    └─ .sfx-toast-msg     (span — message text)
  └─ .sfx-toast-dismiss      (button "×" — error only)
```

**Positioning:**
- `position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%)`
- `pointer-events: auto`
- Stacking: new toasts append below existing ones; `bottom` offset increments by `(toast.offsetHeight + 8px)` per existing visible toast. Implementation: each toast is assigned an index on creation; `bottom = 32 + index * (height + 8)`.
- Maximum 3 simultaneous toasts. If a 4th arrives while 3 are visible, dismiss the oldest success toast first (errors are never auto-dismissed by overflow).

**Appearance:**
- `width: 320px; max-width: calc(100vw - 32px)`
- `border-radius: 6px; border: 1px solid #cccccc`
- `background: #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.15)`
- `display: flex; flex-direction: row; align-items: stretch; overflow: hidden`
- `font-family: system-ui; font-size: 13px; color: #111111`

**Stripe (`.sfx-toast-stripe`):**
- `width: 4px; flex-shrink: 0`
- Success: `background: #16a34a`
- Error: `background: #dc2626`

**Body (`.sfx-toast-body`):**
- `padding: 8px 12px; display: flex; flex-direction: row; align-items: center; gap: 8px; flex: 1`

**Icon (`.sfx-toast-icon`):**
- Success: `✓` glyph, color `#16a34a`, 14px
- Error: `✕` glyph, color `#dc2626`, 14px

**Message (`.sfx-toast-msg`):**
- 13px, color `#111111`
- Success text: `notes\{file}` where `{file}` is the exact `file` field from the host's `{ ok, file, serial }` response — never client-reconstructed (CONTEXT specifics).
  - Full copy: `wrote notes\0001-20260531-143022.md`
- Error text: the failure reason string from the SW/host response (e.g. `Host unreachable`, `401 Unauthorized`, `No host for this origin`). Truncated to 200 chars if longer.

**Dismiss button (`.sfx-toast-dismiss`) — error toasts only:**
- `×` glyph, 14px, `font-weight: 600`, color `#666666`
- `padding: 8px; border: none; background: transparent; cursor: pointer`
- `aria-label: "Dismiss error"`
- Hover: color `#111111`

**Timing:**
- Success: auto-dismiss after 3000ms via `setTimeout`. Uses `opacity` transition: `opacity: 1` → `opacity: 0` over 200ms, then `remove()`.
- Error: persists until dismissed by the `×` button. No auto-dismiss. This is REL-01 compliance — an error must remain visible.
- Error dismiss: click `×` → `remove()` immediately (no fade).

**A11y:**
- Each toast has `role="status"` (success) or `role="alert"` (error) so screen readers announce it.
- `aria-live="polite"` on success, `aria-live="assertive"` on error.
- The shadow root container gets a live region wrapper: `#sfx-toast-region` with `aria-live="polite"` as the default; individual error toasts override with `role="alert"`.

---

### 4. Re-map Affordance on the Chip (D-09 carry-forward)

**Purpose:** allow a developer to change which project a mapped origin routes to, without exiting Review Mode.

**Trigger:** clicking the existing `.sfx-chip-label` element (which currently shows `→ name · notesDir`) when the origin IS mapped.

**Visual affordance on the label:**
- `cursor: pointer`
- `text-decoration: underline dotted #666666` (dotted underline — subtle, not a full link style)
- `title="Change project"` (browser tooltip on hover)
- On hover: `color: #1d6ed8` (the accent — one of the two permitted uses of accent-adjacent feedback)

**Interaction:**
- `.onclick =` assignment (not `addEventListener`) to prevent listener stacking on re-renders (D-09 explicit requirement).
- Click → call `renderDropdown(...)` (the existing Phase 3 function, reused verbatim).
- `renderDropdown` replaces the label content with the project select; on selection, SFX_SET_ROUTE is sent and the label is re-rendered with the new host.
- The chip's stub Send button is suppressed while the dropdown is visible (already the case in the existing `renderDropdown` implementation).

**No new DOM elements required** — this is purely a behavior and style addition to the existing `.sfx-chip-label` span.

---

## Quality Bar for This Phase

| Dimension | Requirement |
|-----------|-------------|
| Shadow-DOM isolation | Host page CSS cannot alter FAB/card/toast; FAB/card/toast CSS does not leak to host page. Verified by loading on a Tailwind-heavy page. |
| No layout shift | Mounting/unmounting FAB, card, or toast causes zero CLS on the host page (shadow root is `position:fixed`, `pointer-events:none` on `:host`). |
| Legibility | All text legible at default zoom (100%) on both light and dark host pages. Neutral `#ffffff` background ensures contrast against both. |
| Pointer separation | Pointer events on card/toast/FAB do not bleed through to the host page (each interactive element has `pointer-events:auto`; `:host` has `pointer-events:none`). |
| Never silent | Every Send result — success or failure — surfaces a toast (REL-01). The chip's stub `showFeedback` is replaced for real Sends; the chip inline feedback remains only for the relay-proof stub if it still exists. |
| Single card | Only one `#sfx-card` in the DOM at any time. Verified by checking `document.querySelector` in shadow root before creating. |
| Keyboard completeness | FAB, Send, Cancel, dismiss × all reachable by Tab; Esc cancels the card; Ctrl+Enter submits. |
| interactjs scope | interactjs operates on shadow-root elements only; the chip's existing `makeDraggable` pointer-events drag is NOT replaced (D-04). |

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| FAB aria-label | `Add note` |
| Card heading | `Free note` |
| Textarea placeholder | `Type your note…` |
| Send button (enabled) | `Send` |
| Send button (in-flight) | `Sending…` |
| Cancel button | `Cancel` |
| Success toast | `wrote notes\{file}` (exact host-returned filename; no prefix check-glyph in text — glyph is in the icon span) |
| Error toast — host down | `Host unreachable` |
| Error toast — 401 | `401 Unauthorized — check token` |
| Error toast — no host | `No host for this origin` |
| Error toast — SW error | `Extension error: {message}` |
| Error dismiss button aria-label | `Dismiss error` |
| Re-map label title tooltip | `Change project` |
| Card aria-label | `Add free note` |
| Card Send aria-label (enabled) | `Send note` |
| Card Send aria-label (disabled) | `Send note (empty)` |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — no shadcn |
| interactjs@1.10.27 | drag for FAB and card | vetted in RESEARCH.md / CLAUDE.md stack table; MIT license; no third-party registry; npm direct — no vetting gate required |

No third-party shadcn registries declared.

---

## Explicitly Deferred to Phase 6

- Warm paper color (`#fef9c3` / sticky-note yellow) — Phase 6 (UI-02)
- Peel shadow / paper texture on post-it card — Phase 6 (UI-02)
- Mode color-coding header strip (free vs element distinct colors) — Phase 6 (UI-03)
- Animated drag with inertia (interactjs `inertia: true`) — Phase 6
- Animated toast entrance/exit (slide-in, fade) beyond the opacity fade on dismiss — Phase 6
- Toast styled with rich iconography (icon component library) — Phase 6 (UI-04)
- Camera tool (`📷`) UI on the card — Phase 6 (CAM-01)
- Thumbnail strip for region crops on the card — Phase 6 (CAM-05)
- Element-highlight overlay + cursor crosshair — Phase 5 (ELEM-01)
- Exhaustive toast error path coverage — Phase 8 (REL-01 full matrix)

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

---

*Functional-minimal UI contract. Full visual design: Phase 6.*
*Phase: 4 — Free-Note Mode + Capture Utilities*
*Spec created: 2026-05-31*
