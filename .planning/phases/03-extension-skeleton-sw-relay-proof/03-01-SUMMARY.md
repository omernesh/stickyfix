---
phase: 03-extension-skeleton-sw-relay-proof
plan: "01"
subsystem: extension-lib
tags: [lib, types, routing, discovery, storage, node-test, manifest, mv3]
dependency_graph:
  requires: [02-03]
  provides: [lib/types.ts, lib/routing.ts, lib/discovery.ts, lib/storage.ts]
  affects: [03-02, 03-03, 03-04]
tech_stack:
  added: [tsconfig.lib.json]
  patterns:
    - WXT storage.defineItem typed storage schema
    - Pure-function routing for node:test testability
    - Promise.allSettled parallel port scan with AbortController
    - globalThis.fetch stub pattern for discovery unit tests
key_files:
  created:
    - lib/types.ts
    - lib/storage.ts
    - lib/routing.ts
    - lib/discovery.ts
    - lib/test/routing.test.ts
    - lib/test/discovery.test.ts
    - tsconfig.lib.json
  modified:
    - wxt.config.ts
    - package.json
decisions:
  - "SFX_MSG constants use uppercase snake (SFX_ENTER_REVIEW etc.) — exported as const object for type inference"
  - "tsconfig.lib.json rootDir='.' causes compiled output at dist/lib/lib/* (double nesting); package.json test:lib references this exact path"
  - "lib/storage.ts excluded from tsconfig.lib.json — wxt/utils/storage import is not node-resolvable"
  - "A4 CSS auto-inject deferred to Plan 03-04 first build; scripting.insertCSS fallback pre-authorized"
  - "@ts-ignore added above optional_host_permissions in wxt.config.ts (A1 confirmed)"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-31"
  tasks_completed: 3
  files_created: 7
  files_modified: 2
---

# Phase 03 Plan 01: lib/ Foundation + Manifest Summary

**One-liner:** Pure lib/ layer (types, storage schema, chrome-API-free routing/discovery) with 22 passing node:test units and an MV3 manifest carrying Phase 3 permissions + no static content_scripts.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | lib/ types, storage, routing, discovery | f38e435 | lib/types.ts, lib/storage.ts, lib/routing.ts, lib/discovery.ts |
| 2 | node:test units + tsconfig.lib.json + package.json | db58fdf | lib/test/routing.test.ts, lib/test/discovery.test.ts, tsconfig.lib.json, package.json |
| 3 | MV3 manifest + Wave-0 build verification (A4) | 4d22c67 | wxt.config.ts |

## Message-Type Constants (for Plans 02/03/04)

Plans 02, 03, and 04 MUST use these exact string constants from `lib/types.ts`:

```typescript
import { SFX_MSG } from '../lib/types.js';

SFX_MSG.ENTER_REVIEW    // 'SFX_ENTER_REVIEW'
SFX_MSG.EXIT_REVIEW     // 'SFX_EXIT_REVIEW'
SFX_MSG.GET_ROUTE       // 'SFX_GET_ROUTE'
SFX_MSG.SEND_ANNOTATION // 'SFX_SEND_ANNOTATION'
SFX_MSG.REFRESH_HOSTS   // 'SFX_REFRESH_HOSTS'
```

## Compiled Lib Test Paths

The `test:lib` script references:
- `dist/lib/lib/test/routing.test.js`
- `dist/lib/lib/test/discovery.test.js`

(Double `lib/lib/` because `tsconfig.lib.json` has `rootDir: "."` and `outDir: "dist/lib"`.)

## Test Coverage

| Test File | Tests | EXT IDs | Status |
|-----------|-------|---------|--------|
| routing.test.ts | 13 | EXT-06, EXT-07, EXT-08, EXT-10 | PASS |
| discovery.test.ts | 9 | EXT-04 | PASS |
| host tests (unchanged) | 48 | — | PASS |
| **Total** | **70** | | **PASS** |

`npm run check` exits 0.

## A4 CSS Injection Finding (Carry-Forward)

**Baseline build (this plan):** The `content-scripts/` directory was NOT emitted because `review.content/` entrypoint does not exist yet. This is expected.

**A4 determination:** Whether WXT auto-injects `content-scripts/review.css` alongside `content-scripts/review.js` when using `cssInjectionMode: 'ui'` + `registration: 'runtime'` will be confirmed in **Plan 03-04** on the first build after `review.content/index.ts` is created.

**Pre-authorized fallback:** If `review.css` is absent from the injected shadow root at runtime, Plan 03-04 MUST add:
```typescript
await browser.scripting.insertCSS({
  target: { tabId },
  files: ['content-scripts/review.css'],
});
```
after the `executeScript` call in `background.ts`.

## Manifest Assertion (Task 3)

Built manifest at `.output/chrome-mv3/manifest.json`:
- `content_scripts`: ABSENT (EXT-02 precondition satisfied)
- `permissions`: `["activeTab","scripting","storage","tabs"]` (EXT-01)
- `host_permissions`: `["http://127.0.0.1/*","http://localhost/*"]` (EXT-01)
- `optional_host_permissions`: `["<all_urls>"]` (EXT-01)

TypeScript note: `// @ts-ignore` was added above `optional_host_permissions` in `wxt.config.ts` — WXT 0.20.x types do not include this field (assumption A1 confirmed). The field is valid MV3 JSON and is correctly emitted in the built manifest.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan creates pure library code and configuration only. No UI or data-flow stubs.

## Threat Flags

None — this plan creates pure TypeScript functions and a build config. No new network endpoints, auth paths, or trust-boundary surfaces introduced.

## Self-Check: PASSED

- lib/types.ts: EXISTS
- lib/storage.ts: EXISTS
- lib/routing.ts: EXISTS
- lib/discovery.ts: EXISTS
- lib/test/routing.test.ts: EXISTS
- lib/test/discovery.test.ts: EXISTS
- tsconfig.lib.json: EXISTS
- wxt.config.ts: MODIFIED
- package.json: MODIFIED
- Commits f38e435, db58fdf, 4d22c67: EXIST
- npm run check: EXITS 0 (70/70 tests)
- Manifest assertions: PASS (no content_scripts, has optional_host_permissions)
- chrome/wxt-free grep on routing.ts + discovery.ts: 0 matches
