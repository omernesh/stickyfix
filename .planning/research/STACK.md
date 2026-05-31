# Stack Research

**Domain:** MV3 Chrome extension + localhost Node host (developer annotation tool)
**Researched:** 2026-05-31
**Confidence:** HIGH (all versions verified against npm registry / official docs)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| WXT | 0.20.26 | MV3 extension framework (build, manifest, shadow-root UI, HMR) | Only MV3 framework that is cross-platform (Vite-based, no Bun/sips), actively maintained, best-in-class in 2025 comparison; Plasmo is in maintenance mode; CRXJS lacks runtime features |
| TypeScript | 6.0.3 | Language — extension + host | TS 6 ships new defaults (strict, esnext, bundler resolution); use it but note types:[] default (must list @types/chrome explicitly) |
| Vite | 8.0.14 | Bundler (via WXT — do not configure directly) | WXT owns Vite config; do not add a separate vite.config unless WXT docs say to |
| Node.js built-ins | N/A (Node 20+) | Host runtime: http, fs, crypto, path, util.parseArgs | Zero-dep approach; util.parseArgs is stable since Node 18.3 — no commander/yargs needed |

### Extension-Side Libraries

| Library | Version | Purpose | Why This One |
|---------|---------|---------|--------------|
| `@medv/finder` | 4.0.2 | Unique CSS selector generation for clicked elements | MIT, 1.5 kB gzipped, pure ESM, TypeScript-native (types bundled), actively maintained (last release Dec 2024); do not hand-roll fragile heuristics |
| `interactjs` | 1.10.27 | Drag for post-it, chip, FAB; drag-to-draw region marquee | Correct package name is `interactjs` (not `interact.js`, not `@interactjs/interact`); `@interactjs/interact` is an internal sub-package explicitly marked "not for independent use"; `interactjs` ships TS typings at `index.d.ts`; MIT; only mainstream drag lib with built-in gesture composition |

### Host-Side Libraries

| Library | Version | Purpose | Why This One |
|---------|---------|---------|--------------|
| `yaml` (eemeli) | 2.9.0 | Safe YAML frontmatter serialization | ISC license; v2 API: `import { stringify } from 'yaml'`; handles colons/quotes in URLs/titles that break hand-rolled YAML; only runtime dep the host needs |

### Build Tools

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| esbuild | 0.28.0 | Bundle host TypeScript to single runnable JS | 45x faster than tsc alone; use `--platform=node --format=esm --bundle`; does NOT type-check (keep `tsc --noEmit` as a separate check step) |
| `@wxt-dev/auto-icons` | 1.1.1 | Generate 16/32/48/128 PNG icons from one source | Ships `sharp` as a dependency — sharp downloads prebuilt WASM/native binaries on install (Windows x64 supported), but internet access required at `npm install` time. Alternative: skip this module and commit pre-sized PNGs manually via `manifest.icons` in `wxt.config.ts` — zero native dep risk, recommended for CI |

---

## WXT API Specifics for This Project

### Shadow-Root UI (createShadowRootUi)

```typescript
// entrypoints/review.content/index.ts
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',          // on-demand: NOT in the static manifest
  cssInjectionMode: 'ui',           // CSS injected into shadow root, not document head
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'sfx-review-ui',
      position: 'overlay',          // absolutely positioned, not inline
      zIndex: 2147483647,           // max z-index per spec requirement
      onMount(container: HTMLElement) {
        // attach vanilla DOM nodes here; no React/Vue needed
        mountReviewUI(container);
        return { unmount: () => teardownReviewUI(container) };
      },
      onRemove({ unmount }) {
        unmount();
      },
    });
    ui.mount();
    ctx.onInvalidated(ui.remove);   // cleanup on extension reload/update
  },
});
```

**Gotcha — rem units:** WXT applies `all: initial !important` to the shadow host in v0.20+. This does NOT reset `<html>` font-size, so `rem` values inside the shadow root are still relative to the host page's root font-size. Solution: use `px` exclusively in the post-it/chip/toolbar CSS, or configure postcss-rem-to-responsive-pixel. For this project's custom vanilla CSS, just write `px`.

**Gotcha — CSS splitting:** WXT's `splitShadowRootCss` auto-moves `@font-face` and `@property` rules from shadow root to `document.head`. If you load a custom font for the sticky-note aesthetic, declare it via `@font-face` at the top of the content script CSS file and WXT handles placement automatically.

**Gotcha — isolateEvents:** `createShadowRootUi` accepts an `isolateEvents` option. Default: shadow DOM events bubble to the main page. For the region-capture scrim (which dims the whole page), set `isolateEvents: true` during capture mode to prevent click events leaking to the host page during drag.

### On-Demand Injection (No Static Content Scripts)

