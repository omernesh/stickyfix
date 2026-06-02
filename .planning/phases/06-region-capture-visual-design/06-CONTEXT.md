# Phase 6: Region Capture + Visual Design + Persistent Pins - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers three integrated capabilities on top of the Phase 4/5 note pipeline:

1. **Region Capture (CAM-01→06)** — a 📷 camera tool on every note (free + element) that drag-marquees a DPR-correct region crop and attaches multiple deletable thumbnails (`+1.png`, `+2.png`, …), reusing the existing `lib/capture.ts` trio + `interactjs`.
2. **Visual Design (UI-01→04)** — the full paper-aesthetic sticky-note look inside shadow-DOM isolation: warm paper cards, smooth drag, mode-coded header strips, styled toasts, no CSS bleed.
3. **Persistent Pins (PIN-01→06, HOST-14/15/16)** — every note left on a page reappears as a clickable on-page pin, **rehydrated from the notes on disk** via a new host read endpoint, that can be viewed, edited (overwrite in place), or deleted (file + screenshots). A review becomes a durable, revisitable map of pending feedback.

**Combined scope was an explicit user decision** (the three were candidates for separate phases; the user chose to do them together as Phase 6).

**Out of scope:** cloud sync, multi-user, full-page scrolling capture (FUT-02), shadow-DOM deep traversal (FUT-03), lightbox thumbnail preview (FUT-05).
</domain>

<decisions>
## Implementation Decisions

### Pin Data Source & Scoping
- **D-01:** Pins are sourced from **the notes on disk** — a new host `GET /annotations?url=<page-url>` reads `selector`, `rect`, `mode`, `status`, `text`, and screenshot paths from each `.md`'s YAML frontmatter. Files are the single source of truth: pins survive a browser/extension reset, and an agent renaming a note to `*.read.md` is reflected. **Not** chrome.storage (would drift from disk).
- **D-02:** Pin scoping is by **exact URL path**, query string **ignored** (`/admin/users` matches regardless of `?tab=`). Avoids piling unrelated SPA-route pins onto every view, without being brittle to query changes.
- **D-03:** This requires note frontmatter to carry `url`, `mode`, `status`, and (for element notes) `selector` + page-absolute `rect`, and (for free notes) the stored viewport coords. Planner must confirm/extend the frontmatter written by HOST-07/ELEM-09 so `GET /annotations` can reconstruct every pin. (ELEM notes already capture selector + rect; free notes need viewport coords persisted.)

### Edit / Delete Semantics (Host CRUD)
- **D-04:** **Edit = overwrite in place.** `PUT /annotation/<serial>` rewrites the same serial file's body, preserving frontmatter + screenshots. Editing a note already renamed `*.read.md` **re-marks it `unread`** (you changed it). The pin is one living note you refine — not an append log.
- **D-05:** **Delete = hard delete.** `DELETE /annotation/<serial>` removes the `<serial>-*.md` **and** its `+N.png` screenshots. Keeps `notes/` tidy; guarded by a confirm dialog in the card. No soft-delete/trash (would leave residue the review-notes skill must learn to ignore).
- **D-06:** **Note id = the leading serial** (e.g. `0003`). Host routes `PUT`/`DELETE /annotation/<serial>` and resolves serial → file via glob `<serial>-*.md`, keeping the timestamped filename and surviving any future `*.read.md` rename. The pin carries the serial it was built from. Both verbs are **token-gated and path-confined** exactly like `POST /annotation` (reuse `security.ts`); 12 MB cap on PUT bodies; 404 when the serial doesn't resolve.

### Orphaned-Pin Fallback (Reliability)
- **D-07:** When a pin's stored `@medv/finder` selector matches **nothing** on review-entry (element removed, route changed, DOM rewritten), render the pin **greyed/dashed at its last-known page-absolute rect** with a tooltip ("element not found on this page"). The note is **never hidden** — it stays readable/editable/deletable. Upholds the project invariant: a note is never silently lost. **No heuristic re-anchoring** (risks attaching to the wrong element — worse than showing greyed).

### Pin Scope & Visual
- **D-08:** **Both** element-notes and free-notes get persistent pins. Element pins **anchor to the stored selector** and reposition on scroll/resize; free pins **float at the stored viewport coords** (page-level — they have no anchor to lose, always shown on the matching URL).
- **D-09:** Pins **color-code by mode** (element vs free — same header colors as the cards, UI-03) and carry an **unread/read dot** (read = `*.read.md`). **Hover → preview** of the note text. Exact pin styling can be refined in the UI-SPEC, but the encoding (mode color + read-state + hover preview) is locked.

### Claude's Discretion
- Exact pin glyph/size/badge treatment, scrim opacity, marquee min-drag threshold (CAM-03 already names ~6px), thumbnail strip layout, and reposition throttling — implementation/UI-SPEC choices, not user-locked.
- Whether pin rehydration fetches once on review-entry or also re-syncs after each Send — planner's call (must at minimum reflect a just-sent note as a new pin).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` § "Phase 6: Region Capture + Visual Design + Persistent Pins" — goal, 6 success criteria, locked-decisions block
- `.planning/REQUIREMENTS.md` — CAM-01→06, UI-01→04, PIN-01→06, HOST-14/15/16 (the authoritative requirement text)

