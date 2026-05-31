# Project Research Summary

**Project:** stickyfix
**Domain:** Chrome MV3 extension + localhost Node host -- developer-facing, AI-agent-oriented on-page annotation tool
**Researched:** 2026-05-31
**Confidence:** HIGH

## Executive Summary

stickyfix is a local-first developer tool built from two halves: a Chrome MV3 extension that injects a shadow-DOM annotation UI on demand, and a per-project Node HTTP host that owns the filesystem contract. Notes dropped on any live web page become ordered, context-rich markdown files in the project's `notes/` directory, readable by any AI coding agent that can open files. The product sits in a sparse competitive category -- no existing tool combines durable file-on-disk output, rich element context (React fiber, computed styles, outerHTML, dataset, aria), a serial read/unread queue, and multi-project routing into a single zero-account, zero-cloud package. The closest precedent, `JodusNodus/opencode-chrome-annotation`, is GPL-3.0; stickyfix is a clean-room MIT build that replaces its fragile selector heuristic with `@medv/finder` and its OpenCode-specific transport with a generic localhost HTTP contract.

The single most important architectural finding is that Chrome 142's Local Network Access policy (LNA) and the MV3 content-script CORS model together prohibit content scripts from fetching `127.0.0.1` directly. All localhost communication must flow through the service worker, which holds `host_permissions` and is exempt from both LNA and page-origin CORS. This shapes the entire message topology: content script is UI-only, service worker is the sole HTTP client, and `captureVisibleTab` is also called from the service worker (it requires the `tabs` permission the content script does not have). Establishing this boundary early -- and proving it with a dummy POST relay in M3 -- prevents the most likely late-breaking architectural breakage.

The three other risks that compound quickly if deferred: (1) the service worker is ephemeral and evicted after ~30 s of idle -- every piece of state (host registry, tokens, origin map) must live in `chrome.storage.local`, never in module-level variables; (2) serial assignment in the host needs an explicit in-process promise-queue mutex -- two simultaneous Sends will otherwise collide and overwrite; (3) GPL clean-room hygiene is a hard invariant from the first commit, not a pre-release checklist item -- `sfx-*` identifiers, `@medv/finder` for selectors, and zero reference to upstream code are non-negotiable from M1.

---

## Key Findings

### Recommended Stack

The extension is built with **WXT 0.20.x** (Vite-based, cross-platform, `createShadowRootUi`, on-demand injection) and TypeScript 6 (strict defaults, `types:["chrome"]` must be listed explicitly). The UI inside the shadow root is vanilla DOM -- no React or Vue -- which keeps the injected content script small and avoids framework-in-shadow-root complexity. WXT's `cssInjectionMode: 'ui'` scopes all styles into the shadow root automatically; use `px` units only (WXT's `all: initial` reset makes `rem` relative to the browser default, not the host page).

The host is zero-runtime-dependency except for **`yaml` (eemeli) 2.9.x** for frontmatter serialization -- hand-rolled YAML breaks silently on URLs and titles containing `:` or `"`. All Node built-ins (`http`, `fs`, `crypto`, `path`, `util.parseArgs`) cover the rest. The host is bundled to a single `dist/host/index.js` with **esbuild 0.28.x** (`--platform=node --format=esm --bundle --external:node:*`).

