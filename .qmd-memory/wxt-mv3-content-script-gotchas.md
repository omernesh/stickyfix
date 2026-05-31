---
title: WXT MV3 content-script gotchas (chip never mounted / dropdown dead / etc.)
date: 2026-05-31
tags: [debugging, wxt, mv3, chrome-extension, architecture, gotcha]
worker: Pixel
---

Five real bugs found during Phase 3 manual Chrome UAT (stickyfix). All would
have shipped broken; none were caught by tsc or unit tests because they only
manifest in a live Chrome content-script context.

## 1. BLOCKER — never import an entrypoint module across contexts
`chip.ts` (content script) did `import { SFX_SET_ROUTE } from '../background.js'`.
The constants are just strings, but **ES module side effects are not tree-shaken**:
importing ANY symbol from `background.ts` executes its top-level statements in the
importing bundle. Background registers SW-only listeners
(`chrome.runtime.onStartup/onInstalled.addListener`). In a content script
`chrome.runtime.onStartup` is `undefined` → `Cannot read properties of undefined
(reading 'addListener')` → the whole content script throws on startup and the UI
never mounts. WXT's wrapper re-throws ("The content script crashed on startup!")
but its logger is stripped in production builds, so it surfaces only as an
`Uncaught (in promise)` in the PAGE console.
**Rule:** cross-context shared constants live in a side-effect-free module
(`lib/types.ts`), never in an entrypoint. Verify with
`grep -c "onStartup\|onInstalled" .output/.../content-scripts/<name>.js` → must be 0.

## 2. `[hidden]` is defeated by ID-specificity display rules
`#sfx-empty-state { display: flex }` (0,1,0,0) beats the UA `[hidden]{display:none}`
(0,0,1,0), so `el.hidden = true` did nothing — the element stayed visible.
**Fix:** ship a global `[hidden] { display: none !important; }` (what Normalize.css does).

## 3. Drag-anywhere handler swallows native control clicks
A `pointerdown` listener on the chip that calls `setPointerCapture` + `preventDefault`
suppresses the default action of child `<select>`/buttons — the dropdown never opens,
buttons go dead. **Fix:** in the pointerdown handler, bail when
`e.target.closest('button, select, input, option, a, textarea')` — only chrome/background
initiates a drag. (e.target inside a shadow root is the real element for in-tree listeners.)

## 4. Don't read storage raw from a content script if the writer uses WXT
WXT `storage.defineItem('local:sfxRegistry')` and a raw
`chrome.storage.local.get(['sfxRegistry'])` need not use the same physical key.
The popup (WXT wrapper) saw the host; the chip (raw get) came up empty.
**Fix (architecture-correct):** the SW owns state — have it return the data in a
message response; the content script never touches chrome.storage.

## 5. Cross-half response contract drift
Host returns zero-padded `serial` as a **string** ("0001", pinned by server.test.ts);
the SW's response guard required `typeof serial === 'number'` → every successful relay
showed a false "Malformed host response". The .md was written; only validation failed.
**Lesson:** when two halves each define the response shape independently, they drift.
The producer's tested contract wins; align the consumer to it.

## Bonus: Chrome-142 Local Network Access is NOT a problem for extension SWs
Much worry about LNA blocking SW→127.0.0.1. Confirmed empirically: an MV3 service
worker with `host_permissions: ["http://127.0.0.1/*"]` reaches loopback fine (the
POST /annotation succeeded). LNA gates *public-origin* initiators, not
`chrome-extension://` SWs. The `Access-Control-Allow-Private-Network` header on the
host is harmless but irrelevant to the extension path.

## Bonus: host token regenerates per launch
`resolveConfig` does `token = flag/env ?? randomUUID()` — `.stickyfix-token` is written
but never read back, so a fresh random token every restart invalidates the popup's saved
token. For stable dev/UAT, pin `STICKYFIX_TOKEN`. (Auto-reading the file back is a
candidate UX fix but deviates from PRD §8.1's documented 3-tier order.)

## Bonus: npm on Windows PowerShell strips `--root`
`npm run host -- --root X` → npm warns "Unknown cli config" and drops it. The host's
`resolveConfigValues` reads `npm_config_root`/`npm_config_origin` env fallbacks, so the
`--root=X` (equals) form works; bare-space form does not.
