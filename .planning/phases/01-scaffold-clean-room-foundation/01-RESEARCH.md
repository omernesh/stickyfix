# Phase 1: Scaffold & Clean-Room Foundation - Research

**Researched:** 2026-05-31
**Domain:** WXT MV3 extension scaffold + tsc host stub + clean-room grep gate
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Single root `package.json` (no npm workspaces). Extension lives at repo root per WXT conventions; host lives in `host/` and builds separately to `dist/host/`.
- **D-02:** Scripts: `dev` (WXT dev w/ HMR), `build` (extension `wxt build` + host build), `host` (`node dist/host/index.js -- ...`), `check` (`tsc --noEmit` across both + host smoke test).
- **D-03:** WXT **vanilla TypeScript** template (no React/Vue). Pin WXT `0.20.x`.
- **D-04:** Placeholder entrypoints only: `entrypoints/background.ts` (empty service worker, `type: module`) and `entrypoints/popup/` (minimal HTML + main.ts shell). No `review.content/` logic yet.
- **D-05:** Build the host with **`tsc`** (not esbuild) to `dist/host/` as ESM — host runtime is Node built-ins only this phase.
- **D-06:** Host this phase is a **stub** — `index.ts` that parses `--root` via `util.parseArgs` and prints a startup line. Real server is Phase 2.
- **D-07:** Commit **pre-sized PNG icons** at 16/32/48/128 under `public/` (e.g. `public/icon/16.png`) and reference them in `wxt.config.ts` manifest. **Do NOT** use `@wxt-dev/auto-icons`/`sharp`.
- **D-08:** Establish **`sfx-*` / `stickyfix`** identifier namespace now. Never reuse `__opc_*`, `opencode`, `JodusNodus`.
- **D-09:** Wire a **clean-room grep audit** into `npm run check`: grep the tree for `__opc_`, `opencode`, `JodusNodus` (case-insensitive) and fail non-zero on any match.
- **D-10:** `strict: true`; extension tsconfig sets `types: ["chrome"]` explicitly (TS6 default is `[]`); `moduleResolution: "bundler"`. Host: separate `tsconfig.host.json` with `module: "NodeNext"`, `moduleResolution: "nodenext"`, `types: ["node"]`.
- **D-11:** Host smoke test = spawn the host stub against a temp `--root`, assert it starts and prints expected startup fields, exit 0.

### Claude's Discretion

- Exact directory nesting under `entrypoints/`, hyperscript helper choice (if any), tsconfig `target`/`lib` levels, and the precise icon file paths are left to the planner — keep them WXT-idiomatic and Windows-safe.

### Deferred Ideas (OUT OF SCOPE)

- Publishing `stickyfix-host` as an npm `bin` — v2 (FUT-04).
- esbuild for host bundling — only if `tsc` output/startup proves insufficient.
- CI workflow (GitHub Actions) — not in BUILD-* scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BUILD-01 | `npm run build` succeeds on Windows with no macOS-only steps | Cross-platform scripts section; rimraf/node alternatives; WXT Vite-based build |
| BUILD-02 | WXT scaffold produces a loadable (empty-but-valid) MV3 extension via Vite | WXT scaffold, entrypoints, wxt.config.ts, wxt build output structure |
| BUILD-03 | Extension icons (16/32/48/128) ship as committed pre-sized PNGs (no sharp/auto-icons) | Manual icon config in wxt.config.ts; public/ path layout; WXT auto-discovery patterns |
| BUILD-04 | Repo is MIT-licensed, no GPL code present; `sfx-*` identifier namespace from M1 | Clean-room grep gate; Node.js script approach; cross-platform portability |
| BUILD-05 | `npm run check` runs `tsc --noEmit` plus a host smoke test | Two-tsconfig design; smoke test spawn pattern; cross-platform Node approach |
</phase_requirements>

---

## Summary

This phase bootstraps the entire stickyfix repository from nothing to a buildable, loadable scaffold. The primary challenges are: (1) correctly wiring WXT's vanilla TypeScript scaffold with manually committed pre-sized icons instead of the `@wxt-dev/auto-icons` plugin; (2) setting up a two-tsconfig arrangement that satisfies both TS 6's `types: []` default and WXT's Vite-based resolution; (3) building a minimal host stub with `tsc` as ESM to `dist/host/`; (4) implementing a cross-platform (Windows-safe) clean-room grep gate in Node.js; and (5) writing a spawn-based smoke test that asserts the stub starts correctly.

Everything in this phase is structural — no annotation features, no HTTP server, no UI. The output is a repo where `npm install && npm run build` produces a loadable Chrome extension and a runnable Node stub, `npm run check` passes including clean-room audit, and `npm run host -- --root <dir>` prints a startup line.