**Core technologies:**
- **WXT 0.20.26**: Extension framework -- only cross-platform MV3 framework with shadow-root UI, on-demand injection, and HMR; Plasmo is maintenance-mode, CRXJS lacks runtime features
- **TypeScript 6.0.3**: Language for both halves -- TS 6 strict defaults; add `"types": ["chrome"]` to extension tsconfig explicitly
- **`@medv/finder` 4.0.2**: Unique CSS selector generation -- MIT, 1.5 kB gzipped, TypeScript-native, pure ESM; also the clean-room separator from the GPL upstream's fragile hand-rolled heuristic
- **`interactjs` 1.10.27**: Drag for post-it, FAB, and camera marquee -- correct npm name is `interactjs` (not `interact.js`, not `@interactjs/interact`); ships its own TS types
- **`yaml` (eemeli) 2.9.0**: YAML frontmatter for the host -- ISC license; `import { stringify } from 'yaml'`
- **esbuild 0.28.0**: Host bundler -- 45x faster than `tsc` emit; does not type-check (keep `tsc --noEmit` separate)
- **Node 20 LTS built-ins**: Host runtime -- `http`, `fs`, `crypto`, `path`, `util.parseArgs`; zero additional deps
- **Pre-sized PNGs (icon-16/32/48/128.png)**: Icon strategy -- skip `@wxt-dev/auto-icons`/`sharp` which pulls native binaries and breaks offline CI; commit four PNGs to `public/` and WXT auto-discovers them

**What to avoid:** `html2canvas`, `modern-screenshot` (wrong pixels, CSP violations), `@interactjs/interact` (internal sub-package), `interact.js` hyphenated (stale at 1.2.8), `sips` (macOS-only), Bun (Windows second-class), static `content_scripts` in manifest (footprint violation), `moduleResolution: node` or `classic` (removed in TS 6).

### Expected Features

**Must have (table stakes) -- M1 through M8:**
- Review Mode toggle with host discovery and connection chip -- the entry gate to everything
- Free-floating note (draggable FAB -> post-it -> Send -> `.md` on disk)
- Element picker with `@medv/finder` selector, hover highlight
- Token auth (`X-Stickyfix-Token`) and visible error toasts on every failure -- no silent drops
- Serial file naming (`NNNN-YYYYMMDD-HHmmss.md`) and `.read.md` rename marker
- Multi-project routing by tab origin with `chrome.storage.local` persistence
- Auto element-highlight screenshot on element Send (DPR-correct crop, own UI hidden first)
- Camera tool (drag-marquee region capture, DPR-correct canvas crop, deletable thumbnails)
- `review-notes` AI skill shipped in the repo
- Polished sticky-note UI inside shadow DOM isolation

**Should have (differentiators -- also in v1):**
- Rich element context: React fiber component name (`__reactFiber` walk), curated computed styles (~20 props), outerHTML (truncated 2000c), `dataset`, `aria-*`, `nearestTestId`
- File-on-disk as the output contract (ordered `.md` files, not ephemeral push)
- Multi-project routing by tab origin with zero per-note picks
- Polished paper-aesthetic sticky-note UI (design-conscious for a visual review tool)

**Defer to v1.x:**
- Keyboard shortcuts for tool switching
- Thumbnail lightbox preview in post-it
- `<meta name="stickyfix-project">` same-origin collision self-id
- `npm publish` for `stickyfix-host`

**Defer to v2+:**
- Firefox port (validate Chrome user base first)
- Shadow DOM deep traversal for selectors
- Watch mode for `review-notes` (auto-process on file creation)

### Architecture Approach

The system has three layers: (1) the Chrome extension (service worker + content script + popup), (2) the Node localhost host (one per project, port range 39240-39260), and (3) the AI agent reading files. The service worker is the sole HTTP client -- it handles host discovery (parallel probe of all 21 ports), origin-to-host routing, and all `fetch()` to localhost. The content script is UI-only: it renders the shadow-DOM overlay, handles user input, sends structured messages to the SW, and crops screenshots on canvas after the SW provides the raw `captureVisibleTab` dataUrl. All state lives in `chrome.storage.local` (never SW module-level variables) to survive the 30-second idle eviction cycle. The host uses an in-process promise-queue mutex to serialize serial assignment, binds exclusively to `127.0.0.1`, validates token with `crypto.timingSafeEqual`, and enforces path containment with a `startsWith(notesDir + sep)` assertion before every write.

