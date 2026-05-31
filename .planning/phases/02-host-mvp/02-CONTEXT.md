# Phase 2: Host MVP - Context

**Gathered:** 2026-05-31
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase turns the Phase 1 host **stub** into a real localhost server. `npm run host -- --root <dir>` starts an HTTP server bound to `127.0.0.1` on a free port in 39240–39260 that: serves `GET /status` (no token), accepts `POST /annotation` (token-required), assigns running serials via an in-process mutex, and writes `<serial>-<ts>.md` (+ decoded `+N.png` images) safely inside `--root`. Includes CORS, body-size cap (413), path-traversal rejection, and unit tests for serial assignment + path safety.

In scope: HTTP server + routing (`/status`, `/annotation`, `OPTIONS`), token auth, serial mutex, frontmatter `.md` writing, PNG data-URL decode/write, CORS, port discovery, path/size guards, `.stickyfix-token` + `.gitkeep`, `util.parseArgs` CLI completion (all flags), unit tests (`node:test`).

Out of scope (later phases): anything extension-side (discovery, routing, UI, capture) is Phase 3+. No element/region capture logic here — the host only receives already-cropped PNG data-URLs and writes them. No `/sessions`/`/claim`/`/unclaim` (PRD drops those upstream endpoints).
</domain>

<decisions>
## Implementation Decisions

### Module Structure
- **D-01:** Split the host into focused modules under `host/src/` per PRD §11 layout: `index.ts` (CLI entry — extends the Phase 1 `parseArgs` stub), `server.ts` (HTTP server + routing), `write-note.ts` (frontmatter `.md` + PNG write), `serial.ts` (mutex + serial assignment), `config.ts` (resolve/validate CLI args → config), `security.ts` (token check, CORS, path safety). Build remains `tsc` → `dist/host/` (NodeNext ESM), per Phase 1 D-05.

### Test Framework
- **D-02:** Use Node's **built-in `node:test` + `node:assert`** (zero new dependency, cross-platform) for unit tests. PRD M2 mandates unit-testing serial assignment + path safety. Add a `test` script and fold it into `npm run check` alongside the existing tsc/clean-room/smoke steps. (No vitest/jest — keeps the host near-zero-dep.)

### Serial Assignment & Concurrency
- **D-03:** Assign serials under an **in-process promise-queue mutex** (each `POST /annotation` awaits a chained promise so writes serialize). On each write: scan `notesDir` for existing `NNNN-*.md` **including `*.read.md`**, take `max(serial)+1`, zero-pad to 4 (`0001`). Two concurrent POSTs must yield `0001` and `0002` with no collision (PITFALLS serial-race; Success Criterion 3).

### Request Body Parsing & Limits
- **D-04:** Read the request body as a stream with a **hard 12 MB cap**; abort and return **413** if exceeded (screenshots are base64). `JSON.parse` the body; malformed JSON → **400** `{ok:false,error}`. Success/error responses are JSON.

### Routing, CORS & Token Transport
- **D-05:** Routes: `GET /status` (no token), `POST /annotation` (token required), `OPTIONS *` (CORS preflight). CORS: **echo the request `Origin`** into `Access-Control-Allow-Origin`, allow methods `GET,POST,OPTIONS`, allow header `X-Stickyfix-Token`. Token is the real gate (CORS is permissive by necessity, §8.4).
- **D-06:** Token transport = custom header **`X-Stickyfix-Token`**. Missing/wrong token on `POST /annotation` → **401** `{ok:false,error}`. `/status` returns `{app,version,name,root,notesDir,origins}` and never requires a token / returns no secrets.

### Token Lifecycle
- **D-07:** Token resolution order: `--token` → `STICKYFIX_TOKEN` env → generate `crypto.randomUUID()`. Print the token (and name, bound port, declared origins, absolute notesDir) on startup. Also write the token to gitignored `<root>/.stickyfix-token` for convenience (HOST-12).

### Port Discovery & Binding
- **D-08:** Bind **`127.0.0.1` only** (never `0.0.0.0`). Honor `--port` if provided and free; otherwise take the first free port in **39240–39260**. Must NOT be reachable from another LAN host (HOST-02, Success Criterion via acceptance test).

### File Writing
- **D-09:** Filename `<serial>-<YYYYMMDD-HHmmss>.md` (local time). Frontmatter via the **`yaml`** dep (safe serialization of URLs/titles with colons/quotes — STACK.md). Payload carries zero+ already-cropped PNG data-URLs; decode each and write **next to the `.md`** as `<base>+<N>.png` (N from 1, payload order); record relative paths in `screenshots:` frontmatter + inline body. Create `notesDir` if missing + add `.gitkeep`. No `assets/` subdir.

