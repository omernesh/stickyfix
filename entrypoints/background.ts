/**
 * stickyfix service worker — the SOLE HTTP client for localhost.
 *
 * Architecture invariants (enforced by design):
 *  - ONLY this file fetches http://127.0.0.1/* — content scripts and the
 *    popup MUST NEVER reach localhost directly (Chrome LNA + CORS block).
 *  - Storage is re-read at the top of EVERY handler (MV3 SW is ephemeral;
 *    globals are zeroed after ~30s idle — Pitfall 1).
 *  - Every async handler MUST return literal `true` synchronously so Chrome
 *    keeps the message channel open for sendResponse (Pitfall 2).
 *
 * Security (STRIDE T-03-01, T-03-02, T-03-04):
 *  - Origin is always derived from chrome.tabs.get(tabId).url — never trusted
 *    from the message body (T-03-01 anti-spoof).
 *  - Tokens live only in chrome.storage.local; never exposed to page/CS.
 *  - The relay is the only localhost path; content-script fetch is forbidden.
 */

import { SFX_MSG, SFX_SET_ROUTE, SFX_GET_TAB_ID } from '../lib/types.js';
import type {
  SfxMessage,
  SfxResponse,
  HostEntry,
  AnnotationPayload,
} from '../lib/types.js';
import {
  sfxRegistry,
  sfxTokens,
  sfxOriginMap,
  sfxPrefs,
  loadStorageState,
} from '../lib/storage.js';
import { discoverHosts } from '../lib/discovery.js';
import { resolveRoute, reconcileRegistry } from '../lib/routing.js';

// ---------------------------------------------------------------------------
// Type aliases for handler return shapes
// ---------------------------------------------------------------------------

type RouteResponse =
  | ({ ok: true; host: HostEntry; mapped?: boolean })
  | ({ ok: false; error: string; reason?: 'unmapped'; origin?: string });

type AnnotationResponse = SfxResponse<{
  file: string;
  // The host returns the zero-padded serial as a STRING (e.g. "0001") — this is
  // its documented contract (server.test.ts asserts typeof serial === 'string').
  serial: string;
}>;

type EnterReviewResponse = SfxResponse<{ route: HostEntry | null }>;
type ExitReviewResponse = { ok: true } | { ok: false; error: string };
type RefreshResponse = SfxResponse<{ count: number; hosts: string[] }>;

// ---------------------------------------------------------------------------
// refreshHosts — EXT-04/EXT-10: discover + reconcile + persist
// ---------------------------------------------------------------------------

/**
 * Run a full discovery cycle and reconcile the persisted registry by
 * name+origin (not port). This means a host that restarted on a new port
 * will re-bind correctly without losing its user-entered token.
 *
 * Called on:
 *  - REFRESH_HOSTS message
 *  - ENTER_REVIEW message (fresh discovery before injection)
 *  - SW wake events (onStartup, onInstalled)
 */
async function refreshHosts(): Promise<HostEntry[]> {
  // Re-read storage at handler top (Pitfall 1 — no module-level cache)
  const [persisted, tokens] = await Promise.all([
    sfxRegistry.getValue(),
    sfxTokens.getValue(),
  ]);

  const discovered = await discoverHosts();
  const merged = reconcileRegistry(persisted, discovered, tokens);

  await sfxRegistry.setValue(merged);
  return discovered;
}

// ---------------------------------------------------------------------------
// readPageSelfId — injected via executeScript({func}) into the page context
// Returns meta[name="stickyfix-project"] content or window.__stickyfix_project
// ---------------------------------------------------------------------------

