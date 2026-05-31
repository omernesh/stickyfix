# Pitfalls Research

**Domain:** Chrome MV3 extension + Node localhost host — on-page annotation, screenshot capture, markdown file output
**Researched:** 2026-05-31
**Confidence:** HIGH (all critical items verified against official Chrome docs, MDN, or directly observable in the GPL upstream architecture)

---

## Critical Pitfalls

### Pitfall 1: MV3 Service-Worker State Wiped on Idle Termination

**What goes wrong:**
Chrome terminates the extension service worker after ~30 seconds of inactivity (can be as short as 30 s; at most ~5 minutes with open ports). Any JavaScript variable — the host registry, the `origin → host` map, per-host tokens — is silently zeroed. The next message to the service worker re-spawns it into a blank state. The user Send succeeds from the content-script's perspective but the worker has no host to route to, so the POST never fires. Error appears as a silent routing miss — exactly what the PRD says is a regression.

**Why it happens:**
Developers coming from MV2 (persistent background pages) expect global variables to persist. The MV3 service-worker lifecycle is identical to a standard web service worker: ephemeral, event-driven, evicted.

**How to avoid:**
- Store **everything** that the service worker needs across events in `chrome.storage.local`: the entire host registry object (`{ port, name, origins, token }`), the `origin → host` map, and token entries. Never cache these in module-level variables.
- On every wake-up event (any `chrome.runtime.*` or `chrome.tabs.*` listener entry), re-read the relevant slice from `chrome.storage.local` before acting. WXT's `storage` wrapper makes this ergonomic.
- The only safe use of module-level variables in an MV3 service worker is a runtime discovery cache that is populated on demand from storage and discarded freely.
- On host re-discovery at wake, re-bind by `name + origin`, not port, so a restarted host on a new port finds its stored token automatically (PRD §7.6).

**Warning signs:**
- Notes fail silently after a period of inactivity, then resume after clicking the extension icon (which forces a wake).
- The connection chip shows a stale project name that doesn't match the currently-running host.
- Token "rejected" toasts appearing on the first Send after idle, then succeeding on retry — the retry re-reads storage but the first attempt used stale (zero) in-memory state.

**Phase to address:** M3 (extension skeleton + multi-host routing) — the moment the host registry and `origin → host` map are introduced.

---

### Pitfall 2: Chrome Local Network Access (LNA) Breaking Extension-to-Localhost Fetches

**What goes wrong:**
Chrome 142 (shipped October 2025) added a mandatory permission prompt for any page or script making a request to `127.0.0.1` / `localhost` from a public-network context. Content scripts run in the page's security context. Fetches from content scripts to `http://127.0.0.1:392xx` will trigger the LNA permission prompt or fail silently when the user declines. This is distinct from CORS — it is a browser-level block before the request even leaves the browser.

**Why it happens:**
The security model change classifies loopback as a "local network" destination and requires opt-in from the page origin for security. The extension's `host_permissions` (`http://127.0.0.1/*`) exempts the service worker and popup, but content scripts inherit the page's network privilege, which is `public`.

**How to avoid:**
- **Route all host POSTs through the service worker** (`chrome.runtime.sendMessage` from content script → service worker handles the `fetch` to localhost). The service worker has the `host_permissions` grant and is exempt from LNA because it is an extension context, not a page context.
- Do not fetch localhost directly from the injected content script. The injected review UI should only send messages to the service worker, which owns the network layer.
- The PRD's architecture (service worker is the routing/transport layer, content script is the UI layer) already points in this direction — enforce this boundary explicitly.
- On the host, still respond with `Access-Control-Allow-Private-Network: true` as defense-in-depth for any future path that might go direct.

**Warning signs:**
- `POST /annotation` works in early development (where `<all_urls>` is used or localhost is exempted in test builds) but fails on a real page origin after Chrome 142.
- Console shows "Blocked by LNA policy" or the fetch promise rejects with a network error from a content-script context.
- Works from the popup / service worker but not from the injected review UI.

**Phase to address:** M2 (host MVP) — set the architectural rule that the host HTTP client lives in the service worker. Enforce in M3 when the content-script injection is wired up.

---

### Pitfall 3: `captureVisibleTab` Permission Context Mismatch