### Path & Size Safety
- **D-10:** `--notes-dir` (default `<root>/notes`) must `path.resolve` to **inside `--root`** — reject otherwise. Any future target subpath is `path.resolve`d and asserted within `--root`; reject traversal (`../../etc/passwd` → rejected). No eval, no shelling out, no writes outside `notesDir` (§8.4). Body cap 12 MB → 413.

### Note File Body Shape
- **D-11:** Match PRD §9.2: frontmatter (`id, created, mode, url, title, viewport, selector?, react_component?, screenshots, status: unread`) + comment body. Element notes add the "## Element context" section, curated computed-styles table, truncated `outerHTML`, and a "### Screenshots" image list. Free notes omit the element section. (Element capture *fields* are produced by the extension in Phase 5 — the host just serializes whatever the payload provides per the §9.1 shape, tolerating absent element data.)

### Claude's Discretion
- Internal function signatures, exact stream-read implementation, how port-scanning probes for a free port, the precise `node:test` file layout, and whether `config.ts`/`security.ts` export classes vs functions — left to the planner. Keep Node built-ins + the single `yaml` dep.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Host spec & contracts
- `PRD.md` §8 — `stickyfix-host` spec (CLI, endpoints, file writing, security) — authoritative for this phase
- `PRD.md` §8.4 — Security must-haves (127.0.0.1 bind, token auth, path safety, CORS)
- `PRD.md` §9.1 — Annotation payload shape (extension → host)
- `PRD.md` §9.2 — Note file format on disk (frontmatter + body)
- `PRD.md` §14 — Acceptance criteria #2, #6, #7, #10 (status JSON, serial increment, token-mismatch toast, LAN-unreachable)

### Research & planning artifacts
- `.planning/research/ARCHITECTURE.md` — serial mutex pattern, CORS, host data flow, build order
- `.planning/research/PITFALLS.md` — serial race (explicit promise queue), path traversal, CORS preflight, body-size handling
- `.planning/research/STACK.md` — `yaml` (eemeli) dep rationale; Node built-ins only otherwise
- `.planning/REQUIREMENTS.md` — HOST-01..HOST-13 (this phase's requirements)
- `.planning/phases/01-scaffold-clean-room-foundation/01-CONTEXT.md` — Phase 1 locked decisions (tsc host build, NodeNext ESM, sfx-*/stickyfix namespace, host smoke test)
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `host/src/index.ts` (Phase 1 stub): already parses `--root`, `--origin` (multiple), `--name`, `--notes-dir`, `--port`, `--token` via `util.parseArgs` and prints a JSON startup line with `app:"stickyfix"`. Phase 2 extends this into the real CLI entry that boots `server.ts`.
- `tsconfig.host.json`: NodeNext ESM config already targets `dist/host/`.
- `scripts/host-smoke-test.mjs`: spawn-and-assert smoke test — extend/keep so `npm run check` still proves the host boots.
- `scripts/clean-room-check.mjs`: clean-room gate already wired into `npm run check`; new host modules must stay in the `sfx-*`/`stickyfix` namespace (no `__opc_*`/`opencode`/`JodusNodus`).

### Established Patterns
- Build = `tsc` to `dist/host/` (no bundler), Node built-ins + single `yaml` dep. `npm run check` is the per-task verification harness (tsc ×2 + clean-room + smoke; Phase 2 adds `node:test`).
- `"type":"module"` package; host emits ESM.

### Integration Points
- `index.ts` startup line is the seam the smoke test reads; keep its `{app:"stickyfix", name, root, ..., port, notesDir}` shape (now with a real bound port).
- The HTTP server's `/status` JSON is the discovery handshake the Phase 3 extension will probe — get its shape right now (`{app,version,name,root,notesDir,origins}`).
</code_context>

<specifics>
## Specific Ideas

- `/status` `version` should be read from `package.json` (single source of truth), not hard-coded.
- Serial scan must include `*.read.md` so the skill's rename (Phase 7) never causes a serial to be reused.
- Keep the success/error JSON envelope consistent: `{ok:true,file,serial}` / `{ok:false,error}` (§8.2).
</specifics>

<deferred>
## Deferred Ideas

- `/sessions`, `/claim`, `/unclaim` endpoints — explicitly dropped (OpenCode session-binding we don't need; §Appendix A).
- Publishing `stickyfix-host` as an npm `bin` — v2 (FUT-04).
- Future target-subpath writes (beyond the fixed notesDir) — the path-safety guard is built to support it, but v1 writes only to notesDir.

None block Phase 2.
</deferred>

---

*Phase: 2-Host MVP*
*Context gathered: 2026-05-31*
