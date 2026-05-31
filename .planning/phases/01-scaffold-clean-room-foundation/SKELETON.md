# Walking Skeleton — stickyfix

**Phase:** 1
**Generated:** 2026-05-31

## Capability Proven End-to-End

> The smallest end-to-end capability that exercises the full toolchain (not yet the annotation slice — that is deliberately Phases 2-4 per the phase boundary).

A developer can `git clone` the repo on Windows, run `npm install`, `npm run build`, and **load a valid empty-but-loadable MV3 extension** in Chrome (icons render, no manifest errors), while `npm run host -- --root <dir>` starts a runnable host stub that prints its startup JSON and `npm run check` passes (tsc on both halves + clean-room grep gate + host spawn-and-assert smoke test).

This proves the WXT/Vite extension build, the tsc NodeNext host build, and the clean-room/typecheck gate all work together cross-platform — the rungs every later vertical slice climbs on.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo layout | Single root `package.json` (no workspaces); extension at root, host in `host/` → `dist/host/` | D-01; matches PRD §11; scripts drive both halves |
| Extension framework | WXT 0.20.26, **vanilla TypeScript** (no React/Vue) | D-03; injected review UI is vanilla DOM in a shadow root; WXT is the only cross-platform (Vite, no Bun/sips) MV3 framework |
| Bundler | Vite (owned by WXT — never configured directly, no separate `vite` dep) | STACK.md; mismatched vite causes peer conflicts |
| Host build | `tsc` → ESM (`module: NodeNext`) to `dist/host/`, Node built-ins only (+`yaml` from Phase 2) | D-05; dependency-light; esbuild deferred unless startup speed demands it |
| Host CLI | `node:util` `parseArgs` (no commander/yargs) | STACK.md; 5-flag CLI; stdlib, zero deps; `strict:false` + `multiple:true --origin` for HOST-13 |
| Language config | TypeScript 6.0.3, `strict:true`; split tsconfigs — extension `types:["chrome"]` + `moduleResolution:bundler`, host `types:["node"]` + `moduleResolution:nodenext` | D-10; TS6 defaults `types:[]` so each must be explicit |
| Icons | Four committed pre-sized PNGs (16/32/48/128) under `public/icon/`, referenced via `manifest.icons` | D-07; bans `@wxt-dev/auto-icons`/`sharp` (native binary, Windows/offline-CI risk) and `sips` (macOS-only) |
| Clean-room enforcement | Node ESM grep gate (`scripts/clean-room-check.mjs`) wired into `npm run check`; `sfx-*`/`stickyfix` namespace from commit one | D-08, D-09; structural BUILD-04 mechanism, runs every check, not a pre-release checklist |
| Verification | `npm run check` = tsc(ext) + tsc(host) + clean-room grep + spawn-and-assert host smoke test; no third-party test framework this phase | D-02, D-11; all command-based, cross-platform Node |
| Deployment / run | Local: `npm run build` then load-unpacked in Chrome; `npm run host -- --root <dir>` for the host | Local-only tool by design (NG1); no cloud target |
| Directory layout | `entrypoints/{background.ts, popup/}`, `public/icon/*`, `host/src/`, `scripts/*.mjs`, split `tsconfig*.json` | RESEARCH Recommended Project Structure; WXT-idiomatic + Windows-safe |

## Stack Touched in Phase 1

- [x] Project scaffold — WXT extension + tsc host, build, typecheck gate, clean-room gate (no test framework — command-based verification)
- [x] Routing / entrypoints — real `background.ts` service worker + `popup/` entrypoint emitted into a valid MV3 manifest
- [ ] Database — **N/A this phase** (host is a stub; real file writes are Phase 2)
- [x] UI — placeholder popup shell renders into `#sfx-popup-root` (no annotation UI yet — Phase 4+)
- [x] Run command — `npm run build` (loadable extension + runnable host) and `npm run host -- --root <dir>` exercise the full toolchain locally

> Phase boundary note: the true page → POST → `.md`-on-disk end-to-end slice is intentionally split across Phases 2-4. Phase 1 proves the **toolchain** end-to-end, not the annotation feature.

## Out of Scope (Deferred to Later Slices)

- Host HTTP server, `/status`, `POST /annotation`, token auth, serial mutex, path safety, CORS, body cap — **Phase 2**
- Extension permissions, host discovery, `chrome.storage.local` state, on-demand injection, SW relay — **Phase 3**
- Any note UI, FAB, post-it, capture utilities, `.md` write — **Phase 4+**
- `@medv/finder`, `interactjs`, `esbuild`, `@wxt-dev/auto-icons` — installed/used in later phases, not Phase 1
- CI workflow (GitHub Actions), `stickyfix-host` npm `bin` — deferred (out of BUILD-* scope / v2 FUT-04)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without renegotiating its architectural decisions:

- **Phase 2 — Host MVP:** the host stub (`host/src/index.ts`) becomes a real 127.0.0.1 server: `/status`, `POST /annotation` with token auth, serial mutex, `.md`+`.png` writes, path safety, CORS, body cap.
- **Phase 3 — Extension Skeleton + SW Relay:** popup lists discovered hosts; SW probes 39240-39260; on-demand content-script injection; dummy CS→SW→host relay proven on an HTTPS page.
- **Phase 4 — Free-Note + Capture Utilities:** draggable FAB → post-it → Send → `.md` on disk; DPR-correct crop + double-rAF flush + captureVisibleTab relay built as reusables.
- **Phase 5 — Element-Note + Rich Context:** `@medv/finder` selector, React fiber, computed styles, outerHTML, auto-highlight screenshot.
- **Phase 6 — Region Capture + Visual Design:** camera drag-marquee crop; full paper-aesthetic post-it inside shadow DOM.
- **Phase 7 — review-notes Skill + Docs:** portable AI skill; README + demo GIF; clean-room provenance documented.
- **Phase 8 — Hardening + Pre-Release Audit:** all failure paths surface toasts; concurrent-Send stress; GPL grep audit; idle-eviction regression.
