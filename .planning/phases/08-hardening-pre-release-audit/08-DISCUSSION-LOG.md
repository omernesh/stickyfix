# Phase 8: Hardening + Pre-Release Audit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 8-Hardening + Pre-Release Audit
**Areas discussed:** Error paths, Concurrent-Send stress test, GPL audit banned-list sourcing, Large-payload guard

---

## Error Paths (REL-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Central error→toast mapper + tests | One typed mapper for all 5 failure paths, unit-tested, thin manual UAT | ✓ (Claude's pick) |
| Audit-and-fix gaps + UAT runbook | Add toasts where missing, document manual UAT; no refactor | |
| You decide | Delegated to Claude | (selected by user) |

**User's choice:** "You decide" → Claude selected the central error→toast mapper.
**Notes:** Locked with a mandatory regression guardrail (D-01a): the refactor must
absorb existing toast strings/behavior verbatim — no UX change, working toasts sacred.

---

## Concurrent-Send Stress Test (REL-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Host integration test | 10 concurrent POSTs at a booted host; assert 0001-0010 | ✓ (Claude's pick) |
| Both host + extension UAT | Integration test plus manual Chrome multi-Send | partial (extension UAT folded into regression runbook, non-blocking) |
| You decide | Delegated to Claude | (selected by user) |

**User's choice:** "You decide" → host integration test as the blocking gate; manual
extension multi-Send folded into the regression runbook (D-05), not a CI gate.
**Notes:** Deterministic/CI-able gate prioritized; extends host/test/serial.test.ts.

---

## GPL Audit Banned-List Sourcing (SC-4)

| Option | Description | Selected |
|--------|-------------|----------|
| Derive from our own code, no GPL peek | Known tokens + self-audited magic strings; never open upstream | ✓ (Claude's pick) |
| One-time documented upstream token extraction | Inspect upstream identifier names only, record in CLEAN-ROOM.md | |
| You decide | Delegated to Claude | (selected by user) |

**User's choice:** "You decide" → no-peek policy.
**Notes:** MIT-vs-GPL provenance constraint outranks audit completeness; absolute
clean-room hygiene. Extends scripts/clean-room-check.mjs (zero matches required).

---

## Large-Payload Guard (REL-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-flight size check + host 413 fallback | Extension checks size before POST; host 413 backstop | ✓ (Claude's pick) |
| Rely on host 413 round-trip only | No pre-flight; map 413 to toast | |
| You decide | Delegated to Claude | (selected by user) |

**User's choice:** "You decide" → pre-flight size check + 413 backstop.
**Notes:** Avoids wasted ~12MB round-trip (design-conscious UX); test both boundaries
(11.9MB ok / ~12MB rejected) on extension and host sides.

---

## Claude's Discretion

All four gray areas were delegated to Claude via "you decide". Resolutions are locked
in CONTEXT.md D-01..D-05. Planner retains latitude on error-taxonomy type shape, test
file placement, and whether the pre-flight size check is a shared lib util or inline.

## Deferred Ideas

None — discussion stayed within phase scope. Turnkey onboarding / auto-pairing /
cross-browser packaging remain Phase 9.