```typescript
// background.ts (service worker)
await browser.scripting.executeScript({
  target: { tabId },
  files: ['content-scripts/review.js'],  // WXT output path
});
```

WXT marks `registration: 'runtime'` scripts as NOT added to the static manifest; they are injected on demand via `chrome.scripting.executeScript`. This keeps zero footprint on pages when Review Mode is off. The content script file path in `.output/chrome-mv3/` is `content-scripts/review.js`.

### Icon Strategy (Recommended: Manual, No `@wxt-dev/auto-icons`)

`@wxt-dev/auto-icons` depends on `sharp` which downloads native binaries. To guarantee cross-platform `npm install` with no internet-at-install surprises, commit four pre-sized PNGs to `public/`:

```
public/
  icon-16.png
  icon-32.png
  icon-48.png
  icon-128.png
```

WXT auto-discovers these by filename pattern — no `manifest.icons` config needed. Create the PNGs once (any image editor, ImageMagick, or a one-off Node script using `jimp` which is pure JS). Do NOT use `sips` (macOS-only).

---

## Installation

```bash
# Extension framework
npm i -D wxt@0.20.26

# Extension runtime deps (bundled into extension)
npm i @medv/finder@4.0.2
npm i interactjs@1.10.27

# Host runtime dep
npm i yaml@2.9.0

# Host build tool
npm i -D esbuild@0.28.0

# TypeScript (both halves)
npm i -D typescript@6.0.3
```