function readPageSelfId(): string | null {
  const meta = document.querySelector('meta[name="stickyfix-project"]');
  if (meta) return meta.getAttribute('content');
  return (window as unknown as Record<string, unknown>).__stickyfix_project as string ?? null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleRefreshHosts(): Promise<RefreshResponse> {
  // Discover + reconcile + persist, then return the full set of KNOWN host
  // names from the reconciled registry (not just freshly-discovered ones —
  // a persisted host that is briefly offline must still be pickable in the
  // content-script dropdown). EXT-04/EXT-07.
  await refreshHosts();
  const registry = await sfxRegistry.getValue();
  const hosts = Object.keys(registry);
  return { ok: true, count: hosts.length, hosts };
}

async function handleEnterReview(
  tabId: number
): Promise<EnterReviewResponse> {
  // Discover + reconcile first (EXT-04/EXT-10)
  await refreshHosts();

  // Re-read state after reconcile
  const state = await loadStorageState();

  // Get origin from chrome API — page cannot spoof this (T-03-01)
  const tab = await chrome.tabs.get(tabId);
  const origin = tab.url ? new URL(tab.url).origin : null;
  const route = origin ? resolveRoute(origin, state) : null;

  // Inject the on-demand content script (EXT-02 / D-04 / Pitfall 4)
  // WXT output path: entrypoints/review.content/index.ts → content-scripts/review.js
  // Use chrome.scripting (not browser.scripting) because WXT restricts browser.scripting
  // files[] to ScriptPublicPath[] — a generated type that only includes currently-known
  // build outputs. content-scripts/review.js will appear after Plan 03-04 adds the
  // review.content entrypoint. chrome.scripting takes files: string[] without restriction.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-scripts/review.js'],
  });

  // A4 CSS fallback: insert CSS separately in case WXT does not auto-inject
  // it alongside the runtime-registered script. Plan 03-04 will confirm/remove.
  // Pre-authorized per 03-01-SUMMARY.md.
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content-scripts/review.css'],
    });
  } catch {
    // If the CSS file doesn't exist yet (pre-04), ignore — not blocking
  }

  // Mark tab as in review mode
  const prefs = await sfxPrefs.getValue();
  prefs.reviewMode[String(tabId)] = true;
  await sfxPrefs.setValue(prefs);

  return { ok: true, route };
}

async function handleExitReview(tabId: number): Promise<ExitReviewResponse> {
  // Re-read storage at handler top (Pitfall 1)
  const prefs = await sfxPrefs.getValue();

  // Clear review mode pref for this tab
  delete prefs.reviewMode[String(tabId)];
  await sfxPrefs.setValue(prefs);

  // Ask the content script to unmount via a direct runtime message (best-effort).
  // WR-07: using chrome.tabs.sendMessage (same-world, extension-only channel)
  // instead of injecting a page CustomEvent which any page script can forge/suppress.
  // ctx.onInvalidated in the CS is the safety net if the CS is already gone.
  try {
    await chrome.tabs.sendMessage(tabId, { type: SFX_MSG.EXIT_REVIEW, tabId });
  } catch {
    // Tab may have been closed or CS not injected — not an error
  }

  return { ok: true };
}

async function handleGetRoute(
  tabId: number,
  _originFromMsg: string  // IN-02: kept for API compat; tab.url is always used
): Promise<RouteResponse> {
  // Re-read storage at handler top (Pitfall 1)
  const state = await loadStorageState();

  // Derive origin from the tab URL — not the message (T-03-01).
  // IN-02: if tab.url is missing (discarded/loading tab), return an error
  // rather than falling back to the page-supplied originFromMsg.
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { ok: false, error: 'Cannot determine tab origin (tab has no URL)' };
  }
  const origin = new URL(tab.url).origin;

  // Step 1 + 2: advertised or persisted mapping
  let route = resolveRoute(origin, state);
  if (route) {
    return { ok: true, host: route };
  }

  // Step 3: page self-id probe (EXT-08)
  let projectName: string | null = null;
  try {
    // IN-05: use chrome.scripting consistently (browser.scripting is also valid
    // for func: injections but chrome.scripting is used throughout this file).
    const probeResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: readPageSelfId,
    });
    // WR-06: validate result before using as a storage key — the page controls
    // window.__stickyfix_project and could supply a non-string or large value.
    const raw = probeResult[0]?.result;
    projectName = (typeof raw === 'string' && raw.length > 0 && raw.length < 128)
      ? raw
      : null;
  } catch {
    // Page may not allow scripting — not an error
  }

  if (projectName && state.registry[projectName]) {
    // Persist origin → name so this lookup never has to probe again (EXT-08)
    const originMap = await sfxOriginMap.getValue();
    originMap[origin] = projectName;
    await sfxOriginMap.setValue(originMap);

    // Re-read state with the new mapping to resolve cleanly
    const updatedState = await loadStorageState();
    route = resolveRoute(origin, updatedState);
    if (route) {
      return { ok: true, host: route, mapped: true };
    }
  }

  // Step 4: no route found — caller shows one-time dropdown.
  // WR-03: use a structured 'reason' discriminator instead of an in-band
  // error string prefix so callers can branch on type, not string-match.
  return { ok: false, error: `No route for ${origin}`, reason: 'unmapped', origin } as const;
}

