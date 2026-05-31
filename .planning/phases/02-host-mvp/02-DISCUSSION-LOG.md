# Phase 2: Host MVP - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md.

**Date:** 2026-05-31
**Phase:** 2-Host MVP
**Mode:** --auto (recommended defaults, single pass)
**Areas discussed:** Module structure, Test framework, Serial mutex, Body parsing/limits, CORS+token transport, Token lifecycle, Port discovery, Path safety

---

## Module Structure
Selected: Split `host/src/` modules (server, write-note, serial, config, security) per PRD §11. Alt: single index.ts (rejected — harder to unit-test).

## Test Framework
Selected: Node built-in `node:test` + `node:assert` (zero dep, cross-platform; PRD M2 mandates serial + path-safety unit tests). Alt: vitest/jest (rejected — adds deps to a near-zero-dep host).

## Serial Mutex
Selected: in-process promise-queue; scan notesDir for max `NNNN` incl `*.read.md`, +1, zero-pad 4. Alt: lockfile/DB (rejected — overkill, single process).

## Body Parsing / Limits
Selected: manual stream read, hard 12 MB cap → 413; malformed JSON → 400.

## CORS + Token Transport
Selected: echo Origin in ACAO, allow `X-Stickyfix-Token`, methods GET/POST/OPTIONS; token required only on POST /annotation (401), `/status` open.

## Token Lifecycle
Selected: `--token` → `STICKYFIX_TOKEN` env → `crypto.randomUUID()`; print on startup; write gitignored `<root>/.stickyfix-token`.

## Port Discovery
Selected: honor `--port` if free, else first free in 39240–39260; bind 127.0.0.1 only.

## Path Safety
Selected: `path.resolve` notesDir + assert inside `--root`; reject traversal; v1 writes only fixed notesDir.

## Claude's Discretion
- Internal signatures, stream-read details, free-port probe mechanics, node:test file layout, class-vs-function module style.

## Deferred Ideas
- `/sessions`/`/claim`/`/unclaim` (dropped), npm `bin` publish (FUT-04), future target-subpath writes.
