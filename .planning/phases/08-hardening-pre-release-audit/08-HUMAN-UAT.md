---
status: partial
phase: 08-hardening-pre-release-audit
source: [08-VERIFICATION.md]
started: 2026-06-04
updated: 2026-06-04
---

## Current Test

[awaiting human testing]

> Detailed repro steps for every item below live in the full runbook:
> `.planning/phases/08-hardening-pre-release-audit/08-UAT.md`
> (5 failure paths + D-05 regression + D-04 pre-flight + D-02a multi-Send).
> Run the extension built by this session against the running UAT host
> (`--root D:/docker/stickyfix-uat`, port 39240).

## Tests

### 1. REL-01 — all five failure paths surface a visible toast (SC-1)
expected: Each path shows its verbatim toast, never a silent drop —
  host unreachable → "Host unreachable: …"; 401 → "unauthorized";
  no token set → "No token set for host"; 413 oversize → "Payload Too Large";
  no host for origin → "No host mapped for origin: …".
result: [pending]

### 2. REL-01 / SW-evicted-mid-flight — the critical path (SC-1)
expected: With Review Mode active, Stop the service worker via chrome://extensions,
  then Send. The dead-channel guard fires and an "Extension error: …" toast appears —
  the note is NOT silently dropped.
result: [pending]

### 3. D-05a — SW idle-eviction state survival
expected: After the service worker is evicted, chrome.storage.local rehydrates host
  registry/token/origin map; a subsequent Send still routes correctly to the host.
result: [pending]

### 4. D-05b — multi-note serial increment (live, extension-driven)
expected: Two Sends in a row write 0001-… then 0002-… to disk (end-to-end relay,
  not just the host mutex).
result: [pending]

### 5. D-04 — pre-flight blocks oversize before any round-trip
expected: A near-/over-12 MB screenshot Send shows the "Payload Too Large" toast
  immediately; DevTools Network tab shows NO ~12 MB POST left the extension
  (pre-flight fired before sendMessage).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