/**
 * SET_ROUTE — persists a user's one-time dropdown selection.
 * Called from popup or content script when user picks a host from the dropdown.
 * After this call, GET_ROUTE will resolve via step 2 (originMap) without a probe.
 */
async function handleSetRoute(
  tabId: number,
  hostName: string
): Promise<SfxResponse<{ host: HostEntry }>> {
  // Re-read storage at handler top (Pitfall 1)
  const state = await loadStorageState();

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { ok: false, error: 'No URL for tab' };
  }
  const origin = new URL(tab.url).origin;

  if (!state.registry[hostName]) {
    return { ok: false, error: `Unknown host: ${hostName}` };
  }

  // Persist origin → name (EXT-07/EXT-08 — never re-ask after this)
  const originMap = await sfxOriginMap.getValue();
  originMap[origin] = hostName;
  await sfxOriginMap.setValue(originMap);

  const updatedState = await loadStorageState();
  const route = resolveRoute(origin, updatedState);
  if (route) {
    return { ok: true, host: route };
  }
  return { ok: false, error: 'Route resolve failed after SET_ROUTE persist' };
}

/**
 * SEND_ANNOTATION — the single localhost relay fetch (EXT-05, T-03-01, T-03-04).
 *
 * Security:
 *  - Origin derived from chrome.tabs.get(tabId).url — NOT from the message body
 *    (T-03-01: page cannot spoof which host its notes go to).
 *  - Token attached inside this SW only — never seen by content script (T-03-02).
 *  - Relay never throws to the content script — all errors become {ok:false,error}.
 */