**Primary recommendation:** Hand-write the project from scratch (do not run `npm create wxt@latest` interactively — use `npm install wxt@0.20.26` and create files manually) to maintain precise control over tsconfig split, script layout, and icon paths from commit one.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Extension build (manifest, entrypoints, icons) | Extension (WXT/Vite) | — | WXT owns the browser extension build pipeline |
| Host CLI stub | Host (Node tsc) | — | Node built-ins only; tsc emits ESM to dist/host/ |
| Type checking (extension) | Build tooling (tsc --noEmit) | — | WXT does not type-check; separate tsc step needed |
| Type checking (host) | Build tooling (tsc --noEmit) | — | tsconfig.host.json points at host/src/ |
| Clean-room audit | Build tooling (Node script) | — | Cross-platform grep must run on Windows without bash |
| Host smoke test | Build tooling (Node spawn) | — | Spawn dist/host/index.js, assert stdout, exit 0 |
| Icon assets | Static files (public/) | Extension manifest | PNGs committed to public/; wxt.config.ts references them |

---

## Standard Stack

### Core (Phase 1 only — install now)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `wxt` | 0.20.26 | MV3 extension framework — build, manifest generation, HMR | Pinned in STACK.md; latest stable as of 2026-05-31 |
| `typescript` | 6.0.3 | Language — extension + host | TS6 pinned; new defaults (strict, esnext, bundler); types:[] breaking change |
| `@types/chrome` | 0.1.42 | Chrome extension API types | Required — TS6 no longer auto-discovers @types/* |
| `@types/node` | 25.9.1 | Node.js built-in types (host) | Required for host tsconfig; no auto-discovery in TS6 |

### Supporting (install now, used in later phases)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `yaml` | 2.9.0 | YAML frontmatter serialization | Phase 2 (host file write); install now to lock version |

### Explicitly Excluded This Phase

| Package | Reason |
|---------|--------|
| `@wxt-dev/auto-icons` | Pulls in `sharp` (native binary); D-07 bans it |
| `esbuild` | D-05 uses `tsc` for host this phase; deferred |
| `@medv/finder` | Phase 5 (element picker) |
| `interactjs` | Phase 4+ (drag UI) |

**Installation (Phase 1 packages only):**
```bash
npm install --save-dev wxt@0.20.26 typescript@6.0.3 @types/chrome@0.1.42 @types/node@25.9.1
npm install yaml@2.9.0
```

---

## Package Legitimacy Audit

> Packages verified against npm registry on 2026-05-31. slopcheck available but defaulted to PyPI — all packages below are JavaScript/Node.js packages verified via `npm view` against the correct npm registry.

| Package | Registry | Age | Source Repo | Postinstall | Disposition |
|---------|----------|-----|-------------|-------------|-------------|
| `wxt@0.20.26` | npm | 2023-06-26 (created) | github.com/wxt-dev/wxt | none | Approved |
| `typescript@6.0.3` | npm | 2012-10-01 (created) | github.com/microsoft/TypeScript | none | Approved |
| `@types/chrome@0.1.42` | npm | 2016-05-17 (created) | github.com/DefinitelyTyped/DefinitelyTyped | none | Approved |
| `@types/node@25.9.1` | npm | (DefinitelyTyped) | github.com/DefinitelyTyped/DefinitelyTyped | none | Approved |
| `yaml@2.9.0` | npm | 2011-04-15 (created) | github.com/eemeli/yaml | none | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck ran against PyPI — inapplicable for Node.js; npm verification substituted per protocol)
**Packages flagged as suspicious [SUS]:** none

All packages confirmed via official sources (npm registry, GitHub) and previously verified in STACK.md. No postinstall scripts on any package. [VERIFIED: npm registry]

---

## Architecture Patterns

### System Architecture Diagram

```
npm run build
   ├── wxt build  ──────────────────────────────────────────────► .output/chrome-mv3/
   │     └── entrypoints/                                              ├── manifest.json
   │           ├── background.ts  ──────────────────────────────────► background.js
   │           └── popup/index.html + main.ts  ──────────────────► popup.html + popup.js
   │     └── public/icon/16.png ... 128.png  ─────────────────────► icon/16.png ... (copied as-is)
   │     └── wxt.config.ts (manifest.icons + name)
   │
   └── tsc -p tsconfig.host.json  ─────────────────────────────► dist/host/
         └── host/src/index.ts                                        └── index.js (ESM)

npm run check
   ├── tsc --noEmit -p tsconfig.json         (extension types — via .wxt/tsconfig.json)
   ├── tsc --noEmit -p tsconfig.host.json    (host types)
   ├── node scripts/clean-room-check.mjs     (grep audit: __opc_ / opencode / JodusNodus)
   └── node scripts/host-smoke-test.mjs      (spawn dist/host/index.js, assert stdout)
```

### Recommended Project Structure

```
stickyfix/                          # repo root = WXT project root
├── package.json                    # type:"module", single-root scripts
├── wxt.config.ts                   # WXT config: name:"stickyfix", manifest.icons
├── tsconfig.json                   # { "extends": ".wxt/tsconfig.json" } only
├── tsconfig.host.json              # NodeNext + types:["node"] for host/src/
├── .gitignore                      # .output/, dist/, node_modules/, .wxt/, .stickyfix-token
├── LICENSE                         # MIT (already committed)
├── PRD.md                          # (already committed)
├── notes/.gitkeep                  # (already committed)
├── entrypoints/
│   ├── background.ts               # defineBackground({ type:'module', main(){} })
│   └── popup/
│       ├── index.html              # minimal HTML, <script type="module" src="./main.ts">
│       └── main.ts                 # placeholder: document.querySelector('#app').textContent='stickyfix'
├── public/
│   └── icon/
│       ├── 16.png                  # pre-sized PNG (committed)
│       ├── 32.png
│       ├── 48.png
│       └── 128.png
├── host/
│   └── src/
│       └── index.ts               # util.parseArgs stub, prints startup line, exits
├── scripts/
│   ├── clean-room-check.mjs       # Node ESM: ripgrep-like scan, exit 1 on match
│   └── host-smoke-test.mjs        # spawn dist/host/index.js, assert stdout, exit 0
└── .wxt/                          # generated by wxt prepare (gitignored)
    └── tsconfig.json              # WXT-generated; root tsconfig.json extends this
```

### Pattern 1: WXT Vanilla TypeScript Project Setup

**What:** WXT vanilla template — minimal config, no framework, entrypoints use WXT's `defineBackground`/`defineConfig` globals.

**When to use:** Any WXT project without React/Vue. Recommended approach for this project.

**How to scaffold (do NOT run `npm create wxt@latest` interactively — hand-write files):**
```bash
npm install --save-dev wxt@0.20.26 typescript@6.0.3 @types/chrome@0.1.42 @types/node@25.9.1
npm install yaml@2.9.0
```

Then run `npx wxt prepare` (or `./node_modules/.bin/wxt prepare`) to generate `.wxt/tsconfig.json`.

**`wxt.config.ts` (verified against official docs):** [VERIFIED: wxt.dev/guide/essentials/config/manifest.html]
```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'stickyfix',
    description: 'Pin sticky notes on any page — your AI reads them.',
    version: '0.1.0',
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      128: '/icon/128.png',
    },
  },
});
```

Paths in `manifest.icons` are relative to `public/`. `/icon/16.png` resolves to `public/icon/16.png`. [VERIFIED: wxt.dev/guide/essentials/config/manifest.html]

**Note on auto-discovery:** WXT also auto-discovers icons by filename patterns like `icon-16.png`, `icon/16.png`, `icon@16.png` from `public/`. Using `manifest.icons` in `wxt.config.ts` is explicit and overrides auto-discovery — preferred for D-07. [VERIFIED: wxt.dev/guide/essentials/config/manifest.html]

**`wxt build` output structure (`.output/chrome-mv3/`):** [CITED: wxt.dev/guide/essentials/entrypoints]
```
.output/chrome-mv3/
├── manifest.json
├── background.js
├── popup.html
├── popup.js          (or chunks/popup-*.js)
└── icon/
    ├── 16.png
    ├── 32.png
    ├── 48.png
    └── 128.png
```

### Pattern 2: Two-Tsconfig Split for TS 6

**What:** TS 6 defaults `types: []` — zero auto-inclusion of `@types/*`. Extension and host need different module resolution. Use two separate tsconfig files.

**Root `tsconfig.json` (extension — just extends WXT's generated config):** [VERIFIED: raw.githubusercontent.com/wxt-dev/wxt/main/templates/vanilla/tsconfig.json]
```json
{
  "extends": "./.wxt/tsconfig.json"
}
```

WXT generates `.wxt/tsconfig.json` via `wxt prepare` (also runs as `postinstall`). The generated config sets `moduleResolution: "bundler"` and includes WXT's own type augmentations via `.wxt/wxt.d.ts`.

**Critical TS 6 gap:** The generated `.wxt/tsconfig.json` may not explicitly include `types: ["chrome"]` — TS 6's empty default means `@types/chrome` won't be picked up unless listed. Override in root `tsconfig.json`: [VERIFIED: devblogs.microsoft.com/typescript/announcing-typescript-6-0/]
```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "types": ["chrome"]
  }
}
```

**`tsconfig.host.json` (host stub — NodeNext ESM):**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist/host",
    "rootDir": "host/src",
    "strict": true,
    "types": ["node"],
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["host/src/**/*.ts"]
}
```

**`module: "NodeNext"` generates `.js` files with `import` statements** (ESM). With `package.json "type": "module"`, these run natively in Node 20+. [ASSUMED — behavior of NodeNext module emit; standard practice but not re-verified in this session]

### Pattern 3: Minimal Background and Popup Entrypoints

**`entrypoints/background.ts`:** [VERIFIED: raw.githubusercontent.com/wxt-dev/wxt/main/templates/vanilla/entrypoints/background.ts]
```typescript
export default defineBackground({
  type: 'module',
  main() {
    // Phase 1: placeholder — Phase 3 adds host discovery, routing, messaging
    console.log('stickyfix background loaded');
  },
});
```

`defineBackground` is a WXT global (no import needed — WXT injects it via `.wxt/wxt.d.ts`). Setting `type: 'module'` ensures the MV3 manifest emits `"background": { "service_worker": "...", "type": "module" }`.

**`entrypoints/popup/index.html`:** [VERIFIED: raw.githubusercontent.com/wxt-dev/wxt/main/templates/vanilla/entrypoints/popup/index.html]
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>stickyfix</title>
  </head>
  <body>
    <div id="sfx-popup-root"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

**`entrypoints/popup/main.ts`** (placeholder):
```typescript
// Phase 1: placeholder shell — Phase 3 adds host list + token entry + Review Mode toggle
const root = document.querySelector<HTMLDivElement>('#sfx-popup-root')!;
root.textContent = 'stickyfix — loading...';
```

### Pattern 4: Host Stub with util.parseArgs

**`host/src/index.ts`** — must be the exact seam Phase 2 extends: [CITED: nodejs.org/api/util.html#utilparseargsconfig]
```typescript
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    origin: { type: 'string', multiple: true },
    name: { type: 'string' },
    'notes-dir': { type: 'string' },
    port: { type: 'string' },
    token: { type: 'string' },
  },
  strict: false,
});

