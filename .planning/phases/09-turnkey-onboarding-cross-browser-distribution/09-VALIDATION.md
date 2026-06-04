---
phase: 9
slug: turnkey-onboarding-cross-browser-distribution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-05
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | host: node:test (built-in) + tsx; extension: vitest |
| **Config file** | host: none (node --test glob); extension: vitest.config.ts (existing) |
| **Quick run command** | `npm run check` (typecheck + lib + host tests) |
| **Full suite command** | `npm run check && npm run build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run check`
- **After every plan wave:** Run `npm run check && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

> Plans are not yet authored — the planner fills concrete task IDs. Below are the
> requirement→validation bindings the planner MUST honor (ONB-01..06).

| Requirement | Validatable Behavior | Test Type | Automated Command | Manual? |
|-------------|----------------------|-----------|-------------------|---------|
| ONB-01 | `npx stickyfix init` runs cross-platform; registers native-messaging manifest at the correct per-OS path; writes/links the host | unit (manifest writer, path resolver) + manual (real npx run) | `npm run check` (path/manifest unit tests) | partial |
| ONB-02 | SW obtains token over `chrome.runtime.connectNative` (native messaging) — no token field in happy path | unit (native-msg handler pure logic) + manual (live pairing) | `npm run check` | partial |
| ONB-03 | Pairing channel is not web-reachable: a scripted arbitrary web origin cannot obtain the token or write a note (SC-3 security proof) | unit (security: native-msg `allowed_origins` gate) + manual (hostile-origin probe) | `npm run check` (host security tests) | partial |
| ONB-04 | First note on unmapped origin → OS folder dialog (`execFile`, arg-array, no shell); origin→folder persisted + reused | unit (dialog arg builder, no-shell-interpolation assertion; origin→folder map reconcile) | `npm run check` | partial |
| ONB-05 | `npx stickyfix uninstall` removes native-messaging manifest + registry keys + host files; no orphan process/config | unit (uninstall path enumerator) + manual (real uninstall) | `npm run check` | partial |
| ONB-06 | Documented Edge (now) + Firefox/Safari packaging path exists (docs only, no build) | doc assertion (file exists, sections present) | `test -f docs/*` grep | doc |

---

## Wave 0 Requirements

- [ ] Native-messaging manifest writer + per-OS path resolver — pure-function unit tests (no real registry writes; inject path roots)
- [ ] Folder-dialog argument builder — assert `execFile` arg arrays contain no shell metacharacters / no interpolated origin strings
- [ ] Hostile-origin security test — assert native-messaging `allowed_origins` rejects any origin other than the pinned extension ID; assert HTTP token gate still rejects wrong/absent token (regression guard on Phase 8 invariants)
- [ ] origin→folder map reconcile — mirror existing `lib/routing.ts` reconcileRegistry test shape

*Existing infrastructure (node:test + vitest) covers the framework; Wave 0 adds the above stubs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real `npx stickyfix init` on a clean machine reaches "note on disk" in one step | ONB-01 | Requires a real browser + OS native-messaging registration | Run `npx stickyfix init`, load the extension, drop a note, confirm `.md` on disk |
| Click-to-pair with no token copy-paste | ONB-02 | Requires live SW ↔ native host stdio channel | Click extension icon on a fresh profile; confirm token auto-populates, a Send succeeds |
| Hostile web origin cannot pair or write | ONB-03 | Requires a scripted page attempting `connectNative`/HTTP from a non-extension origin | From a normal web page console, attempt to reach the native host / POST a note; confirm both fail |
| Clean uninstall leaves nothing behind | ONB-05 | Requires inspecting real OS registry/dirs + process list | Run uninstall; confirm manifest/keys/host gone, no orphan node process |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