**What goes wrong:**
`chrome.tabs.captureVisibleTab` requires either `<all_urls>` host permission OR the `activeTab` permission activated by a qualifying user gesture. In MV3, `activeTab` is only valid for the event that immediately follows a direct user interaction with the extension (toolbar click, keyboard shortcut). A message-relay from a content script to the service worker does **not** preserve the `activeTab` grant. Calling `captureVisibleTab` in response to a `runtime.onMessage` from a content script, rather than from a direct user-gesture event, returns `undefined` or an error — a silent screenshot loss.

**Why it happens:**
`activeTab` is intentionally narrow. Developers expect the permission to persist for the session or to flow through message relays, but Chrome evaluates the user-gesture grant at the precise moment of the API call.

**How to avoid:**
- The extension declares `host_permissions: ["http://127.0.0.1/*", "http://localhost/*"]` plus `optional_host_permissions: ["<all_urls>"]`. Request `<all_urls>` via `chrome.permissions.request` when the user enters Review Mode (one-time prompt per origin). With `<all_urls>` granted, `captureVisibleTab` works from the service worker unconditionally regardless of invocation path.
- Alternatively, if `<all_urls>` is refused, capture must be triggered from the extension action click handler where `activeTab` is live, not from a message relay. Design the capture flow so the service worker calls `captureVisibleTab` from the same call-stack entry that processed the user-triggered message — no async gaps where Chrome can revoke the gesture.
- Test the permission flow on a fresh Chrome profile with no prior grants. The happy path works; the permission-denied path is what breaks.