if (!values.root) {
  console.error('stickyfix-host: --root is required');
  process.exit(1);
}

// Phase 1 stub — Phase 2 replaces this with the real HTTP server
const projectName = values.name ?? require('node:path').basename(values.root);
console.log(JSON.stringify({
  app: 'stickyfix',
  name: projectName,
  root: values.root,
  port: null,       // Phase 2: real port after server binds
  token: null,      // Phase 2: real token
  notesDir: null,   // Phase 2: resolved notes dir
}));
```

**Important:** `parseArgs` is in `node:util` (not `util`) for NodeNext resolution. The `multiple: true` option supports repeatable `--origin` flags (HOST-13). `strict: false` allows unknown flags without throwing.

**Why not `import path from 'node:path'`:** Use `import { basename } from 'node:path'` at the top — inline require() shown for illustration; always use top-level imports in TypeScript.

### Pattern 5: Cross-Platform Clean-Room Grep Gate

**What:** Scan the source tree for `__opc_`, `opencode`, `JodusNodus` (case-insensitive) and exit 1 if any match is found. Must work on Windows without bash/ripgrep being pre-installed.

**Recommended approach: Node.js ESM script** — zero extra dependencies, runs on Windows, macOS, Linux with `node scripts/clean-room-check.mjs`. [ASSUMED — cross-platform approach chosen based on Windows-safety requirement; alternatives considered below]

```javascript
// scripts/clean-room-check.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const BANNED = [/__opc_/i, /opencode/i, /JodusNodus/i];
const SCAN_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.output', 'dist', '.wxt']);

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), found);
    } else if (SCAN_EXTS.has(extname(entry.name))) {
      const full = join(dir, entry.name);
      const text = readFileSync(full, 'utf8');
      for (const pattern of BANNED) {
        const match = text.match(pattern);
        if (match) found.push({ file: full, match: match[0] });
      }
    }
  }
  return found;
}