### Reusable capture + UI assets (Phases 4–5)
- `lib/capture.ts` — `captureTab`, `waitTwoRafs`, `cropToRect` / `computeCropCoords` (DPR-correct crop trio; region marquee builds directly on this)
- `lib/highlight-draw.ts` — `drawHighlightBox` (canvas draw pattern, mirror for any pin/region overlay drawing)
- `lib/element-context.ts` — `captureElementContext` (selector + rect already captured for element notes → feeds pin frontmatter)
- `entrypoints/review.content/card.ts` — `openCard` (free) / `openElementCard` (element) + Send pipeline; the edit/delete card reuses this surface
- `entrypoints/review.content/picker.ts` — shadow-host exclusion pattern (`container.getRootNode().host`); pin click handlers must apply the same guard
- `entrypoints/review.content/index.ts` — `createShadowRootUi` mount + onMount/onRemove lifecycle; pins mount/teardown here
- `entrypoints/review.content/toast.ts`, `fab.ts`, `chip.ts` — existing shadow-DOM UI vocabulary the camera tool + pins must visually match

### Host CRUD (extend, don't fork)
- `host/src/server.ts` (lines ~147–182) — `createHostServer` route table (`OPTIONS` / `GET /status` / `POST /annotation` / 404). Add `GET /annotations`, `PUT /annotation/<serial>`, `DELETE /annotation/<serial>` here.
- `host/src/security.ts` — token check + path-traversal confinement (reuse verbatim for the new verbs — no new auth surface)
- `host/src/write-note.ts` — frontmatter serialization (`yaml`) + serial→file naming; PUT/DELETE/GET resolve files the same way
- `host/src/serial.ts` — serial mutex (read-only relevant: PUT/DELETE must not disturb serial assignment)

### Security & validation precedent
- `.planning/phases/05-element-note-mode-rich-context-capture/05-SECURITY.md` — STRIDE register style + project invariants (SW sole HTTP client; origin/tabId never trusted from message body; textContent-only DOM; 127.0.0.1 bind). Phase 6 threat model must extend these to the new CRUD verbs (IDOR on serial, path-confinement on PUT/DELETE).
- `.planning/phases/05-element-note-mode-rich-context-capture/05-VALIDATION.md` — `node:test` pattern for pure lib (pin-position math, URL-path matcher, serial resolver are unit-testable; live pin rendering is Chrome UAT).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`lib/capture.ts` trio**: region marquee = drag rect (interactjs) → hide own-UI → `waitTwoRafs` → `captureTab` → `cropToRect` (DPR-corrected). Identical sequence to the element-note `+1.png` path in `card.ts` (D-02a) — region capture is mostly composition of proven parts.
- **`@medv/finder` selector + rect** already captured per element note (ELEM-02/04) → directly reusable as the pin anchor; no new capture work for element pins.
- **Card surface (`card.ts`)**: the view/edit/delete card reuses `openElementCard`/`openCard` layout + the toast adapter + the Send pipeline (swap POST for PUT/DELETE).
- **Host `security.ts`**: token + path confinement is already centralized — the new CRUD verbs wrap the same helpers, keeping one auth surface.

### Established Patterns
- **SW is the sole privileged HTTP client** (background.ts): the new `GET /annotations`, `PUT`, `DELETE` calls MUST route through the SW relay (new `SFX_MSG` types), never fetched from the content script. Origin/tabId never trusted from the message body (IDOR guard precedent at background.ts SW handler).
- **Page-derived strings → DOM via `textContent` only** (never innerHTML) — pin tooltips/previews must follow this (note text is page-author-influenced).
- **Shadow-host exclusion** (`picker.ts`): pin elements live in the shadow root; any hit-testing/click logic must exclude the sfx host via `getRootNode().host`.
- **Append-only serials** (`serial.ts`): PUT/DELETE operate on existing serials and must NOT perturb the next-serial counter. Edit is overwrite-in-place (D-04), not a new serial.
- **`node:test` for pure lib** (`tsconfig.lib.json` / `npm run test:lib`): URL-path matcher, serial→file resolver, pin-position math are pure and unit-testable; no top-level chrome/document/window in lib modules.

### Integration Points
- `host/src/server.ts` route table — three new routes.
- `background.ts` onMessage switch — new SW relay handlers for list/edit/delete (mirror `handleSendAnnotation` / `handleAddHost`).
- `entrypoints/review.content/index.ts` onMount — rehydrate + mount pins after tabId resolves; teardown in onRemove.
- Note frontmatter (write-note.ts) — ensure `url`, `mode`, `status`, `selector`, `rect`, viewport coords are persisted for `GET /annotations` to reconstruct pins (D-03).
</code_context>

<specifics>
## Specific Ideas

- Original user framing (request 5): *"after I select an item on the page and send a note, leave a small note icon next to that part of the screen, so the user will know that a note is attached to it and he will be able to click on the note and add/edit/delete that note."* — pins are the durable, revisitable layer over the existing capture loop.
- Pins should make a review feel like a **map of pending feedback** that persists across sessions because it's backed by the files on disk, not ephemeral state.
</specifics>

<deferred>
## Deferred Ideas

- **Full-page scrolling region capture** — FUT-02 (v2).
- **Lightbox preview on thumbnail/pin click** — FUT-05 (v2); v1 hover-preview is text-only.
- **Heuristic re-anchoring of orphaned pins** (testId/text fallback) — explicitly rejected for v1 (D-07); could revisit if greyed-pin UX proves insufficient.
- **Pin clustering / off-screen indicators** when many pins overlap — not raised as needed; future polish.

*Discussion otherwise stayed within phase scope.*
</deferred>

---

*Phase: 6-region-capture-visual-design*
*Context gathered: 2026-06-03*