**Warning signs:**
- Screenshots return blank or the `captureVisibleTab` call returns `undefined` instead of a data URL.
- Works when clicking the extension toolbar icon but fails when triggered from the `+` FAB inside the page.
- No error toast (if the promise rejection isn't caught), appearing as a note with missing screenshot fields.

**Phase to address:** M4 (free-note mode) — first screenshot capture implementation. The `optional_host_permissions` request flow must be in M3 (Review Mode entry) so it is in place before M4 exercises capture.

---

### Pitfall 4: DPR Crop Misalignment on HiDPI Displays

**What goes wrong:**
`captureVisibleTab` returns a bitmap at device pixels (physical pixels), which on a 2x Retina or 2.5x Windows-scaled display means the PNG is 2× or 2.5× the CSS-pixel dimensions. If the crop rectangle from `getBoundingClientRect()` (in CSS pixels) is passed directly to `canvas.drawImage(img, sx, sy, sw, sh, ...)` without multiplying by `devicePixelRatio`, every coordinate is off by that factor. On a 2x display a 180×36 element crops a 90×18 region in the top-left corner of the image — wrong element, wrong area. Fractional DPR (e.g., 1.25 on Windows with 125% display scaling) causes sub-pixel rounding artifacts that appear as misaligned or clipped captures.

**Why it happens:**
`getBoundingClientRect()` returns logical (CSS) pixels; `captureVisibleTab` returns physical pixels. The conversion is trivial but only obvious if the developer tests on a non-1x display.

**How to avoid:**
- Multiply every rect coordinate by `window.devicePixelRatio` before using it as a crop source: `sx = rect.x * dpr`, `sy = rect.y * dpr`, `sw = rect.width * dpr`, `sh = rect.height * dpr`.
- The payload already carries `viewport.devicePixelRatio` (PRD §9.1) — use the content-script-captured value, not a fallback of 1.
- Round to integers after multiplication (`Math.round`) to avoid sub-pixel canvas operations.
- The output canvas dimensions (the cropped image size) are the CSS-pixel dimensions `rect.width × rect.height` — the canvas CSS display size should match. The `drawImage` source region is DPR-scaled; the destination is unscaled.
- Add a `dpr !== 1` code path in automated tests: capture a known-dimension element on a 2x virtual display.

**Warning signs:**
- Crops capture the wrong region — typically the top-left portion of the expected area.
- On 1x displays (DPR = 1) everything looks correct; issues appear only on developer's high-DPI monitor or when Windows display scaling is > 100%.
- Screenshots are sharp but contain a different element than the one clicked.

**Phase to address:** M4 (free-note + initial capture) — write the crop utility with DPR correction from day one. M6 (camera region capture) reuses the same crop utility; correctness must be established in M4.

---

### Pitfall 5: Own UI Visible in Screenshot — Async Paint Flush Gap

**What goes wrong:**
The flow "hide UI → capture → restore UI" must guarantee a completed repaint between hide and capture. Setting `display: none` or `visibility: hidden` on the shadow-root host element schedules a style recalculation and repaint, but `captureVisibleTab` called immediately after — even `await`-ed — may execute before the browser has composited the new frame. The result: the scrim, note card, connection chip, or highlight overlay appear in the captured screenshot. This is especially visible in the camera tool flow and in the auto element-highlight path.

**Why it happens:**
The Chrome tab capture API captures the last composited frame, which may be the pre-hide frame if the GPU pipeline hasn't flushed. `await` on a promise does not guarantee a repaint.

**How to avoid:**
- After hiding the UI, delay capture with two `requestAnimationFrame` callbacks nested, then a `setTimeout(fn, 0)` inside the second rAF. This pattern (double-rAF + setTimeout) reliably flushes the compositor before the next API call in all tested Chromium versions.
- Pattern: `await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))))` then call `captureVisibleTab`.
- Do not use a fixed `setTimeout(fn, 100)` — it is fragile on slow machines and wasteful on fast ones.
- After capture, restore the UI before returning (use try/finally to guarantee restoration even on error).

**Warning signs:**
- Captured images intermittently show the extension UI — not always, only sometimes. (The non-deterministic nature is the tell.)
- The note card shadow or chip outline is visible in the screenshot as a semi-transparent overlay.
- Works fine on a fast developer machine but fails on QA with an older/slower system.

**Phase to address:** M4 (first capture implementation). The double-rAF flush utility must be canonical and reused by M6 (camera tool) and M5 (element-highlight capture).

---

### Pitfall 6: Serial Assignment Race Under Concurrent POSTs

**What goes wrong:**
The serial counter is derived by scanning `notesDir` for existing `NNNN-*.md` files and taking `max + 1`. If two `POST /annotation` requests arrive within milliseconds (user clicks Send on two notes in rapid succession, or two browser tabs in the same project both send), both scans may read the same max and produce the same serial number. Two files are written with identical serials; one overwrites the other. The overwritten note is silently lost — a core reliability regression.

**Why it happens:**
Node.js is single-threaded but I/O is asynchronous. Both requests enter the serial-scan async path before either has written its file, so both see the same max.

**How to avoid:**
- Implement a **simple in-process async mutex** (a promise chain). One implementation: maintain a `let writeQueue = Promise.resolve()` module-level variable; each write request appends to it: `writeQueue = writeQueue.then(() => doWrite(payload))`. Serial assignment + file write happen inside `doWrite`, which runs sequentially.
- The PRD already specifies this requirement (§8.3: "simple in-process mutex/queue so concurrent POSTs don't collide") — implement it explicitly, don't rely on Node's event loop coincidentally serializing the I/O.
- Do NOT use file locking (`fs.open` with exclusive flags) — it is OS-dependent and brittle on Windows. The in-process queue is sufficient since there is one host process per project.

**Warning signs:**
- Two notes exist with serial `0003`; one has the wrong content.
- Under manual stress testing (two browser tabs both in Review Mode hitting Send simultaneously), occasionally a file is missing or a serial is skipped.

**Phase to address:** M2 (host MVP) — serial assignment is core host infrastructure. Test with concurrent requests in M2 unit tests.

---

### Pitfall 7: CORS Preflight Failure for Custom Header from Page Origins

**What goes wrong:**
`POST /annotation` carries the custom header `X-Stickyfix-Token`. Any cross-origin fetch with a custom header triggers a CORS preflight (`OPTIONS` request). The host must respond to the `OPTIONS` method with the correct CORS headers before the actual `POST` will be sent. Missing or incorrect preflight handling causes the POST to never reach the host — the content script (or service worker) gets a network error, which surfaces as a confusing "host down" toast even when the host is running.

**Why it happens:**
The request is cross-origin because the page origin (e.g., `https://app.chatlytics.ai`) differs from `http://127.0.0.1:39242`. Developers test from `localhost:someport` first, where the non-standard port but same hostname may mask the preflight requirement.

**How to avoid:**
- The host must handle `OPTIONS *` explicitly: respond with `200`, `Access-Control-Allow-Origin: <echo request Origin>`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, X-Stickyfix-Token`, `Access-Control-Allow-Private-Network: true`, `Access-Control-Max-Age: 86400`.
- Test from an HTTPS origin against the localhost host early in M2, not just from another localhost port.
- `Access-Control-Max-Age: 86400` caches the preflight for 24 h, avoiding a preflight on every note (performance).
- Because CORS is permissive by design here (token is the real gate), echoing the request `Origin` is correct — don't hardcode a single origin.

**Warning signs:**
- `POST /annotation` never reaches the host's request handler (nothing in server logs) despite the host being up.
- Browser DevTools Network tab shows a failed `OPTIONS` request with no response or a `403`.
- Works from `localhost:3000` (same effective security zone) but fails from `https://app.example.com`.

**Phase to address:** M2 (host MVP) — CORS handling must be complete before any cross-origin test in M3+.

---

### Pitfall 8: Shadow DOM CSS Leak — `:host` Reset Missing

**What goes wrong:**
WXT's `createShadowRootUi` creates a Shadow DOM boundary, but the host page's CSS can still influence the shadow root's `:host` element (the custom element wrapper) via inherited properties. More critically, missing `all: initial` or a reset on shadow DOM elements means that inherited properties like `font-family`, `font-size`, `line-height`, `color`, and `box-sizing` flow in from the page. A site that sets `* { box-sizing: border-box; font-size: 62.5%; }` globally causes the injected post-it to render at 62.5% base size. Conversely, if the extension's CSS sets global selectors incorrectly (using `:root` instead of `:host`), styles leak **out** and corrupt the page layout.

**Why it happens:**
Shadow DOM prevents most CSS from crossing the boundary, but inherited CSS properties (those not explicitly set on the shadow host) still pierce downward. Developers assume "Shadow DOM = zero CSS bleed" without understanding which properties inherit vs. which are blocked.

**How to avoid:**
- Add `:host { all: initial; display: block; }` at the top of the shadow stylesheet. This resets inherited properties at the shadow boundary.
- Set explicit values for all dimensional and typographic properties on the root container inside the shadow root. Never rely on inherited values.
- Use `z-index: 2147483647` on `:host` (max positive 32-bit int). The chip and post-it will still lose to pages that also use `2147483647` on their modals (some do) — there is no complete fix for this without `position: fixed` + a top-level portal — but max z-index minimizes the problem.
- Do not use the Vite `?inline` CSS import trick *incorrectly* — WXT's `createShadowRootUi` handles style injection into the shadow root; follow WXT's documented pattern for inline CSS in shadow roots.

**Warning signs:**
- Post-it notes render at unexpected font sizes or with wrong font families depending on which site the extension is used on.
- Drag handles or dimensions visually differ site-to-site.
- The page's CSS inspector shows unexpected property overrides on elements that should be inside the shadow boundary.

**Phase to address:** M3 (shadow root UI injected). M6 (visual design pass) must recheck with an aggressive-reset host page (e.g., CSS Tricks, Tailwind sites).

---

### Pitfall 9: Port-Range Discovery Race / Collision Between Projects

**What goes wrong:**
Two host processes start at nearly the same time and both pick port `39240` (the same "first free" port). One binds successfully; the other gets `EADDRINUSE` and is expected to try `39241`. If the port-scan loop is not careful about how it determines "free" (checking without binding, then binding separately — classic TOCTOU), two hosts may both think they own the same port. On the extension side, probing the full port range on every Review Mode entry adds ~200 ms of sequential fetches (21 ports × ~10 ms timeout each) if no hosts respond, and the full range has timeout per probe.

**Why it happens:**
Port availability is checked optimistically. On the host side, `net.createServer().listen(port)` is the only reliable "bind or fail" approach. On the extension side, the probe loop is sequential by default in the simple implementation.

**How to avoid:**
- Host: use `server.listen(port, '127.0.0.1', callback)` — if the callback receives an `EADDRINUSE` error, increment and retry. Never pre-check with a socket probe; bind directly and handle the error. Try ports `39240..39260` in sequence until one binds.
- Extension: probe all 21 ports **in parallel** (`Promise.all` of 21 short-timeout fetches to `GET /status`) rather than sequentially. Parallel probing reduces discovery from ~210 ms worst-case to ~10 ms (one round-trip worth).
- Set a short `AbortController` timeout (~500 ms) on each probe; a closed port fails fast.
- Cache the last-known working port per project name in `chrome.storage.local` and try that port first before the full scan (hit rate is high since hosts rarely change ports between sessions).

**Warning signs:**
- One host silently fails to start (logs `EADDRINUSE`) and the user does not notice.
- The extension's Review Mode entry takes 2+ seconds on a system where no hosts are running (sequential probe of all 21 ports with default TCP timeout).
- The connection chip shows "no host found" immediately after starting two hosts.

**Phase to address:** M2 (host port binding) + M3 (extension parallel discovery).

---

### Pitfall 10: Path Traversal in File Write

**What goes wrong:**
If a malicious page constructs a `comment` or any future field that influences the filename (currently: serial + timestamp, both host-derived and safe), or if a future extension adds a user-specified subpath, `path.join(notesDir, userInput)` does not prevent traversal. `path.join('/safe/notes', '../../../etc/cron.d/evil')` resolves to `/etc/cron.d/evil`. Even in v1 where filenames are host-derived, a bug in the serial/timestamp logic could construct a path outside `notesDir`. The host writes files to disk — the attack surface is real.

**Why it happens:**
`path.join` and `path.resolve` are path-normalization utilities, not security functions. Developers conflate normalization with containment.

**How to avoid:**
- After resolving any path, assert containment: `const resolved = path.resolve(notesDir, candidate); assert(resolved.startsWith(path.resolve(notesDir) + path.sep), '403')`.
- In v1 the filename is `${serial}-${timestamp}.md` where serial is an integer and timestamp is `YYYYMMDD-HHmmss` — both are host-derived and validated. Still add the containment assert as a defense-in-depth guard.
- Write a unit test that passes `../../../etc/passwd` as a candidate path and asserts the server rejects with 400.
- Do not write outside `notesDir` even for the `.stickyfix-token` convenience file — write that to `--root` not `notesDir`.

**Warning signs:**
- No tests for path safety in M2.
- The path assembly touches any user-supplied string without a subsequent `startsWith(notesDir)` check.

**Phase to address:** M2 (host MVP) — path safety is a security requirement, not a hardening step.

---

### Pitfall 11: Token Auth Bypass via Missing Token on GET /status

**What goes wrong:**
`GET /status` is intentionally unauthenticated (it is the discovery handshake). If the host inadvertently returns sensitive data in `/status` (e.g., the token itself, the full filesystem path in a guessable pattern, or internal project metadata beyond `name`/`origins`/`notesDir`), any local webpage that probes port 39240-39260 can extract it. The PRD specifies `/status` returns `{ app, version, name, root, notesDir, origins }` — `root` in particular reveals the full filesystem path.

The second issue: if token validation is a simple string equality check but the comparison is not constant-time, a timing oracle may allow token enumeration from localhost (low severity on loopback, but worth noting for a public repo codebase that others may adapt).

**How to avoid:**
- Do **not** return the token in `/status`. Return only `{ app, version, name, notesDir, origins }`. The token is entered manually by the user in the popup, not auto-extracted from `/status`.
- Use `crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))` for token comparison. Requires both buffers to be the same length; pad/fail-fast on length mismatch before comparison.
- `root` and `notesDir` (full filesystem paths) in `/status` are non-sensitive for the local-only use case but should not include anything beyond what is needed for the extension's status display.

**Warning signs:**
- `/status` response includes a `token` field in development code that was never removed.
- Token comparison uses `===` on strings.

**Phase to address:** M2 (host MVP).

---

### Pitfall 12: Cross-Platform Build Breakage (Windows / macOS-only Steps)

**What goes wrong:**
The GPL upstream uses `sips` (macOS-only) for icon resizing and `Bun` as the build runtime. Copying or recreating these patterns breaks `npm run build` on Windows and Linux. Specific Windows-on-Node traps include: shell glob patterns in `package.json` scripts using Unix `*` without `cross-env` or a JS glob; `rm -rf` in scripts (use `rimraf` or `node -e "fs.rmSync"`); path separators in build scripts using `/` hardcoded in places Node's `path` module should be used; shebangs (`#!/usr/bin/env node`) that don't work in PowerShell without explicit `node` prefix.

**Why it happens:**
The reference was built on macOS. Tool and platform assumptions are invisible to the original author.

**How to avoid:**
- WXT + Vite handle icon generation from a single source PNG — zero `sips`, zero `sips`-equivalent. Use `wxt.config.ts` icon config.
- All `package.json` scripts must be Node-only or use cross-platform shims: `rimraf` (not `rm -rf`), `cross-env` (not `export`), `node -e` for simple inline scripts.
- Test `npm run build` on Windows from the first scaffold commit (M1) and keep it green throughout.
- The host TypeScript is compiled with `esbuild` or `tsc` — both cross-platform. Do not add any shell-specific build steps for the host.
- `util.parseArgs` (Node 18.3+) for CLI arg parsing — no `yargs`/`commander`, and no shell argument expansion quirks.

**Warning signs:**
- `npm run build` fails with `'rm' is not recognized` or `sips: command not found` on Windows.
- Icon files are missing from the build output when built on Windows.
- Path separator errors in esbuild output on Windows (`/` vs `\`).

**Phase to address:** M1 (repo scaffold) — verify cross-platform build passes on Windows before any other milestone.

---

### Pitfall 13: GPL→MIT Clean-Room IP Hygiene Failure

**What goes wrong:**
This is the hard legal boundary, not a coding preference. The GPL-3.0 upstream (`JodusNodus/opencode-chrome-annotation`) was studied as a reference. Any code, comment, identifier name, file name, or UI string copied — even paraphrased closely — from that source into this MIT-licensed codebase makes this deliverable a GPL derivative. The deliverable must then be distributed under GPL-3.0, not MIT. Publishing it as MIT with GPL-derived code is a license violation.

Specific non-obvious copy vectors:
1. **Identifiers:** the upstream uses `__opc_*` for DOM ids. Using those in this codebase is a copy. Use `sfx-*` or `stickyfix-*` throughout.
2. **File structure:** if the upstream has `src/element-capture.ts` and this repo creates the same file name in the same position, that is not a violation by itself — but if the exports, function names, and internal logic mirror the upstream, it becomes one.
3. **Selector heuristic:** the upstream hand-rolls a fragile id-anchored CSS path heuristic (≤5 levels, `:nth-of-type`, ≤2 classes/level — documented in PRD Appendix A). Reproducing this algorithm in original code might still be considered derivative if the specific parameters and logic are copied. **Use `@medv/finder` (MIT) instead.** This is the documented clean-room separation.
4. **AI-assisted code generation:** if an AI coding agent was trained on the GPL upstream, its output for this codebase may reproduce code it "learned." This is an emerging unsettled legal area (see the chardet controversy, 2026). Mitigation: write from the PRD spec only, not by prompting with upstream code snippets.
5. **Comment text / docstrings:** any documentation or inline comment phrasing copied from the upstream source constitutes copying of protected expression.

**How to avoid:**
- **Two-engineer rule:** the architect who studied the GPL upstream writes the spec (done — that is this PRD). A separate agent/developer writes original code from the spec only, without reading the upstream source. Document this separation.
- Use **different identifiers** throughout: `stickyfix`, `sfx-`, `SFX_`, `stickyfix-host` — not `opc`, `opencode`, or any upstream names.
- Use **`@medv/finder`** for selectors — this is both cleaner and clean-room separation.
- **Only drop the OpenCode-binding endpoints** (`/sessions`, `/claim`, `/unclaim`); do not look at their implementation, only note their absence.
- Treat the PRD Appendix A ("Architecture blueprint") as the complete knowledge transfer — no further reading of the upstream source is needed or permitted.
- Before public release (M7/M8), run a diff of identifier names, file names, and any string literals against the upstream to verify zero overlap.
- Add a `CLEAN-ROOM.md` or a section in `README.md` documenting the clean-room process: who reviewed the upstream (spec author), who wrote the code (separate agent), and what was used as the transfer artifact (this PRD).

**Warning signs:**
- Any occurrence of `__opc_`, `opencode`, `JodusNodus` in source code or comments.
- Function names, object shapes, or file names that verbatim match the upstream without independent derivation from the PRD.
- The selector logic reproducing the "≤5 levels, :nth-of-type, ≤2 classes" heuristic instead of using `@medv/finder`.
- An AI agent being asked to "implement the same thing as the upstream" rather than "implement from the PRD spec."

**Phase to address:** M1 (scaffold — establish identifier namespace) and every milestone (code review must check for upstream leakage before merging). **This is not a Phase 8 hardening item — it is a Phase 1 invariant.**

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Cache host registry in service-worker memory | Faster routing after wake | Silent state loss after idle; notes dropped | Never — always read from `chrome.storage.local` |
| Sequential port probing (not parallel) | Simpler code | 200+ ms UX delay entering Review Mode on cold start | Never after M3 |
| No in-process write mutex | Simpler host | Serial collisions under concurrent send; lost notes | Never |
| Fixed `setTimeout(100)` for capture flush | Simple to write | Non-deterministic; fails on slow hardware | Never — use double-rAF + setTimeout(0) |
| Echo token in `/status` for convenience | Easier pairing UX | Any local page can scrape it | Never |
| Using `path.join` alone for path safety | Familiar API | Path traversal from any user-influenced string | Never for write paths |
| `===` for token comparison | Simpler code | Timing oracle (low severity locally) | Acceptable only if replaced before public release |
| Storing state in `localStorage` inside content script | Convenient persistence | Lost on navigation; sandboxed from service worker; not `chrome.storage` | Never for shared state |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `captureVisibleTab` from content script | Call directly via `chrome.tabs.captureVisibleTab` from content script (not allowed) | Message to service worker; service worker calls API with its own host_permissions |
| `chrome.storage.local` from service worker | Module-level cache as primary store, storage as backup | Storage as source of truth; module-level cache is ephemeral write-through only |
| `interact.js` inside Shadow DOM | Attach to document-level events; they don't reach shadow | Pass the `shadowRoot` as the `context` option to `interact()` calls; or attach to the shadow host |
| `@medv/finder` on dynamic React apps | Run at page-load time on a static snapshot | Run at element-click time so the DOM is current; re-run if the element re-mounts |
| `yaml` npm package for frontmatter | Hand-roll YAML serialization for "simple" objects | Use `yaml.stringify` for all frontmatter — URLs with `:` and titles with `"` break hand-rolled YAML |
| WXT `createShadowRootUi` CSS | Import CSS at the top of the entrypoint without `?inline` | Use WXT's documented inline CSS pattern so styles inject into the shadow root, not the page `<head>` |
| CORS preflight on OPTIONS | Forget OPTIONS handler; rely on the POST route to "pass through" | Explicit `OPTIONS *` handler is required before any POST from a cross-origin page succeeds |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Host binding `0.0.0.0` instead of `127.0.0.1` | Any LAN client can write files to the developer's disk | Hardcode `127.0.0.1` in `server.listen()`; assert in smoke test by trying to connect from external IP |
| Missing token on `POST /annotation` accepted | Any local page that guesses the port writes arbitrary notes | Reject all POST without matching `X-Stickyfix-Token`; 401 with `{ ok: false, error: "unauthorized" }` |
| `path.join` without containment check | Path traversal to write outside notes dir | `path.resolve` + `startsWith(notesDir + sep)` assertion before every write |
| Body size not capped | OOM on a malformed 500 MB POST body | Reject > 12 MB with 413 before buffering the body |
| `/status` returns token | Local pages can scrape auth credential | `/status` returns only `{ app, version, name, notesDir, origins }` |
| GPL code in MIT codebase | License violation; repo must be taken down or relicensed | Clean-room process; identifier namespace separation; `@medv/finder` for the selector heuristic |

---

## "Looks Done But Isn't" Checklist

- [ ] **Service-worker persistence:** verify that tokens and host registry survive a 5-minute idle period (Chrome kills the worker) — not just a browser restart.
- [ ] **DPR correction:** verify screenshots crop correctly on a 2x display AND on Windows with 125% display scaling (fractional DPR = 1.25).
- [ ] **Own UI hidden in capture:** verify connection chip, scrim, note card, and highlight are all absent in every captured PNG — on slow hardware too.
- [ ] **Serial atomicity:** verify two simultaneous Sends produce serials `N` and `N+1`, never two identical serials.
- [ ] **CORS from HTTPS origin:** verify `POST /annotation` works from an HTTPS page origin (not just localhost:port), including the OPTIONS preflight.
- [ ] **LNA block:** verify content-script fetch to localhost fails (proving the service-worker routing path is the only path used).
- [ ] **Token rejection visible:** verify a wrong token produces a toast in the page UI — not a silent drop and not a console error only.
- [ ] **Port binding fails gracefully:** verify the host exits with a clear error if all ports 39240-39260 are occupied.
- [ ] **Clean-room audit:** grep source for `__opc_`, `opencode`, `JodusNodus`, and the upstream's `:nth-of-type` selector heuristic constants before any public release.
- [ ] **Windows build:** `npm run build` succeeds on Windows with no `sips`, no `Bun`, no `rm -rf`, no Unix-only glob patterns.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Service-worker state wiped | LOW | Re-read from `chrome.storage.local` on next wake — if storage was the source of truth, recovery is automatic |
| LNA block discovered late | MEDIUM | Refactor all localhost fetches to go through service worker; content script becomes message-only |
| DPR crop wrong from the start | LOW | Fix the multiplication constant in the crop utility; re-test with 2x capture |
| Own UI in screenshots | LOW | Add the double-rAF flush before the capture call; deterministic fix |
| Serial collision detected | MEDIUM | Add write mutex queue; replay any double-serial files manually |
| GPL code found in codebase | HIGH | Must rewrite affected files from spec without upstream reference; legal review required before re-publishing |
| Cross-platform build broken | LOW | Remove offending script; replace with `rimraf`/Node equivalent; re-test on Windows |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Service-worker state wipe | M3 (routing + storage design) | Idle 5 min, Send note, check toast + file created |
| LNA blocking content-script fetch | M2 (host) + M3 (service worker owns fetch) | Fetch from HTTPS page; verify no LNA prompt |
| `captureVisibleTab` permission | M3 (optional_host_permissions request at Review Mode entry) | Fresh Chrome profile, no prior grants |
| DPR crop misalignment | M4 (crop utility) | Verify crop rect on 2x and 1.25x displays |
| Own UI in capture | M4 (flush utility) | Slow network throttle; verify chip absent in PNG |
| Serial race condition | M2 (write mutex) | Concurrent POST stress test |
| CORS preflight failure | M2 (OPTIONS handler) | Test POST from HTTPS page; check DevTools network |
| Shadow DOM CSS bleed | M3 (shadow root scaffold) | Test on Tailwind and CSS-reset-heavy sites |
| Port range collision | M2 (bind-or-fail) + M3 (parallel probe) | Start 2 hosts simultaneously; both bind different ports |
| Path traversal | M2 (containment assert) | Unit test with `../../../etc/passwd` candidate |
| Token bypass / info leak | M2 (auth + /status response shape) | Verify `/status` has no token field |
| Cross-platform build | M1 (scaffold) | CI on Windows runner from day one |
| GPL clean-room violation | M1 (identifier namespace) + every milestone review | Pre-release grep audit of upstream identifiers |

---

## Sources

- Chrome for Developers: [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Chrome for Developers: [Local Network Access permission prompt (Chrome 142)](https://developer.chrome.com/blog/local-network-access)
- Chrome for Developers: [chrome.tabs API reference](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- MDN: [tabs.captureVisibleTab](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab)
- web.dev: [High DPI Canvas](https://web.dev/articles/canvas-hidipi)
- Kaan Barmore-Genc: [Using Shadow DOM to isolate injected browser extension components](https://kaangenc.me/2024.05.18.using-shadow-dom-to-isolate-injected-browser-extension-compo/)
- Sourcery: [Node.js Path Traversal via path.join/resolve](https://www.sourcery.ai/vulnerabilities/javascript-lang-security-audit-path-traversal-path-join-resolve-traversal)
- Heather Meeker: [The Chardet Controversy: Open Source and the AI Clean Room](https://heathermeeker.com/2026/04/09/the-chardet-controversy-open-source-and-the-ai-clean-room/)
- Simon Willison: [Can coding agents relicense open source through a "clean room"?](https://simonwillison.net/2026/Mar/5/chardet/)
- DEV Community: [Manifest V3 Migration Pitfalls — Lessons from 17 Chrome Extensions](https://dev.to/_350df62777eb55e1/manifest-v3-migration-pitfalls-lessons-from-17-chrome-extensions-2j3h)
- Chromium Groups: [Optional Host Permissions in Manifest v3](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/EnUmtHWOI9o)
- PRD §7.3, §7.5, §7.6, §8.3, §8.4, §13 + Appendix A (primary spec source)

---
*Pitfalls research for: Chrome MV3 extension + Node localhost host — sticky-note annotation tool*
*Researched: 2026-05-31*