const hits = walk(process.cwd());
if (hits.length > 0) {
  console.error('CLEAN-ROOM VIOLATION — banned identifiers found:');
  for (const h of hits) console.error(`  ${h.file}: "${h.match}"`);
  process.exit(1);
}
console.log('clean-room audit: PASS — no banned identifiers found');
```

**Alternatives considered:**
- `ripgrep` (rg): not guaranteed present on Windows dev machines — would need install instructions
- `findstr` (Windows built-in): regex support is limited; not portable to macOS
- Node.js script: always available where npm works; chosen for portability

### Pattern 6: Host Smoke Test

**What:** Spawn `dist/host/index.js` with a temp `--root`, read its stdout line, assert fields, exit 0.

```javascript
// scripts/host-smoke-test.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpRoot = mkdtempSync(join(tmpdir(), 'sfx-smoke-'));
try {
  const result = spawnSync(
    process.execPath,
    ['dist/host/index.js', '--root', tmpRoot],
    { encoding: 'utf8', timeout: 5000 }
  );
  if (result.status !== 0 || result.error) {
    console.error('smoke test: host exited non-zero or errored');
    console.error(result.stderr);
    process.exit(1);
  }
  const parsed = JSON.parse(result.stdout.trim());
  if (parsed.app !== 'stickyfix') {
    console.error(`smoke test: expected app:"stickyfix", got: ${JSON.stringify(parsed.app)}`);
    process.exit(1);
  }
  if (parsed.root !== tmpRoot) {
    console.error(`smoke test: root mismatch — expected ${tmpRoot}, got ${parsed.root}`);
    process.exit(1);
  }
  console.log('smoke test: PASS');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
```

**Notes:**
- `process.execPath` is the path to the current Node binary — cross-platform, no PATH dependency.
- `spawnSync` with `timeout: 5000` prevents hang if the stub blocks.
- The stub must exit after printing — Phase 2 replaces this with a long-running server; the smoke test for Phase 2 will be `GET /status` instead.

### Pattern 7: package.json Scripts (Cross-Platform)

```json
{
  "name": "stickyfix",
  "version": "0.1.0",
  "description": "Pin sticky notes on any page — your AI reads them.",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build && tsc -p tsconfig.host.json",
    "host": "node dist/host/index.js",
    "check": "tsc --noEmit && tsc --noEmit -p tsconfig.host.json && node scripts/clean-room-check.mjs && node scripts/host-smoke-test.mjs",
    "postinstall": "wxt prepare"
  },
  "devDependencies": {
    "@types/chrome": "0.1.42",
    "@types/node": "25.9.1",
    "typescript": "6.0.3",
    "wxt": "0.20.26"
  },
  "dependencies": {
    "yaml": "2.9.0"
  }
}
```

**Cross-platform notes:**
- All scripts use Node or WXT executables — no `rm -rf`, no `export`, no Unix glob patterns.
- `host` script: user invokes as `npm run host -- --root <dir>` (the `--` passes args through npm to `node dist/host/index.js`).
- `check` chains with `&&` — each step must pass before the next runs. Windows PowerShell handles `&&` in npm scripts via npm's own shell (cmd.exe on Windows, not PowerShell directly).
- Do NOT use `rimraf`, `cross-env`, or `ts-node` — not needed this phase, keeps deps minimal.

### Pattern 8: .gitignore

```gitignore
# WXT build output
.output/