**Major components:**
1. **Service Worker** (`background.ts`) -- host discovery, origin routing, `chrome.storage.local` R/W, all localhost `fetch()`, `captureVisibleTab`
2. **Content Script** (`review.content/`) -- shadow-DOM UI (chip, FAB, post-it, picker, camera), canvas crop, message relay to SW
3. **Popup** (`popup/`) -- token entry, host list, Review Mode toggle, one-time origin->project picker
4. **stickyfix-host** (`host/`) -- HTTP server, token validation, serial mutex, `.md` + `.png` write, path safety
5. **review-notes skill** (`skill/`) -- glob `notes/*.md`, exclude `.read.md`, sort by serial, process, rename

**Canonical message flow:**



**Screenshot sequencing:**



### Critical Pitfalls

1. **LNA + CORS blocks content-script fetch to localhost (Chrome 142)** -- Route ALL localhost fetches through the service worker. Content script sends messages; SW owns `fetch()`. Enforce this boundary from M2/M3 and verify by testing from an HTTPS page origin. The service worker's `host_permissions: ["http://127.0.0.1/*"]` grants exempt it from LNA; content scripts inherit the page's network privilege and do not.

2. **Service-worker state wiped on idle eviction** -- Store everything (host registry, tokens, origin map) in `chrome.storage.local`. Read from storage at the entry point of every event handler. Module-level variables are valid only as ephemeral write-through caches. Verify by letting the SW idle for 5 minutes, then Send a note.

3. **`captureVisibleTab` permission context mismatch** -- Declare `optional_host_permissions: ["<all_urls>"]` and request it via `chrome.permissions.request` at Review Mode entry. Without this, `captureVisibleTab` called from a message relay (not a direct user-gesture event) returns `undefined`. Test on a fresh Chrome profile with no prior grants in M4.

4. **DPR crop misalignment on HiDPI / Windows scaled displays** -- Multiply every `getBoundingClientRect()` coordinate by `window.devicePixelRatio` before passing to `canvas.drawImage` source region. Output canvas dimensions remain CSS pixels. Write this as a reusable utility in M4; M5 and M6 inherit it. Test at DPR = 2 and DPR = 1.25.

5. **Own UI visible in captured screenshot** -- After hiding the shadow-root host, wait for two nested `requestAnimationFrame` callbacks plus a `setTimeout(fn, 0)` before calling `captureVisibleTab`. This double-rAF flush guarantees compositor drain. Never use a fixed `setTimeout(100)`. Write as a canonical utility in M4 and reuse in M5/M6.

6. **Serial assignment race under concurrent POSTs** -- Implement a single in-process promise-queue mutex in the host (a `let queue = Promise.resolve()` chain). Serial scan + file write happen inside the chained task. No file locking -- brittle on Windows. Establish in M2 with a concurrent-POST stress test.