tsconfig note for TypeScript 6: add `"types": ["chrome"]` explicitly in the extension tsconfig — TS 6 defaults `types` to `[]` (no auto-discovery of @types packages).

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| WXT | Plasmo | In maintenance mode (2025); lags on dependencies; React-focused |
| WXT | CRXJS | Minimal abstraction; lacks runtime features (storage, messaging helpers); smaller community |
| `interactjs` | Native Pointer Events | Pointer capture + viewport clamping is 60+ lines of boilerplate per draggable; interact.js handles all of it in 3 lines and adds inertia/snapping if needed later |
| `interactjs` | `@dnd-kit/core` | React-specific; we have vanilla DOM in shadow root |
| `@medv/finder` | Hand-rolled selector heuristic | Upstream (GPL) shows why this breaks: no outerHTML, text capped, no dataset; @medv/finder is proven, MIT, 1.5 kB |
| `yaml` (eemeli) | `js-yaml` | js-yaml is fine but yaml v2 has better TypeScript types and is the more active package |
| `yaml` (eemeli) | Hand-rolled YAML | A note title or URL containing `: ` or `"` breaks naively serialized YAML frontmatter silently |
| esbuild (host) | tsc emit | tsc emits one-file-per-source; esbuild bundles to a single `dist/host/index.js` with external `node:*` — easier to ship as a CLI bin |
| esbuild (host) | Bun | Bun not required; cross-platform constraint; Node 20 LTS is sufficient |
| `util.parseArgs` | commander / yargs | Host has a 5-flag CLI; `util.parseArgs` (Node stdlib, stable since 18.3) is sufficient and keeps zero runtime deps |
| `chrome.tabs.captureVisibleTab` + canvas | html2canvas | html2canvas DOM-renders to canvas — misses CSS custom properties, SVG, webfonts, shadows; also triggers CSP violations on some sites in MV3. Native API produces real rendered pixels at full DPR fidelity |
| `chrome.tabs.captureVisibleTab` + canvas | modern-screenshot | Same issues as html2canvas; additional bundle weight for no gain |
| Manual PNGs for icons | `@wxt-dev/auto-icons` | auto-icons pulls in `sharp` (native binary download); breaks offline CI; for 4 static icon files it is overkill |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `html2canvas` / `modern-screenshot` | Produces imperfect pixel output; CSP violations in MV3 on strict-CSP sites; large bundle | `chrome.tabs.captureVisibleTab` + canvas `drawImage` crop (native, real pixels) |
| `@interactjs/interact` (scoped) | Package README: "internal part of interactjs and is not meant to be used independently" — each update may introduce breaking changes | `interactjs@1.10.27` (the monorepo's public bundle) |
| `interact.js` (hyphenated npm pkg) | Only at version 1.2.8, last published years ago — stale | `interactjs@1.10.27` |
| Bun | macOS/Linux-friendly but the developer's primary OS is Windows; Bun on Windows is still second-class; `npm` + Node 20 LTS works everywhere | `npm` + Node 20 |
| `sips` for icon generation | macOS-only CLI tool; breaks Windows CI/dev | Commit pre-sized PNGs or use cross-platform image tooling once |
| commander / yargs (host CLI) | 5 flags do not justify a 50 kB dependency; adds install time and attack surface | `util.parseArgs` from `node:util` (stable since Node 18.3) |
| React/Vue in shadow root | Adds 40-100 kB to the injected content script; WXT is framework-agnostic; vanilla DOM + a tiny hyperscript helper is sufficient for a toolbar + post-it | Vanilla DOM with `document.createElement` helpers inside `createShadowRootUi` |
| Static `content_scripts` in manifest | Injects the review UI on every page load — zero footprint requirement violated | `registration: 'runtime'` + `chrome.scripting.executeScript` on Review Mode enter |
| TypeScript `moduleResolution: node` | Deprecated in TS 6 (was `node10`); will error | `moduleResolution: bundler` for extension (WXT sets this), `moduleResolution: nodenext` for host |
| TypeScript `moduleResolution: classic` | Removed in TS 6 | `moduleResolution: bundler` or `nodenext` |

---

## React Fiber Detection (Best-Effort Component Name)

React attaches internal state to DOM nodes via property keys prefixed with a random hash suffix. Detection pattern:

```typescript
function getReactFiber(el: Element): unknown | null {
  const fiberKey = Object.keys(el).find(
    k => k.startsWith('__reactFiber$')       // React 18+
      || k.startsWith('__reactInternalInstance$')  // React 16-17
      || k === '_reactInternalFiber'          // pre-16 (rare)
  );
  return fiberKey ? (el as any)[fiberKey] : null;
}

function getReactComponentName(el: Element): string | null {
  let fiber: any = getReactFiber(el);
  while (fiber) {
    const name = fiber.type?.displayName ?? fiber.type?.name;
    if (name && name !== 'div' && name !== 'span') return name;
    fiber = fiber.return;
  }
  return null;
}
```

**Confidence: MEDIUM** — property names are React internals, not a public API. Verified accurate for React 16-19 as of 2025. React 19 still uses `__reactFiber$<hash>`. If React ever stops attaching these, the capture degrades gracefully (omit `reactComponent` from the note).

**Limitation:** This runs in the ISOLATED world (content script). React fiber on DOM nodes is readable from ISOLATED world — fibers are on the DOM node object itself, not behind a JS realm boundary. No `MAIN` world injection needed for component name capture.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| wxt@0.20.26 | TypeScript 5.x and 6.x | WXT sets `moduleResolution: bundler` internally; TS 6 is fine |
| wxt@0.20.26 | Vite 8.x | WXT pins its own Vite version; do not add `vite` to `devDependencies` separately |
| interactjs@1.10.27 | TypeScript 6 | typings at `index.d.ts` work with bundler resolution; no `@types/interactjs` needed |
| @medv/finder@4.0.2 | ESM only | Package is `"type": "module"`; WXT/Vite handles this correctly; tsc with `nodenext` for host if host ever imports it (it won't — selectors run in the extension only) |
| yaml@2.9.0 | Node 20+, ESM + CJS | `import { stringify } from 'yaml'` works with `moduleResolution: nodenext` |
| esbuild@0.28.0 | Node 20+ | Use `--external:node:*` when bundling host to keep Node built-ins as externals |

---

## Sources

- npm registry (`registry.npmjs.org`) — versions verified 2026-05-31: wxt@0.20.26, @medv/finder@4.0.2, interactjs@1.10.27, yaml@2.9.0, esbuild@0.28.0, typescript@6.0.3, vite@8.0.14, @wxt-dev/auto-icons@1.1.1 (HIGH confidence)
- https://wxt.dev/guide/key-concepts/content-script-ui.html — createShadowRootUi API, cssInjectionMode, isolateEvents, overlay position (HIGH confidence)
- https://wxt.dev/guide/resources/faq.html — rem gotcha, CSS splitting, sharp/auto-icons (HIGH confidence)
- https://wxt.dev/guide/essentials/config/manifest — manual icon config, WXT auto-discovery patterns (HIGH confidence)
- https://github.com/antonmedv/finder — @medv/finder v4.0.2 API, no shadow DOM support (element must be in document, not shadow root — matching PRD §NG5 best-effort caveat) (HIGH confidence)
- https://redreamality.com/blog/the-2025-state-of-browser-extension-frameworks-a-comparative-analysis-of-plasmo-wxt-and-crxjs/ — WXT vs Plasmo vs CRXJS 2025 analysis (MEDIUM confidence, third-party)
- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ — TS 6 breaking changes: types:[], moduleResolution:classic removed, strict defaults (HIGH confidence)
- React fiber property names (`__reactFiber$`, `__reactInternalInstance$`) — confirmed from React DevTools source + community references (MEDIUM confidence — internal API, not documented officially)

---
*Stack research for: MV3 Chrome extension + Node localhost host (stickyfix)*
*Researched: 2026-05-31*
