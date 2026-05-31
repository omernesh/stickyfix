# Architecture Research

**Domain:** Chrome MV3 extension + localhost Node companion host (filesystem-contract annotation tool)
**Researched:** 2026-05-31
**Confidence:** HIGH (PRD is authoritative; Chrome docs verified; key CORS finding corrects a subtle PRD assumption)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CHROME (host browser)                                                    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │  Extension (MV3)                                                │     │
│  │                                                                 │     │
│  │  ┌─────────────────┐   chrome.runtime   ┌────────────────────┐ │     │
│  │  │ Service Worker   │◄──────────────────►│ Popup              │ │     │
│  │  │ (background.ts)  │  (sendMessage)     │ (popup/main.ts)    │ │     │
│  │  │                  │                   │ - token entry      │ │     │
│  │  │ - host discovery │                   │ - host list        │ │     │
│  │  │ - port scanning  │                   │ - review toggle    │ │     │
│  │  │ - origin routing │                   └────────────────────┘ │     │
│  │  │ - POST relay     │                                          │     │
│  │  │ - storage R/W    │   chrome.runtime   ┌────────────────────┐ │     │
│  │  │                  │◄──────────────────►│ Content Script     │ │     │
│  │  └─────────────────┘  (sendMessage /     │ (review.content/)  │ │     │
│  │          │             tabs.sendMessage) │ in Shadow DOM      │ │     │
│  │          │                              │ - connection chip  │ │     │
│  │          │ fetch()                      │ - + free-note FAB  │ │     │
│  │          │ (service worker is the       │ - element picker   │ │     │
│  │          │  HTTP client, not the        │ - camera region    │ │     │
│  │          │  content script)             │ - post-it UI       │ │     │
│  │          │                              └────────────────────┘ │     │
│  └──────────┼──────────────────────────────────────────────────────┘     │
│             │                                                             │
│  chrome.storage.local (persists across SW recycles + Chrome restarts)    │
│  { hostRegistry, tokens, originMap, prefs }                              │
└──────────────────────────────────────────────────────────────────────────┘
             │
             │ HTTP POST /annotation + GET /status
             │ (127.0.0.1 only)
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  stickyfix-host (Node HTTP server, per project)                         │
│                                                                         │
│  port: first free in 39240..39260                                       │
│  GET /status  → { app, name, origins, notesDir, version }              │
│  POST /annotation  → validate token → assign serial → write .md + .png │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ notes/ (--root/<notesDir>)                                       │   │
│  │  0001-20260531-143022.md                                         │   │
│  │  0001-20260531-143022+1.png  (element highlight)                 │   │
│  │  0001-20260531-143022+2.png  (manual region)                     │   │
│  │  0002-20260531-143105.md                                         │   │
│  │  0002-20260531-143105.read.md  (renamed by review-notes skill)   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
             ▲
             │ reads notes/*.md, renames → *.read.md
             │
┌────────────────────────────────────────────┐
│  AI Agent (Claude Code, etc.)              │
│  review-notes skill (SKILL.md)             │
└────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | Boundary |
|-----------|---------------|----------|
| **Service Worker** (`background.ts`) | Host discovery (port scan 39240-39260), origin-to-host routing, `chrome.storage.local` R/W, HTTP client for all `fetch()` to localhost, tab event listeners | Only context that can make cross-origin fetch to 127.0.0.1 without CORS restriction (has host_permissions; service worker origin bypasses CORS) |
| **Content Script** (`review.content/`) | UI rendering inside Shadow DOM, user interaction (drag, pick, type), screenshot capture (`chrome.tabs.captureVisibleTab` via SW relay), canvas crop, message relay to SW | Never fetches to localhost directly — sends structured messages to SW |
| **Popup** (`popup/`) | Token entry per host, host list display, Review Mode toggle, one-time origin→project picker | UI only; reads/writes storage via `chrome.storage.local` or delegates to SW |
| **stickyfix-host** | HTTP server on 127.0.0.1, token validation, serial assignment (in-process mutex), `.md` write, `.png` write, path safety, CORS headers | Writes only inside `--root/notes/`; no outbound network; single Node process per project |
| **review-notes skill** | Glob `notes/*.md`, exclude `*.read.md`, sort by serial, process each, rename to `*.read.md` | Read-only agent skill shipped in repo; runs in the consuming project's AI session |

---

## Critical Architectural Finding: CORS and Fetch Routing

**The PRD's architecture diagram implies the content script posts directly to the host. This is incorrect for the default MV3 security model.**

Chrome content scripts are subject to the same-origin policy of the *injected page's* origin, not the extension's origin. A content script injected into `https://app.chatlytics.ai` cannot fetch `http://127.0.0.1:39240/annotation` even with the extension's `host_permissions` — the fetch is treated as a cross-origin request from the page's origin and is subject to CORS.

**Confirmed resolution (two options):**

**Option A (recommended — used by upstream GPL project):** Route all localhost fetches through the **service worker**. The content script sends a `chrome.runtime.sendMessage` to the SW with the annotation payload; the SW does the `fetch()` to `http://127.0.0.1:<port>/annotation`. The SW has the extension's origin (not the page's), so `host_permissions` grants it unrestricted access to localhost. No CORS headers needed on the host for this path. This is architecturally cleaner — the SW is the single HTTP client.

**Option B (also works, but adds complexity):** The host echoes the request `Origin` in `Access-Control-Allow-Origin` and allows `X-Stickyfix-Token`. The content script sets the token header and posts directly. This requires the host to correctly handle OPTIONS preflights and works only if the request origin is the page's origin. The PRD specifies this in §8.4, suggesting it as the CORS model. This works but adds a second code path and couples the host's CORS to arbitrary page origins.

**Recommendation: Use Option A (SW relay) as the primary path.** Keep the host's CORS permissive (echo origin, allow X-Stickyfix-Token) as fallback and for any future direct-fetch paths. The PRD's `host_permissions: ["http://127.0.0.1/*"]` on the SW is already correct for this.

**Impact on message flow:**
```
[Content Script] → chrome.runtime.sendMessage({type:"POST_ANNOTATION", payload}) →
[Service Worker] → fetch("http://127.0.0.1:<port>/annotation", {headers:{X-Stickyfix-Token}}) →
[Host]          → write .md → return {ok, file, serial} →
[Service Worker] → chrome.tabs.sendMessage(tabId, {type:"ANNOTATION_RESULT", ...}) →
[Content Script] → show toast
```

`captureVisibleTab` must also be called from the SW (it requires `tabs` permission, accessible from the SW). The content script sends a CAPTURE_TAB message → SW captures → returns dataUrl → content script crops on canvas.

---

## Multi-Project Routing Model (§6.1)

### Discovery Phase (on Review Mode entry, periodic refresh)

```
Service Worker wakes on "enter review mode" message from popup/content-script
    ↓
Probe ports 39240..39260 in parallel:
  GET http://127.0.0.1:<port>/status  (no token, discovery handshake)
    ↓
Collect all {app:"stickyfix", name, origins, notesDir} responses
    ↓
Merge into hostRegistry:
  { [name]: { port, origins:[], token:string|null, notesDir } }
    ↓
Persist to chrome.storage.local (survives SW recycle)
```

### Routing Phase (per Send)

```
Active tab origin (scheme://host:port) →
  (1) hostRegistry: any host with origins[] including this origin? → use it
  (2) chrome.storage.local originMap: persisted origin→hostName mapping? → use it
  (3) Page self-id: content script reads <meta name="stickyfix-project"> or
      window.__stickyfix_project → matches hostRegistry[name]? → use it
  (4) None: content script shows one-time dropdown of hostRegistry names →
      user picks → persist to originMap → done (never asked again for this origin)
```

### Re-bind after Restart

When a host restarts on a new port, its `/status` still returns the same `name`. The SW re-probes on wake and updates the registry by `name` key. The `originMap` stores `{origin → hostName}`, not `{origin → port}`, so re-binding is automatic.

### Same-Origin Collision

If two projects both serve on `:3000`, the page self-id (`<meta>` or `window.__stickyfix_project`) takes priority over the origin map. Documented as optional, rarely needed.

---

## Host Serial/Path-Safety/Security Model (§8)

### Serial Assignment

```
On POST /annotation:
  acquire in-process mutex (serial-queue)
    scan notesDir: glob NNNN-*.md + *.read.md
    parse leading 4-digit serial from each filename
    maxSerial = Math.max(...parsed) || 0
    nextSerial = maxSerial + 1
    filename = zeroPad(nextSerial, 4) + "-" + localTimestamp() + ".md"
  release mutex
  write .md
  write +N.png files (in payload order)
```

The mutex must be an in-process async queue (e.g., a promise chain) since Node's `fs` ops are async. No external locking needed — single process per project.

### Path Safety

```
--root is resolved to absolute path on startup.
notesDir = path.resolve(root, notesDir) — must stay within root.
Assert: path.resolve(notesDir).startsWith(path.resolve(root))
If assertion fails → reject with 400 / startup error.
v1: all writes go to fixed notesDir, no per-note subpath — no traversal surface.
```

### Security Model

| Control | Implementation |
|---------|---------------|
| Bind address | `server.listen(port, "127.0.0.1")` — never `0.0.0.0` |
| Token validation | `req.headers["x-stickyfix-token"] === storedToken` on POST; 401 on mismatch |
| Body size cap | Read up to 12 MB; reject with 413 if exceeded |
| CORS | Echo `req.headers.origin` in `Access-Control-Allow-Origin`; allow `X-Stickyfix-Token` in ACAH |
| No eval | Pure `fs`, `http`, `crypto`, `path` — no shelling out |
| Token storage | Written to `<root>/.stickyfix-token` on startup (gitignored); printed to console |

---

## Data Flow: Note Capture → File on Disk

### Free Note

```
1. User clicks + FAB in shadow-DOM UI (content script)
2. Post-it card opens (content script)
3. User types comment, optionally uses camera tool:
   a. Camera: content-script → SW(CAPTURE_TAB) → SW calls captureVisibleTab
      → returns dataUrl → content script crops on canvas (DPR-corrected)
      → thumbnail attached to note card
4. User clicks Send:
   a. Content script: hide own UI (scrim/card/chip) before any capture
   b. Content script: assemble payload {mode:"free", comment, page, viewport, screenshots:[...dataUrls]}
   c. chrome.runtime.sendMessage({type:"SEND_ANNOTATION", tabId, payload})
   d. SW: looks up resolved host for tab's origin (from storage)
   e. SW: fetch POST http://127.0.0.1:<port>/annotation with X-Stickyfix-Token
   f. Host: validate token, assign serial, write .md, write +N.png files
   g. Host: return {ok:true, file:"0003-20260531-143022.md", serial:3}
   h. SW: chrome.tabs.sendMessage(tabId, {type:"ANNOTATION_RESULT", ok, file})
   i. Content script: show success toast "Saved: 0003-20260531-143022.md"
5. On error at any step: content script shows error toast with reason
```

### Element Note (additional steps)

```
3. User enters pick mode (click 🎯 in toolbar)
   - Content script overlays highlight box following cursor
   - Esc cancels
4. User clicks element:
   a. Content script calls @medv/finder(el) → unique CSS selector
   b. Reads computedStyle (curated list), outerHTML (truncated 2000c),
      getBoundingClientRect, dataset, aria-*, innerText (truncated 1000c)
   c. Detects React fiber: el.__reactFiber$* walk → named component display name
   d. Finds nearest [data-testid]
   e. Assembles element capture object
   f. Pre-fills post-it textarea with compact element summary
5. On Send:
   a. SW: captureVisibleTab → extension captures viewport WITH picker highlight
      visible (highlight is part of the DOM, shows in screenshot)
      Wait — actually: the auto-highlight screenshot is taken BEFORE hiding UI,
      so the element outline IS visible in +1. Manual region crops happen AFTER
      hiding UI. Order matters:
        i.  auto-highlight shot: capture WITH highlight box shown → +1
        ii. hide stickyfix UI
        iii. manual region crops are already dataUrls on the card
        iv. payload = [...manualCrops] prepended by element-highlight dataUrl
   b. Everything else same as free note from step 4c onward
```

### Screenshot Naming Convention

```
Note base: <serial>-<YYYYMMDD-HHmmss>
Element auto-highlight:  <base>+1.png  (element mode only, from captureVisibleTab)
Manual region captures:  <base>+2.png, +3.png … (element mode)
                         <base>+1.png, +2.png … (free mode — no auto-highlight)
All land in notesDir alongside the .md
```

---

## Recommended Project Structure

```
stickyfix/
├── package.json                         # workspace root: wxt + host scripts
├── wxt.config.ts                        # manifest, host_permissions, icon gen
├── tsconfig.json                        # base TS config
│
├── entrypoints/
│   ├── background.ts                    # SW: discovery, routing, fetch relay
│   ├── popup/
│   │   ├── index.html
│   │   └── main.ts                     # token entry, host list, mode toggle
│   └── review.content/                  # on-demand shadow-root UI
│       ├── index.ts                    # mount/unmount, SW message bridge
│       ├── toolbar.ts                  # connection chip + tool buttons
│       ├── postit.ts                   # note card (textarea, send, cancel)
│       ├── element-picker.ts           # pick mode, hover highlight, capture
│       ├── region-capture.ts           # camera tool, scrim, drag marquee
│       ├── capture.ts                  # captureVisibleTab relay + canvas crop
│       ├── host-client.ts              # sendMessage wrappers to SW
│       └── styles.css                  # shadow-DOM scoped styles
│
├── lib/
│   ├── types.ts                        # shared TS types (AnnotationPayload, etc.)
│   ├── storage.ts                      # chrome.storage.local typed helpers
│   ├── routing.ts                      # origin→host resolution logic (used in SW)
│   └── serial.ts                       # serial parsing helpers (shared if needed)
│
├── public/
│   └── icon.png                        # single source; WXT generates 16/32/48/128
│
├── host/
│   └── src/
│       ├── index.ts                    # CLI entry, arg parsing (util.parseArgs)
│       ├── server.ts                   # http.createServer, routing, CORS
│       ├── write-note.ts              # .md template + yaml frontmatter
│       ├── serial.ts                   # serial scan + mutex queue
│       ├── security.ts                 # token check, path safety, body cap
│       └── config.ts                   # startup config + token file write
│
├── skill/
│   ├── SKILL.md                        # review-notes skill (AI agent reads this)
│   └── README.md                       # install instructions
│
├── notes/                              # gitkeep only (consuming project owns notes)
│   └── .gitkeep
│
└── .output/                            # WXT build output (gitignored)
    dist/host/                          # host build output (gitignored)
```

---

## Architectural Patterns

### Pattern 1: SW-as-HTTP-Client (CORS bypass)

**What:** All `fetch()` to `http://127.0.0.1` happens in the service worker, never in the content script. Content scripts send messages to SW; SW does the fetch and relays results back.

**Why:** Content scripts are subject to the same-origin policy of the injected page. Even with `host_permissions`, a content script on `https://example.com` cannot reliably fetch `http://127.0.0.1` without CORS cooperation from the host. The SW has the extension's origin and `host_permissions` grants unrestricted localhost access.

**Trade-offs:** Slightly more message hops. One async round-trip (CS → SW → host → SW → CS) adds ~1-2ms latency on localhost — imperceptible.

### Pattern 2: Storage as Single Source of Truth (ephemerality defense)

**What:** Zero state in SW global variables. All state — hostRegistry, tokens, originMap, prefs — lives in `chrome.storage.local`. SW reads from storage at the start of every event handler.

**Why:** MV3 service workers terminate after ~30s idle and can restart at any time. Any global variable is lost on termination. `chrome.storage.local` is persisted to disk by Chrome and survives SW recycles, Chrome restarts, and extension reloads.

**Implementation note:** WXT's `storage` utility (from `wxt/utils/storage`) provides typed wrappers. Use it over raw `chrome.storage.local` for compile-time type safety.

### Pattern 3: Shadow DOM UI Isolation

**What:** WXT's `createShadowRootUi` mounts the entire review UI inside a Shadow DOM attached to `document.body`. All styles are scoped.

**Why:** Prevents the host page's CSS from collapsing/hiding/reshaping the post-it cards. Also prevents the extension's CSS from leaking into the page. Essential for a design-conscious UI that must look right on any page.

**Gotcha:** WXT resets inherited styles with `all: initial` inside the shadow root, which sets `font-size` to browser default (~16px). `rem` units inside the shadow root refer to this reset size, not the page's `<html>` font size. Use `px` or `em` (relative to shadow root context) for layout-sensitive sizes.

### Pattern 4: In-Process Serial Mutex

**What:** A single async promise queue (not a lock file, not a DB) serializes all write operations in the host process.

**Why:** Two near-simultaneous POSTs (e.g., user sends two notes rapidly) could both scan the notes dir and both see max serial = 5, both write 6. A promise chain ensures they execute sequentially.

**Implementation:**
```typescript
// host/src/serial.ts
let queue: Promise<void> = Promise.resolve();

export function withSerialLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  queue = result.then(() => {}, () => {});
  return result;
}
```

### Pattern 5: On-Demand Content Script Injection

**What:** No static `content_scripts` in the manifest. The review UI is injected via `chrome.scripting.executeScript` only when the user enters Review Mode.

**Why:** Zero footprint on pages where the user hasn't activated the extension. Avoids content script overhead on every page load. Required by `optional_host_permissions` model — the extension requests page access per-origin when Review Mode is entered.

**WXT note:** WXT handles `review.content/` as a content script entrypoint that can be injected on demand. The SW calls `chrome.scripting.executeScript({target:{tabId}, files:["review.content.js"]})` when Review Mode is toggled on.

---

## Anti-Patterns

### Anti-Pattern 1: Global State in Service Worker

**What people do:** Store the host registry in a `const registry = {}` at module scope in `background.ts`.

**Why it's wrong:** SW is killed after ~30s idle. The next event arrives, SW restarts, `registry` is `{}`. First note after an idle period routes nowhere — silent failure.

**Do this instead:** Always read from `chrome.storage.local` at the start of relevant handlers. Write back on every discovery or mapping update.

### Anti-Pattern 2: Content Script Fetching Localhost Directly

**What people do:** Call `fetch("http://127.0.0.1:39241/annotation", {...})` from inside the shadow-DOM content script.

**Why it's wrong:** The fetch runs with the injected page's origin. Browsers apply CORS to the response. If the host's `Access-Control-Allow-Origin` doesn't match the exact page origin (including scheme+host+port), the fetch is blocked. Also creates two code paths for token handling.

**Do this instead:** Send the payload to the SW via `chrome.runtime.sendMessage`. SW does the fetch. One HTTP client, one code path.

### Anti-Pattern 3: Binding Host to `0.0.0.0`

**What people do:** `server.listen(port)` or `server.listen(port, "0.0.0.0")` for convenience during dev.

**Why it's wrong:** Exposes the write endpoint to every device on the LAN. Any machine on the local network that guesses the port and token can write notes to disk. Violates the privacy-first, local-only design.

**Do this instead:** Always `server.listen(port, "127.0.0.1")`.

### Anti-Pattern 4: Port as Stable Identifier

**What people do:** Store `originMap` as `{ "http://localhost:5173" → port:39241 }`.

**Why it's wrong:** When the host restarts (process killed and restarted), it may grab a different port. The stored port is stale. The extension tries the old port, gets no response, fails.

**Do this instead:** Store `originMap` as `{ origin → hostName }`. The hostName (`--name`) is stable. On every SW wake, re-probe the port range, rebuild the registry by name. Old port bindings resolve automatically.

### Anti-Pattern 5: Screenshot from Content Script DOM

**What people do:** Use `html2canvas` or `dom-to-canvas` to generate screenshots inside the content script.

**Why it's wrong:** DOM-to-canvas libs reconstruct layout from DOM + CSS, miss canvas/WebGL frames, miss fonts, and produce visually incorrect output. For a visual review tool, the screenshot fidelity matters.

**Do this instead:** `chrome.tabs.captureVisibleTab` from the service worker. Real GPU-composited PNG of the viewport. Content script can't call it directly (needs `tabs` permission). Relay via SW message.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Content Script → SW | `chrome.runtime.sendMessage` | Async; SW may be asleep and wakes on message |
| SW → Content Script | `chrome.tabs.sendMessage(tabId, ...)` | SW must know the tabId; pass from CS on initial message |
| Popup → SW | `chrome.runtime.sendMessage` | Same channel; popup is an extension page |
| SW → Storage | `chrome.storage.local.get/set` | Async; must be awaited in every handler |
| SW → Host | `fetch("http://127.0.0.1:<port>/...")` | HTTP over loopback; ~0.5ms RTT |

### Message Type Contract (CS ↔ SW)

| Message Type | Direction | Payload | Response |
|-------------|-----------|---------|----------|
| `ENTER_REVIEW_MODE` | Popup→SW | `{tabId}` | `{ok, hostName, notesDir}` or error |
| `EXIT_REVIEW_MODE` | Popup→SW | `{tabId}` | `{ok}` |
| `SEND_ANNOTATION` | CS→SW | `{tabId, payload: AnnotationPayload}` | `{ok, file, serial}` or `{ok:false, error}` |
| `CAPTURE_TAB` | CS→SW | `{windowId}` | `{dataUrl: string}` |
| `GET_ROUTING_INFO` | CS→SW | `{origin}` | `{hostName, notesDir, mapped:bool}` |
| `MAP_ORIGIN` | CS→SW | `{origin, hostName}` | `{ok}` |
| `ANNOTATION_RESULT` | SW→CS | `{ok, file, serial, error?}` | — (toast trigger) |

---

## Suggested Build Order (M1–M8 Validation)

The PRD's M1–M8 is sound. This table validates ordering rationale and flags the one adjustment:

| Milestone | What It Builds | Dependency | Confidence |
|-----------|---------------|------------|------------|
| **M1** — Repo scaffold | WXT init, tsconfig, folder layout, `npm run build` produces loadable extension + host bundle | None | HIGH |
| **M2** — Host MVP | HTTP server, port discovery, `/status`, `/annotation` → `.md` write, serial, token, CORS, path/size guards. Unit-test serial + path safety. | M1 (folder layout, tsc config) | HIGH |
| **M3** — Extension skeleton + routing | Popup, SW host discovery, Review Mode toggle, on-demand injection, connection chip, full multi-host routing with `chrome.storage.local` persistence | M2 (host must be running for E2E verification of routing) | HIGH — this is the riskiest milestone (most new MV3 concepts at once) |
| **M4** — Free-note mode | + FAB, post-it card, SW fetch relay, screenshot capture pipeline | M3 (routing must work; injection must work) | HIGH |
| **M5** — Element-note mode | Picker overlay, `@medv/finder`, full capture object, auto-highlight screenshot (+1), richer `.md` | M4 (free-note proves the full pipeline) | HIGH |
| **M6** — Region capture + visual design | Camera tool, drag marquee, DPR-correct canvas crop, +N naming, paper aesthetic, toasts | M5 (note card exists; screenshot pipeline established) | MEDIUM — interact.js drag-marquee integration needs care |
| **M7** — review-notes skill + docs | `skill/SKILL.md`, README, demo GIF | M5 (notes exist in correct format) | HIGH |
| **M8** — Hardening | Error toasts on all failure paths, multi-note stress test, large-screenshot handling | M6 (all features exist) | HIGH |

**One adjustment to PRD ordering:** M3 should explicitly prototype the SW→CS fetch relay (SEND_ANNOTATION message path) as part of the routing milestone, even if there's no UI yet. The CORS routing pattern is the biggest architectural risk; proving it early (in M3) with a dummy POST prevents discovering it broken in M4.

---

## Scaling Considerations

This is a single-developer local tool. "Scaling" means multi-project concurrency and session longevity, not user scale.

| Concern | At 1 developer, 2-3 projects | Notes |
|---------|------------------------------|-------|
| Port range | 21 ports (39240-39260) for 21 simultaneous projects | More than enough; one per project |
| Serial collision | In-process mutex handles concurrent POSTs | No issue with one user |
| Storage size | `chrome.storage.local` limit is 10MB (default) or 100MB with `unlimitedStorage` | Host registry + tokens + originMap are tiny; no risk |
| Screenshot size | 12MB POST cap; DPR-correct crops can be large on 4K | May need to monitor in M8 |
| SW idle termination | 30s idle limit | Re-discovery on wake is fast (21 probes, parallel) |

---

## Sources

- Chrome MV3 network requests and CORS: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Content script same-origin policy change (Chrome 85): https://www.chromium.org/Home/chromium-security/extension-content-script-fetches/
- Service worker lifecycle and ephemerality: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- chrome.scripting.executeScript API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- WXT shadow DOM + createShadowRootUi: https://wxt.dev/guide/essentials/content-scripts.html
- WXT messaging recommendations: https://wxt.dev/guide/essentials/messaging.html
- PRD §6, §6.1, §7.4, §7.6, §8, §9 (authoritative project specification)

---

*Architecture research for: stickyfix (Chrome MV3 extension + localhost Node host)*
*Researched: 2026-05-31*