# Host build output
dist/

# Dependencies
node_modules/

# WXT generated files (regenerated by postinstall/wxt prepare)
.wxt/

# Host token (per-project, never commit)
.stickyfix-token

# OS
.DS_Store
Thumbs.db
```

### Anti-Patterns to Avoid

- **Running `npm create wxt@latest` interactively:** the CLI prompts for framework choice and creates extra files (assets/, components/); hand-writing gives cleaner control. The vanilla template's `wxt.config.ts` is `defineConfig({})` — trivially replicated.
- **Adding `vite` to devDependencies separately:** WXT pins its own Vite version internally. Adding a mismatched `vite` causes peer dep conflicts. [VERIFIED: STACK.md — "WXT owns Vite config; do not add a separate vite.config"]
- **Using `tsc --outDir` without `--module NodeNext` for the host:** `tsc` with `--module esnext` emits `import` statements but without `.js` extensions — Node's ESM loader requires explicit `.js` extensions. `NodeNext` mode adds them. [ASSUMED — standard tsc/Node ESM behavior; not re-verified in this session]
- **Omitting `types: ["chrome"]` in root tsconfig.json:** TS 6 changed the default to `[]`. Without it, `chrome.*` APIs are all `any` and no type errors fire on the extension side. [VERIFIED: devblogs.microsoft.com/typescript/announcing-typescript-6-0/]
- **Using Windows path separators in `manifest.icons`:** Always use forward slashes — WXT normalizes paths for the manifest but the convention is forward slashes. The `public/` directory mapping already handles OS path differences internally.
- **Putting scripts in a `"bin"` field in package.json before the host is a real CLI:** deferred to v2 (FUT-04). This phase's `npm run host` is sufficient.
- **Scanning `node_modules` in the clean-room script:** the grep gate must skip it or it will hit npm package README files that reference "opencode" or other matches. The skip list in the Node script above handles this.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Extension manifest generation | Custom manifest.json | WXT `wxt.config.ts` manifest field | WXT handles MV3 specifics, popup action, permissions, icon injection, HMR |
| Icon resizing at install time | Shell script with `sips`/ImageMagick | Commit 4 pre-sized PNGs | Zero tooling dependency at build time; sips is macOS-only |
| CLI arg parsing (host) | Custom `process.argv` parsing | `node:util` `parseArgs` | Handles `--flag value`, `--flag=value`, `--flag` (boolean), `multiple:true`; stable since Node 18.3 |
| Cross-platform file scan | `grep`, `findstr`, bash globs | Node.js `fs.readdirSync` walk | Works on Windows without extra tools |
| TypeScript type checking for extension | Bundle-time checks | `tsc --noEmit` step in `check` | WXT/Vite does not type-check at bundle time |

**Key insight:** The scaffold phase has almost no complex logic — the value is in wiring things correctly, not in custom code. Prefer established WXT patterns and Node stdlib.

---

## Common Pitfalls

### Pitfall 1: TS 6 types:[] Default Breaks Chrome API Types
**What goes wrong:** After `wxt prepare` generates `.wxt/tsconfig.json`, root `tsconfig.json` extends it. But TS 6's new default is `types: []` — empty. If you don't explicitly add `"types": ["chrome"]` in the root tsconfig, all `chrome.*` calls resolve to `any`. No type errors fire. The extension builds, but type safety is gone.
**Why it happens:** TS 6 changed the default from auto-discovering all `@types/*` to requiring explicit listing. The WXT-generated tsconfig may not include `"chrome"` in its types array.
**How to avoid:** In root `tsconfig.json`, add `"compilerOptions": { "types": ["chrome"] }` after extending `.wxt/tsconfig.json`. Run `tsc --noEmit` and verify `chrome.runtime.id` resolves to `string`, not `any`.
**Warning signs:** `tsc --noEmit` passes on a file using `chrome.tabs.query(undefined, callback)` without complaint.

### Pitfall 2: tsc NodeNext Emit Requires .js Import Extensions
**What goes wrong:** `tsconfig.host.json` with `"module": "NodeNext"` emits `.js` files, but if any `host/src/` file imports another file without the `.js` extension (e.g. `import { foo } from './utils'`), Node's ESM loader throws `ERR_MODULE_NOT_FOUND` at runtime.
**Why it happens:** TypeScript with `NodeNext` enforces import extension requirements at compile time (it errors), but the extension-less pattern is a common habit from CommonJS.
**How to avoid:** Always use `.js` extensions in imports within `host/src/`, even though the source files are `.ts`: `import { foo } from './utils.js'`. TypeScript's NodeNext resolver maps `.js` → `.ts` correctly at compile time.
**Warning signs:** `tsc -p tsconfig.host.json` completes but `node dist/host/index.js` throws `ERR_MODULE_NOT_FOUND`.

### Pitfall 3: npm run host Args Double-Dash Syntax
**What goes wrong:** Running `npm run host --root /some/dir` passes `--root` to npm, not to the script. User gets `npm run host: unknown option --root`.
**Why it happens:** npm intercepts flags before the `--` separator.
**How to avoid:** The correct invocation is `npm run host -- --root /some/dir`. Document this in the README. The `--` tells npm to stop consuming flags and pass the rest to the script.
**Warning signs:** `npm run host --root /path` fails; `npm run host -- --root /path` works.

### Pitfall 4: WXT prepare Not Run After Fresh Clone
**What goes wrong:** After `npm install`, `.wxt/tsconfig.json` does not exist yet. `tsc --noEmit` on the root tsconfig fails with "cannot find extends".
**Why it happens:** `.wxt/` is gitignored; it's generated by `wxt prepare`.
**How to avoid:** The `"postinstall": "wxt prepare"` script in `package.json` automatically runs `wxt prepare` after `npm install`. Verify this is present. The vanilla template already includes this pattern. [VERIFIED: raw.githubusercontent.com/wxt-dev/wxt/main/templates/vanilla/package.json]
**Warning signs:** Fresh clone + `npm install` + `tsc --noEmit` fails with "Cannot find file '.wxt/tsconfig.json'".

### Pitfall 5: Clean-Room Check Scanning .output/ or dist/
**What goes wrong:** The clean-room grep script scans `.output/` or `dist/` — WXT bundles the full extension there, including all npm package readmes and minified code. Those directories may contain strings matching the banned patterns from third-party packages.
**Why it happens:** Simple recursive walk without a skip list.
**How to avoid:** Explicitly skip `node_modules`, `.git`, `.output`, `dist`, `.wxt` in the walk function (as shown in Pattern 5 above). Also skip `.planning/` — research files legitimately reference "opencode" and "JodusNodus".
**Warning signs:** `npm run check` fails with "CLEAN-ROOM VIOLATION" pointing at a file in `.output/` or `.planning/`.

### Pitfall 6: Smoke Test Running Before Host is Built
**What goes wrong:** `npm run check` runs the smoke test, but `dist/host/index.js` doesn't exist yet (host not built). The smoke test fails with `ENOENT`.
**Why it happens:** `check` script runs without a prior `build` step when running on a freshly cloned repo.
**How to avoid:** The smoke test should check for `dist/host/index.js` existence and exit with a helpful message if missing, OR the `check` script should build first: `"check": "npm run build && tsc --noEmit && ..."`. Alternatively, document that `npm run build` must be run before `npm run check` on a fresh clone.
**Warning signs:** CI fails on first run with "ENOENT: no such file or directory, dist/host/index.js".

### Pitfall 7: Windows Path Separators in Node Script File Paths
**What goes wrong:** The clean-room check or smoke test script uses `path.join` but then compares or logs paths using `/` as separator hardcoded — or uses `__dirname` (not available in ESM).
**Why it happens:** ESM `.mjs` files have no `__dirname`; must use `import.meta.url` + `fileURLToPath`.
**How to avoid:** In `scripts/*.mjs`, use:
```javascript
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
```
Or pass `process.cwd()` as the root for the walk (which is the repo root when invoked via npm scripts).

---

## Code Examples

Verified patterns from official sources:

### WXT Background Entrypoint (defineBackground)
```typescript
// Source: raw.githubusercontent.com/wxt-dev/wxt/main/templates/vanilla/entrypoints/background.ts
export default defineBackground({
  type: 'module',
  main() {
    console.log('stickyfix background loaded');
  },
});
```
`defineBackground` is a WXT global — no import needed. WXT injects the type via `.wxt/wxt.d.ts`.

### WXT Popup HTML (entrypoints/popup/index.html)
```html
<!-- Source: raw.githubusercontent.com/wxt-dev/wxt/main/templates/vanilla/entrypoints/popup/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>stickyfix</title>
  </head>
  <body>
    <div id="sfx-popup-root"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

### Manual Icon Config in wxt.config.ts
```typescript
// Source: wxt.dev/guide/essentials/config/manifest.html
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'stickyfix',
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      128: '/icon/128.png',
    },
  },
});
```
Files must exist at `public/icon/16.png` etc. The leading `/` is relative to `public/`.

### util.parseArgs for Host Stub
```typescript
// Source: nodejs.org/api/util.html (Node 18.3+ stable)
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    origin: { type: 'string', multiple: true },
    name: { type: 'string' },
  },
  strict: false,
});
```

### TypeScript 6 Two-Config Setup
```json
// tsconfig.json (root — extension)
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "types": ["chrome"]
  }
}
```
```json
// tsconfig.host.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist/host",
    "rootDir": "host/src",
    "strict": true,
    "types": ["node"],
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["host/src/**/*.ts"]
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@types/*` auto-included | `types: []` default (explicit listing required) | TypeScript 6.0 (2026) | Must add `"types": ["chrome"]` and `"types": ["node"]` explicitly |
| `moduleResolution: "node"` | `"bundler"` (WXT) / `"nodenext"` (host) | TypeScript 5.0+ (node deprecated in TS6) | `moduleResolution: "node"` removed in TS6; must migrate |
| `moduleResolution: "classic"` | Removed | TypeScript 6.0 | Will error if present |
| `strict: false` default | `strict: true` default | TypeScript 6.0 | Likely already using strict; no behavior change for new projects |
| `module: "commonjs"` default | `module: "esnext"` default | TypeScript 6.0 | Host tsconfig should explicitly set `"module": "NodeNext"` |
| Single icon source + WXT auto-icons/sharp | 4 committed pre-sized PNGs | This project (D-07) | Eliminates native binary dep; safe for Windows offline CI |
| `npm create wxt@latest` template | Hand-written files | — | Template produces React/Vue-specific boilerplate; vanilla is trivial to write |

**Deprecated/outdated:**
- `@wxt-dev/auto-icons`: pulls `sharp`; banned by D-07
- `esbuild` for host: deferred; `tsc` used this phase (D-05)
- `"postinstall": "wxt prepare"` IS the correct pattern — do not add a separate `"prepare"` script (npm runs `prepare` on publish, not just install)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `tsc` with `module: "NodeNext"` emits `.js` files with explicit extension imports; `dist/host/index.js` is directly runnable by Node 20 | Pattern 2, Pattern 6 | Host fails to start; fix: switch to esbuild or add `--module esnext` + rename output |
| A2 | `&&` in npm `scripts` works cross-platform (Windows npm uses cmd.exe as shell; cmd.exe supports `&&`) | Pattern 7 | `npm run check` fails on Windows; fix: use a Node runner script |
| A3 | WXT-generated `.wxt/tsconfig.json` does NOT include `"types": ["chrome"]` — requires explicit override in root tsconfig | Pitfall 1, Pattern 2 | If WXT already adds it, duplicate is harmless; if it does add it, no risk |
| A4 | `scripts/*.mjs` files with `.mjs` extension run via `node scripts/...mjs` without extra config (package.json `"type":"module"` also allows `.js` for ESM) | Pattern 5, Pattern 6 | No risk — `.mjs` always ESM regardless of `type` field |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

---

## Open Questions

1. **Does `wxt prepare` generate `types: ["chrome"]` in `.wxt/tsconfig.json`?**
   - What we know: WXT installs `@types/chrome` as a peer dep and its generated tsconfig extends WXT's internal config.
   - What's unclear: Whether WXT automatically includes `"types": ["chrome"]` or leaves it to the project.
   - Recommendation: Always add `"types": ["chrome"]` explicitly in root `tsconfig.json` — harmless if WXT already adds it, essential if it doesn't.

2. **Does `tsc -p tsconfig.host.json` with NodeNext emit runnable ESM?**
   - What we know: NodeNext module mode emits `import` statements with `.js` extensions; `"type": "module"` in package.json makes Node treat them as ESM.
   - What's unclear: Whether the single-root `package.json "type": "module"` applies to files in `dist/host/` (it should — Node uses the nearest package.json).
   - Recommendation: Test `node dist/host/index.js` after first `tsc -p tsconfig.host.json` run. If it fails with a CJS/ESM error, the fix is straightforward.

3. **Icon path format in manifest.icons: `/icon/16.png` vs `icon/16.png`?**
   - What we know: WXT docs show leading-slash form (`/icon/16.png`) for manifest.icons.
   - What's unclear: Whether WXT requires the leading slash or strips it.
   - Recommendation: Use leading slash as shown in official docs. Files go in `public/icon/16.png`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Host stub, scripts | ✓ | v25.8.1 | — |
| npm | Package management | ✓ | 11.9.0 | — |
| `npx` / `wxt` CLI | wxt prepare, wxt build | ✓ (via npm scripts) | via wxt@0.20.26 | `./node_modules/.bin/wxt` |
| Windows PowerShell | Script execution | ✓ (Windows 11) | — | npm scripts use cmd.exe, not PS |

**Missing dependencies with no fallback:** None.

**Note on PowerShell vs cmd.exe:** npm scripts run in cmd.exe on Windows, not PowerShell. The `&&` chaining in npm scripts is cmd.exe syntax and works correctly. Do not use PowerShell-specific syntax (`$?`, backtick continuation) in package.json scripts.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None (Phase 1 is scaffold only — no application logic to unit test) |
| Config file | none |
| Quick run command | `npm run check` |
| Full suite command | `npm run check` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BUILD-01 | `npm run build` succeeds on Windows | manual (Windows machine) | `npm run build` | N/A — run in CI |
| BUILD-02 | Extension loads in Chrome as empty-but-valid MV3 | manual | `npm run build` + load unpacked | ❌ Wave 0 |
| BUILD-03 | Icons ship as pre-sized PNGs, no sharp dep | structural | `ls public/icon/*.png && npm ls sharp` | ❌ Wave 0 |
| BUILD-04 | Clean-room audit passes, sfx-* namespace used | automated | `node scripts/clean-room-check.mjs` | ❌ Wave 0 |
| BUILD-05 | `tsc --noEmit` passes on both tsconfigs + smoke test | automated | `npm run check` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run check` (sub-30s: two tsc --noEmit + clean-room scan + smoke test)
- **Per wave merge:** `npm run check` + `npm run build` + manual load-unpacked verification
- **Phase gate:** Full `npm run check` green, extension loadable in Chrome, before phase close

### Wave 0 Gaps

- [ ] `scripts/clean-room-check.mjs` — BUILD-04 grep gate (create in Wave 1)
- [ ] `scripts/host-smoke-test.mjs` — BUILD-05 spawn test (create in Wave 1)
- [ ] `host/src/index.ts` — stub that emits JSON startup line (create in Wave 1)
- [ ] `tsconfig.host.json` — NodeNext config for host (create in Wave 1)
- [ ] `public/icon/{16,32,48,128}.png` — pre-sized PNGs (create or source in Wave 1)
- [ ] `wxt.config.ts` — manifest.icons + name (create in Wave 1)

*(Note: No test framework install needed — all validation is tsc + Node scripts already in the plan)*

---

## Security Domain

> `security_enforcement: true` in config.json. ASVS Level 1 applicable.

### Applicable ASVS Categories (Phase 1 scope)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase 1 has no auth; host is a stub |
| V3 Session Management | No | No session this phase |
| V4 Access Control | No | No endpoints this phase |
| V5 Input Validation | Minimal | `parseArgs` validates CLI args; `--root` is printed not executed |
| V6 Cryptography | No | No crypto this phase |
| V14 Configuration | Yes | No secrets in committed files; .stickyfix-token in .gitignore |

### Phase 1 Security Invariants

| Invariant | Implementation |
|-----------|----------------|
| No GPL code in repo | Clean-room grep gate (`scripts/clean-room-check.mjs`) wired into `npm run check` |
| No secrets committed | `.stickyfix-token` in `.gitignore`; no tokens in Phase 1 code |
| `sfx-*` namespace | All DOM ids, package name, host id use `stickyfix`/`sfx-` prefix — enforced by grep gate |
| MIT LICENSE committed | Already in repo; must remain unchanged |

### Known Threat Patterns for Scaffold Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| GPL identifier leakage | Repudiation (license) | Clean-room grep gate in `npm run check` |
| Secrets in code | Information Disclosure | .gitignore + no hardcoded tokens in Phase 1 |
| Supply chain (npm install) | Tampering | Package legitimacy audit above; no postinstall scripts on any Phase 1 dep |

---

## Sources

### Primary (HIGH confidence)
- `raw.githubusercontent.com/wxt-dev/wxt/main/templates/vanilla/*` — vanilla template package.json, wxt.config.ts, tsconfig.json, background.ts, popup/index.html (fetched 2026-05-31)
- `wxt.dev/guide/essentials/config/manifest.html` — manifest.icons config, icon auto-discovery patterns, leading-slash path convention (fetched 2026-05-31)
- `wxt.dev/guide/essentials/entrypoints` — background.ts defineBackground API, popup directory structure (fetched 2026-05-31)
- `devblogs.microsoft.com/typescript/announcing-typescript-6-0/` — TS6 breaking changes: types:[], moduleResolution classic removed, strict:true default, module:esnext default (fetched 2026-05-31)
- npm registry — wxt@0.20.26, typescript@6.0.3, @types/chrome@0.1.42, @types/node@25.9.1, yaml@2.9.0 verified 2026-05-31
- `.planning/research/STACK.md` — pinned versions, WXT shadow-root gotchas, icon strategy (HIGH — project's own prior research)
- `.planning/research/PITFALLS.md` — cross-platform build pitfalls, clean-room requirements (HIGH)
- `01-CONTEXT.md` — locked decisions D-01 through D-11 (HIGH — user decisions)

### Secondary (MEDIUM confidence)
- `wxt.dev/guide/essentials/config/typescript.html` — WXT tsconfig.json generation pattern (fetched 2026-05-31; docs incomplete on .wxt/tsconfig.json contents)
- Node.js docs (nodejs.org/api/util.html) — `util.parseArgs` API with `multiple: true`, `strict: false` options [ASSUMED — from training knowledge, not fetched in this session]

### Tertiary (LOW confidence)
- None — all critical claims are verified or cited.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all package versions verified against npm registry
- Architecture: HIGH — WXT vanilla template files fetched directly from GitHub; manifest.icons from official WXT docs
- Pitfalls: HIGH — TS6 breaking changes from official Microsoft blog; cross-platform issues from project PITFALLS.md
- Clean-room scripts: MEDIUM — Node.js fs walk approach is well-established; specific script logic is original

**Research date:** 2026-05-31
**Valid until:** 2026-06-30 (WXT 0.20.x; TS 6.0.x — stable releases)

---

*Phase: 1-Scaffold & Clean-Room Foundation*
*Research completed: 2026-05-31*