7. **GPL->MIT clean-room hygiene** -- This is a Phase 1 invariant, not a pre-release checklist. Use `sfx-*` / `stickyfix-*` identifiers throughout. Use `@medv/finder` (not any heuristic resembling the upstream's `:nth-of-type / <=5 levels / <=2 classes` logic). Write from the PRD spec only; no developer reads the upstream source. Audit with a grep for `__opc_`, `opencode`, `JodusNodus` before any public release.

---

## Implications for Roadmap

Based on combined research, the PRD's M1-M8 milestone structure is sound. The adjustments below sharpen phase boundaries and prevent the three highest-risk failure modes from surfacing late.

### Phase 1: Scaffold + Clean-Room Foundation (M1)
**Rationale:** Every downstream build depends on a correct cross-platform scaffold with the right identifier namespace. Windows build failures and GPL hygiene violations discovered after M3 are expensive to fix.
**Delivers:** `npm run build` produces a loadable extension and runnable host bundle on Windows. WXT initialized, tsconfigs correct (TS 6 `types:["chrome"]`, `moduleResolution: bundler` for extension, `nodenext` for host), folder layout matching the recommended project structure, `sfx-*` identifier namespace established, pre-sized PNG icons committed, no `sips`/Bun/`rm -rf` in scripts.
**Addresses:** Cross-platform build (Pitfall 12), GPL namespace (Pitfall 13), TS 6 `types: []` default (Stack finding)
**Avoids:** Icon generation with `@wxt-dev/auto-icons`/`sharp`; Unix-only shell scripts

### Phase 2: Host MVP -- Serial, Security, CORS (M2)
**Rationale:** The host is the critical path. The extension in M3 needs a live host to verify routing. All host security invariants (serial mutex, path containment, token auth, CORS preflights, LNA header) must be correct before any cross-origin test.
**Delivers:** `GET /status` + `POST /annotation` on 127.0.0.1, port-range binding with `EADDRINUSE` retry, in-process serial promise-queue mutex, `.md` + `.png` write, `crypto.timingSafeEqual` token validation, path containment assert, 12 MB body cap, full CORS headers including `OPTIONS` handler and `Access-Control-Allow-Private-Network: true`, `yaml` frontmatter. Unit tests: concurrent POST (serial atomicity), path traversal rejection, token rejection.
**Uses:** `yaml` 2.9.x, esbuild 0.28.x, Node built-ins
**Avoids:** `0.0.0.0` bind, `===` token comparison, sequential port probe, path.join without containment check

### Phase 3: Extension Skeleton + SW-as-HTTP-Client Proof (M3)
**Rationale:** Riskiest milestone -- most new MV3 concepts at once (SW ephemerality, LNA routing rule, `optional_host_permissions` request, shadow-root injection, `chrome.storage.local` as sole state store). Validating the SW->host fetch relay with a dummy POST in M3 de-risks the entire architecture. Discovering the CORS/LNA block in M4 would require significant refactoring.
**Delivers:** Popup with token entry and Review Mode toggle; SW host discovery (parallel `Promise.all` probe of all 21 ports); `chrome.storage.local` as sole state store (hostRegistry, tokens, originMap); multi-host routing by tab origin with one-time origin->project picker; on-demand content-script injection via `chrome.scripting.executeScript`; connection chip in shadow DOM; **dummy SEND_ANNOTATION message path proven end-to-end** (CS -> SW -> host POST -> toast); `optional_host_permissions` request at Review Mode entry.
**Implements:** SW-as-HTTP-Client pattern (Architecture finding), storage-as-SSOT pattern, on-demand injection pattern
**Avoids:** Module-level SW state, sequential port probing (>200ms UX penalty), content-script fetch to localhost, static content_scripts in manifest

### Phase 4: Free-Note Mode + Capture Utilities Trilogy (M4)
**Rationale:** Proves the full user-facing note flow. Establishes the three reusable capture utilities (DPR-correct crop, double-rAF flush, `captureVisibleTab` relay) that M5 and M6 will inherit. Correctness of these utilities must be established here -- retrofitting them in M6 creates regression risk.
**Delivers:** Draggable `+` FAB, post-it card (textarea, Send, Cancel), full SW fetch relay for real annotation POSTs, success/error toasts, `captureVisibleTab` relay from SW, DPR-correct canvas crop utility, double-rAF own-UI flush utility, camera tool skeleton with at least one manual region capture per free note.
**Addresses:** Capture correctness trio (Pitfalls 3, 4, 5) as reusable utilities
**Implements:** `interactjs` for drag (shadow DOM `context` option required -- pass `shadowRoot`, not `document`)

### Phase 5: Element-Note Mode + Rich Context Capture (M5)
**Rationale:** The primary differentiator. Depends on M4's note card and capture pipeline being stable. React fiber detection and `@medv/finder` integration are independent of the camera tool but depend on a working post-it flow.
**Delivers:** Picker overlay with cursor-following highlight box, `@medv/finder` CSS selector (run at click time, not page-load), React fiber walk for component display name, curated computed styles (~20 props), outerHTML (2000c), `getBoundingClientRect`, `dataset`, `aria-*`, `innerText` (1000c), `nearestTestId`; auto element-highlight screenshot (+1) captured WITH highlight visible before UI hide; richer `.md` including full element context section.
**Addresses:** React fiber capture (MEDIUM confidence -- plan for graceful degradation), `@medv/finder` run-at-click-time for dynamic React apps
**Avoids:** Running `@medv/finder` on shadow DOM elements (unsupported; note NG5 limitation)

### Phase 6: Region Capture + Visual Design Pass (M6)
**Rationale:** Camera tool completes the screenshot feature set. Visual design deferred until feature set is stable -- premature polish creates rework. `interactjs` marquee drag inside shadow DOM needs careful integration; doing it after the note card drag is proven in M4 reduces discovery risk.
**Delivers:** Camera tool (drag marquee scrim, `interactjs` marquee inside shadow DOM `context`, DPR-correct crop reusing M4 utility, +N.png naming, deletable thumbnails), full paper aesthetic (sticky-note visual design, mode color-coding, smooth drag, shadow DOM `:host { all: initial }` reset, z-index 2147483647), visual consistency test across Tailwind and CSS-reset-heavy host pages.
**Addresses:** `interactjs` in shadow DOM context option, CSS bleed `:host` reset (Pitfall 8)
**Risk:** MEDIUM -- interact.js drag-marquee integration with shadow DOM needs explicit testing

### Phase 7: review-notes AI Skill + Docs (M7)
**Rationale:** Skill can only be written correctly after the note file format (from M5) and naming convention are stable.
**Delivers:** `skill/SKILL.md` (portable agent skill: glob notes, exclude .read.md, sort by serial, process, rename), `skill/README.md` (install instructions), `CLEAN-ROOM.md` documenting the clean-room process, demo GIF.
**Addresses:** `review-notes` serial/glob contract, clean-room documentation requirement (Pitfall 13)

### Phase 8: Hardening + Pre-Release Audit (M8)
**Delivers:** Error toasts on every failure path (mid-flight SW death, host timeout, 413 body cap, 401 mismatch), multi-note stress test (concurrent Sends, serial atomicity), large-screenshot near-12MB POST test, idle-eviction regression test (5-minute idle then Send), GPL clean-room grep audit (`__opc_`, `opencode`, `JodusNodus`, upstream selector constants), "Looks Done But Isn't" checklist from PITFALLS.md fully checked.

### Phase Ordering Rationale

- M1 before everything: identifier namespace and cross-platform build are foundational -- GPL and Windows violations discovered later cost 5x more to fix.
- M2 before M3: the extension's routing code needs a live host to verify; host security invariants must be correct before any cross-origin test.
- M3's dummy POST relay is the key deviation from naive ordering: proving SW->host fetch before building the full UI avoids the LNA/CORS block surfacing as a M4 surprise.
- M4 establishes the capture utilities trilogy: DPR crop + double-rAF flush + captureVisibleTab relay are canonical and shared; M5 and M6 inherit, not re-implement.
- M6 visual design deferred until feature set is stable: premature polish creates rework when the post-it card changes shape.
- M7 after M5: skill depends on final note file format; writing it against a draft format guarantees breakage.

### Research Flags

Phases needing extra care during planning:
- **M3 (Extension Skeleton):** Highest-risk milestone. The SW->host fetch relay dummy proof and `optional_host_permissions` flow need explicit planning. Recommend a planning research pass on MV3 message architecture before coding.
- **M6 (Region Capture):** `interactjs` drag-marquee inside a shadow DOM `context` is not extensively documented; plan for iteration. DPR-correct crop reuse from M4 must be verified on the marquee path specifically.
- **M5 (React Fiber):** React fiber property names are internal APIs (MEDIUM confidence). Plan for graceful degradation if detection fails -- omit `reactComponent` from the note rather than erroring.

Phases with standard patterns (lower planning risk):
- **M2 (Host MVP):** Node HTTP server patterns are well-documented. Serial mutex and path safety patterns are standard and testable.
- **M4 (Free-Note + Capture):** Shadow-root UI injection and `captureVisibleTab` relay are covered in Chrome docs and WXT guides.
- **M7 (Skill + Docs):** Writing a markdown skill file is a documentation task; no novel technology.
- **M8 (Hardening):** Verification against the "Looks Done But Isn't" checklist in PITFALLS.md is mechanical.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm registry 2026-05-31; WXT, TS 6, interactjs, @medv/finder, yaml all confirmed. `@wxt-dev/auto-icons` explicitly avoided (sharp native binary risk). |
| Features | HIGH | Cross-validated across 8 competitor tools; table stakes and differentiators clearly separated; anti-features explicitly scoped out in PRD. |
| Architecture | HIGH | Chrome MV3 docs confirmed the CORS/LNA finding that reshapes the content-script boundary. PRD Sections 6-9 is authoritative. Message type contract and multi-project routing model are fully specified. |
| Pitfalls | HIGH | All 13 pitfalls have official source citations. LNA (Chrome 142), SW eviction, DPR crop, double-rAF flush, serial mutex, and GPL clean-room are each verified from primary sources. |

**Overall confidence:** HIGH

### Gaps to Address

- **React fiber detection (MEDIUM confidence):** Property names (`__reactFiber`) are React internals. If React removes them, component name capture silently degrades -- plan for graceful omission, not a hard error. Monitor React 20 release notes.
- **`interactjs` in shadow DOM `context` option:** Documented in interactjs API but not tested specifically in a WXT shadow-root context. Budget exploration time in M6 planning.
- **`optional_host_permissions` UX flow:** The one-time `chrome.permissions.request` for `<all_urls>` at Review Mode entry is correct, but the exact permission prompt UX should be prototyped in M3 before committing to it.
- **LNA `Access-Control-Allow-Private-Network` header effectiveness:** Chrome's LNA enforcement evolves. The SW relay path bypasses LNA entirely (recommended); the ACAPN header on the host is defense-in-depth only. Keep the SW relay as the canonical path.
- **Windows 125% DPR (fractional) crop correctness:** Fractional DPR (1.25) requires `Math.round` after multiplication to avoid sub-pixel canvas errors. Must be tested on the developer's actual Windows machine in M4.

---

## Sources

### Primary (HIGH confidence)
- npm registry (2026-05-31) -- all pinned versions: wxt@0.20.26, @medv/finder@4.0.2, interactjs@1.10.27, yaml@2.9.0, esbuild@0.28.0, typescript@6.0.3
- https://wxt.dev/guide/key-concepts/content-script-ui.html -- createShadowRootUi API, cssInjectionMode, isolateEvents, overlay position
- https://developer.chrome.com/docs/extensions/develop/concepts/network-requests -- MV3 fetch, CORS, content-script restrictions
- https://developer.chrome.com/blog/local-network-access -- Chrome 142 LNA policy and extension exemptions
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle -- SW eviction, ephemerality
- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ -- TS 6 breaking changes (types:[], moduleResolution:classic removed)
- https://github.com/antonmedv/finder -- @medv/finder v4.0.2 API, no shadow DOM support caveat
- PRD.md Sections 6-15 + Appendix A -- authoritative project spec and architecture blueprint

### Secondary (MEDIUM confidence)
- https://redreamality.com/blog/the-2025-state-of-browser-extension-frameworks-a-comparative-analysis-of-plasmo-wxt-and-crxjs/ -- WXT vs Plasmo vs CRXJS 2025
- React DevTools source + community references -- `__reactFiber` / `__reactInternalInstance$` property names (internal API, not officially documented)
- note8.dev/blog/visual-feedback-tools-comparison -- competitor feature matrix
- Competitor sites: Marker.io, BugHerd, Vercel Comments, Vibe Annotations, Userback, AgentEcho, opencode-chrome-annotation

### Tertiary (LOW confidence)
- Heather Meeker, Simon Willison (2026) -- AI clean-room legal landscape (chardet controversy); unsettled law, mitigation via two-engineer process is the practical approach

---
*Research completed: 2026-05-31*
*Ready for roadmap: yes*