async function handleSendAnnotation(
  tabId: number,
  payload: AnnotationPayload
): Promise<AnnotationResponse> {
  // 1. Re-read storage (MV3 SW may have been recycled — Pitfall 1)
  const state = await loadStorageState();

  // 2. Derive origin from the tab URL (anti-spoof — T-03-01)
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { ok: false, error: 'Cannot determine tab origin' };
  }
  const origin = new URL(tab.url).origin;

  // 3. Resolve host (pure fn — lib/routing.ts)
  const host = resolveRoute(origin, state);
  if (!host) {
    return { ok: false, error: `No host mapped for origin: ${origin}` };
  }

  if (!host.token) {
    return {
      ok: false,
      error: `No token set for host "${host.name}" — enter it in the popup`,
    };
  }

  // 4. Relay fetch — SW has host_permissions, exempt from LNA and CORS (EXT-05)
  //    This is the ONLY fetch to 127.0.0.1 in the extension (T-03-04).
  let resp: Response;
  try {
    resp = await fetch(`http://127.0.0.1:${host.port}/annotation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stickyfix-Token': host.token,
      },
      body: JSON.stringify(payload),
    });
  } catch (e: unknown) {
    // Host down or network error — never throw to content script (REL-01)
    return { ok: false, error: `Host unreachable: ${String(e)}` };
  }

  // 5. Map host response → SfxResponse (200 / 401 / 400 / 413)
  if (resp.ok) {
    // WR-01: validate the host response shape before forwarding to the CS.
    // A host returning 200 with a malformed body (missing file/serial) would
    // produce "sent ✓ undefined" in the chip. Normalize to {ok:false,error}
    // if the shape is wrong so the chip shows a real error instead.
    let body: Partial<AnnotationResponse & { ok: true; file: string; serial: string }>;
    try {
      body = (await resp.json()) as typeof body;
    } catch {
      return { ok: false, error: 'Host returned non-JSON on 200' };
    }
    if (typeof (body as { file?: unknown }).file === 'string' &&
        typeof (body as { serial?: unknown }).serial === 'string') {
      return { ok: true, file: (body as { file: string }).file, serial: (body as { serial: string }).serial };
    }
    return { ok: false, error: 'Malformed host response (missing file/serial)' };
  }

  // Non-2xx: parse error body if possible
  let errBody: { error?: string } = {};
  try {
    errBody = (await resp.json()) as { error?: string };
  } catch {
    // Body not JSON
  }
  return {
    ok: false,
    error: errBody.error ?? `HTTP ${resp.status}`,
  };
}

// ---------------------------------------------------------------------------
// Message protocol — SFX_SET_ROUTE (added in Plan 03-02) and SFX_GET_TAB_ID
// ---------------------------------------------------------------------------

// SFX_SET_ROUTE / SFX_GET_TAB_ID are imported from ../lib/types.js (a
// side-effect-free module) so the content script can share these strings
// WITHOUT importing this background module (which would drag SW-only
// onStartup/onInstalled.addListener registrations into the content script
// and crash it on startup).

interface MsgSetRoute {
  type: typeof SFX_SET_ROUTE;
  tabId: number;
  hostName: string;
}

/**
 * SFX_GET_TAB_ID — used by content scripts to discover their own tabId.
 * Content scripts cannot call chrome.tabs.getCurrent(); this message is the
 * standard workaround: the SW reads sender.tab.id and echoes it back.
 * Synchronous response (no `return true` needed — no async work).
 */
interface MsgGetTabId {
  type: typeof SFX_GET_TAB_ID;
}

// ---------------------------------------------------------------------------
// onMessage router
// ---------------------------------------------------------------------------

/**
 * Single onMessage listener for all SW-bound messages.
 *
 * Pattern 4 / Pitfall 2: every async branch MUST `return true` synchronously
 * so Chrome keeps the channel open for the async sendResponse call.
 */
chrome.runtime.onMessage.addListener(
  (
    msg: SfxMessage | MsgSetRoute | MsgGetTabId,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ): true | void => {
    switch (msg.type) {
      case SFX_GET_TAB_ID:
        // Synchronous — sender.tab.id is immediately available
        sendResponse({ tabId: sender.tab?.id ?? null });
        return; // no async, no `return true`
      case SFX_MSG.REFRESH_HOSTS:
        handleRefreshHosts()
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true; // keep channel open

      case SFX_MSG.ENTER_REVIEW:
        handleEnterReview(msg.tabId)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;

      case SFX_MSG.EXIT_REVIEW:
        handleExitReview(msg.tabId)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;

      case SFX_MSG.GET_ROUTE:
        handleGetRoute(msg.tabId, msg.origin)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;

      case SFX_MSG.SEND_ANNOTATION:
        handleSendAnnotation(msg.tabId, msg.payload)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;

      case SFX_SET_ROUTE:
        handleSetRoute(msg.tabId, msg.hostName)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;

      default:
        // Unknown message type — do not return true (no async response)
        return;
    }
  }
);

// ---------------------------------------------------------------------------
// SW wake events — re-discover on every wake (EXT-10)
// ---------------------------------------------------------------------------

/**
 * On SW startup (Chrome start, extension reload) and install, run discovery
 * so the registry is fresh. This handles the EXT-10 "re-bind by name+origin
 * after port change" requirement without waiting for a user message.
 */
chrome.runtime.onStartup.addListener(() => {
  refreshHosts().catch(console.error);
});

chrome.runtime.onInstalled.addListener(() => {
  refreshHosts().catch(console.error);
});

export default defineBackground({
  type: 'module',
  main() {
    // All logic is registered above via chrome.runtime.onMessage.addListener
    // and chrome.runtime.onStartup/onInstalled.
    // This main() body is intentionally minimal — WXT requires it for entrypoint
    // detection but execution happens in the top-level registrations above.
    // IN-01: gate debug log behind DEV flag to avoid noise in production
    if (import.meta.env.DEV) {
      console.log('stickyfix SW loaded');
    }
  },
});
