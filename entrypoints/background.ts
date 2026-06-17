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

import { SFX_MSG, SFX_SET_ROUTE, SFX_GET_TAB_ID, SFX_CAPTURE_TAB, SFX_LIST_ANNOTATIONS, SFX_EDIT_ANNOTATION, SFX_DELETE_ANNOTATION, SFX_GET_SCREENSHOT } from '../lib/types.js';
import type {
  SfxMessage,
  SfxResponse,
  HostEntry,
  StorageState,
  AnnotationPayload,
  MsgCaptureTab,
  MsgAddHost,
  MsgRemoveHost,
  MsgListAnnotations,
  MsgEditAnnotation,
  MsgDeleteAnnotation,
  MsgGetScreenshot,
} from '../lib/types.js';
import {
  sfxRegistry,
  sfxTokens,
  sfxOriginMap,
  sfxPrefs,
  loadStorageState,
} from '../lib/storage.js';
import { discoverHosts, probePort } from '../lib/discovery.js';
import { resolveRoute, reconcileRegistry } from '../lib/routing.js';

// ---------------------------------------------------------------------------
// Type aliases for handler return shapes
// ---------------------------------------------------------------------------

type RouteResponse =
  | ({ ok: true; host: HostEntry; mapped?: boolean })
  | ({ ok: false; error: string; reason?: 'unmapped'; origin?: string });

type AnnotationResponse =
  | ({ ok: true; file: string; serial: string })
  // D-04: structured discriminator so the content script can open the folder
  // dialog (PICK_FOLDER) and retry once when an origin has no mapping at all.
  | ({ ok: false; error?: string; reason?: 'needs-folder'; origin?: string });

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
// origin→folder routing helpers (D-04 / 09-05)
// ---------------------------------------------------------------------------

/**
 * Disambiguate an sfxOriginMap value (D-04).
 *
 * sfxOriginMap stores BOTH origin→host-name (Phase 3) and origin→folder (09-04).
 * A FOLDER is an absolute path; a host name is a bare registry key. We detect a
 * folder by absolute-path shape:
 *   - POSIX: starts with '/'
 *   - Windows: drive-letter prefix like `C:\` (also tolerate `C:/`)
 * Host names never look like absolute paths, so this never misclassifies an
 * existing origin→host entry.
 */
function isFolderValue(v: string | undefined | null): v is string {
  if (typeof v !== 'string' || v.length === 0) return false;
  if (v.startsWith('/')) return true;            // POSIX absolute
  if (/^[A-Za-z]:[\\/]/.test(v)) return true;    // Windows drive-letter absolute
  return false;
}

/**
 * Return a paired host (one whose token is set). For v1 there is a single paired
 * host (one native-paired project), so the first token-bearing entry is used.
 * The returned HostEntry carries the authoritative token from sfxTokens.
 */
function getActivePairedHost(
  registry: Record<string, HostEntry>,
  tokens: Record<string, string>
): HostEntry | null {
  for (const name of Object.keys(registry)) {
    const token = tokens[name] ?? registry[name].token ?? null;
    if (token) {
      return { ...registry[name], token };
    }
  }
  return null;
}

/**
 * Shared route resolution for the read/edit/delete/screenshot relays (D-04).
 *
 * Mirrors handleSendAnnotation precedence: origin→folder (paired host +
 * targetDir) ▸ origin→host (no targetDir) ▸ error. Unlike SEND, the CRUD relays
 * always operate on an already-mapped origin (the chip wouldn't have rendered
 * otherwise), so the no-mapping case is a plain error here rather than
 * needs-folder. Returns the resolved host plus the optional targetDir, or an
 * error string to forward to the caller.
 */
function resolveFolderAwareRoute(
  origin: string,
  state: StorageState
):
  | { ok: true; host: HostEntry; targetDir?: string }
  | { ok: false; error: string; reason?: 'unmapped' } {
  const mappedValue = state.originMap[origin];
  if (isFolderValue(mappedValue)) {
    const paired = getActivePairedHost(state.registry, state.tokens);
    if (!paired) return { ok: false, error: 'Pair with the host first' };
    return { ok: true, host: paired, targetDir: mappedValue };
  }
  const routed = resolveRoute(origin, state, { singleHostFallback: false });
  // reason:'unmapped' lets callers (pin-loader) treat a fresh origin as "no pins
  // yet" rather than a hard error — there is simply no folder/host chosen.
  if (!routed) return { ok: false, error: `No host mapped for origin: ${origin}`, reason: 'unmapped' };
  return { ok: true, host: routed };
}

/** Append ?targetDir= to a relay URL when the origin maps to a folder (D-04). */
function withTargetDir(url: string, targetDir?: string): string {
  if (targetDir === undefined) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}targetDir=${encodeURIComponent(targetDir)}`;
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
  const route = origin ? resolveRoute(origin, state, { singleHostFallback: false }) : null;

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

  // D-04: a folder-mapped origin resolves SILENTLY to the paired host (no
  // dropdown, no dialog on subsequent notes). The chip shows the chosen folder
  // as the routed label and Send rides targetDir in SEND_ANNOTATION. This MUST
  // precede resolveRoute so a folder mapping is never misread as "unmapped".
  const mappedValue = state.originMap[origin];
  if (isFolderValue(mappedValue)) {
    const paired = getActivePairedHost(state.registry, state.tokens);
    if (paired) {
      // Surface the folder as the label's notesDir (display only — the host
      // re-validates the real targetDir on every write).
      return { ok: true, host: { ...paired, notesDir: mappedValue } };
    }
    // Folder mapped but no paired host yet — fall through to the dropdown so the
    // user can pair, rather than dead-ending.
  }

  // Step 1 + 2: advertised or persisted (origin→host) mapping.
  // D-04: single-host auto-select OFF so an unmapped origin shows as needs-folder
  // (drives the folder dialog) rather than silently binding to the one host.
  let route = resolveRoute(origin, state, { singleHostFallback: false });
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
 * Relay a fetch to the host with one automatic token-rotation recovery: on HTTP
 * 401, re-pair with the native host (refreshing sfxTokens) and retry the SAME
 * request once with the fresh token. Returns the final Response. Only the
 * X-Stickyfix-Token header value is swapped on retry; caller init is preserved.
 * Bounded to a single retry — a persistent 401 falls through to the caller's
 * existing error mapping (user still sees "unauthorized").
 */
async function relayFetchWithRepair(
  host: HostEntry,
  url: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  const withToken = (t: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), 'X-Stickyfix-Token': t },
  });
  let resp = await fetch(url, withToken(token));
  if (resp.status === 401) {
    const repaired = await handlePairNative();
    if (repaired.ok) {
      const freshTokens = await sfxTokens.getValue();
      const freshToken = freshTokens[host.name];
      if (freshToken) resp = await fetch(url, withToken(freshToken));
    }
  }
  return resp;
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

  // 3. Resolve route with D-04 precedence:
  //    (1) origin→folder (09-04 entries) → paired host + targetDir
  //    (2) origin→host (Phase 3) → host default notesDir, NO targetDir (back-compat)
  //    (3) neither → {ok:false, reason:'needs-folder'} so the CS opens the dialog
  let host: HostEntry;
  let targetDir: string | undefined;

  const mappedValue = state.originMap[origin];
  if (isFolderValue(mappedValue)) {
    // (1) Folder-mapped origin — send to the paired host with the chosen folder.
    const paired = getActivePairedHost(state.registry, state.tokens);
    if (!paired) {
      return { ok: false, error: 'Pair with the host first' };
    }
    host = paired;
    targetDir = mappedValue;
  } else {
    // (2) Existing origin→host routing (UNCHANGED). resolveRoute also handles
    //     advertised-origin + single-host auto-select. No targetDir is attached.
    const routed = resolveRoute(origin, state, { singleHostFallback: false });
    if (!routed) {
      // (3) No mapping at all — signal the content script to pick a folder.
      return { ok: false, reason: 'needs-folder', origin };
    }
    host = routed;
  }

  if (!host.token) {
    return {
      ok: false,
      error: `No token set for host "${host.name}" — enter it in the popup`,
    };
  }

  // 4. Relay fetch — SW has host_permissions, exempt from LNA and CORS (EXT-05)
  //    This is the ONLY fetch to 127.0.0.1 in the extension (T-03-04).
  //    For folder-mapped origins, targetDir rides in the POST body; the host
  //    re-validates it and confines the write to <targetDir>/notes (D-04).
  const sendBody = targetDir !== undefined ? { ...payload, targetDir } : payload;
  const requestBody = JSON.stringify(sendBody);

  // Single shared relay with token-rotation recovery: on 401 (stale cached token
  // after a host restart) it auto re-pairs and retries the SAME body once with
  // the fresh token. A persistent 401 falls through to the mapping below.
  let resp: Response;
  try {
    resp = await relayFetchWithRepair(
      host,
      `http://127.0.0.1:${host.port}/annotation`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody },
      host.token,
    );
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
// Pin CRUD relay handlers — SW relay for SFX_LIST/EDIT/DELETE_ANNOTATION
// Security (T-06-01, T-06-06): URL derived from chrome.tabs.get(tabId) — NEVER
// from the message body. IDOR guard applied on edit/delete in onMessage switch.
// ---------------------------------------------------------------------------

/** Shape returned by GET /annotations for each pin descriptor */
interface PinDescriptor {
  serial: string;
  mode: 'free' | 'element';
  status: string;
  url: string;
  text: string;
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
  note_position?: { x: number; y: number };
  screenshots: string[];
}

async function handleListAnnotations(
  tabId: number,
  scope?: 'all'
): Promise<{ ok: true; pins: PinDescriptor[] } | { ok: false; error: string }> {
  // 1. Re-read storage (MV3 SW may have been recycled — Pitfall 1)
  const state = await loadStorageState();

  // 2. Derive URL from the tab (anti-spoof — T-06-01 / T-03-01)
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { ok: false, error: 'Cannot determine tab URL' };
  }
  const origin = new URL(tab.url).origin;

  // 3. Resolve route (D-04: origin→folder ▸ origin→host)
  const route = resolveFolderAwareRoute(origin, state);
  if (!route.ok) {
    // A fresh, unmapped origin simply has no pins to show yet — return an empty
    // list instead of surfacing a "Could not load pins — No host mapped" toast
    // on every new site (REL-01: no scary error for a benign state). Pins load
    // once the origin is mapped (the chip dropdown / first-note dialog), via the
    // onSent re-fetch. Real errors (e.g. "Pair with the host first") still flow.
    if (route.reason === 'unmapped') return { ok: true, pins: [] };
    return route;
  }
  const { host, targetDir } = route;
  if (!host.token) {
    return { ok: false, error: `No token set for host "${host.name}" — enter it in the popup` };
  }

  // 4. Relay fetch to host (SW has host_permissions — INVARIANT B)
  //    Folder-mapped origins pass ?targetDir= so the host reads from that folder.
  let resp: Response;
  try {
    resp = await relayFetchWithRepair(
      host,
      withTargetDir(
        `http://127.0.0.1:${host.port}/annotations?url=${encodeURIComponent(tab.url)}${scope === 'all' ? '&scope=all' : ''}`,
        targetDir
      ),
      { method: 'GET' },
      host.token,
    );
  } catch (e: unknown) {
    return { ok: false, error: `Host unreachable: ${String(e)}` };
  }

  if (resp.ok) {
    let body: { pins: PinDescriptor[] };
    try {
      body = (await resp.json()) as { pins: PinDescriptor[] };
    } catch {
      return { ok: false, error: 'Host returned non-JSON on 200' };
    }
    return { ok: true, pins: Array.isArray(body.pins) ? body.pins : [] };
  }

  let errBody: { error?: string } = {};
  try {
    errBody = (await resp.json()) as { error?: string };
  } catch { /* not JSON */ }
  return { ok: false, error: errBody.error ?? `HTTP ${resp.status}` };
}

async function handleEditAnnotation(
  tabId: number,
  serial: string,
  comment: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1. Re-read storage (Pitfall 1)
  const state = await loadStorageState();

  // 2. Derive URL from tab (anti-spoof — T-06-01)
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { ok: false, error: 'Cannot determine tab URL' };
  }
  const origin = new URL(tab.url).origin;

  // 3. Resolve route (D-04: origin→folder ▸ origin→host)
  const route = resolveFolderAwareRoute(origin, state);
  if (!route.ok) return route;
  const { host, targetDir } = route;
  if (!host.token) {
    return { ok: false, error: `No token set for host "${host.name}" — enter it in the popup` };
  }

  // 4. Relay PUT to host (folder-mapped origins pass ?targetDir=)
  let resp: Response;
  try {
    resp = await relayFetchWithRepair(
      host,
      withTargetDir(
        `http://127.0.0.1:${host.port}/annotation/${encodeURIComponent(serial)}`,
        targetDir
      ),
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ comment }),
      },
      host.token,
    );
  } catch (e: unknown) {
    return { ok: false, error: `Host unreachable: ${String(e)}` };
  }

  if (resp.ok) {
    return { ok: true };
  }

  let errBody: { error?: string } = {};
  try {
    errBody = (await resp.json()) as { error?: string };
  } catch { /* not JSON */ }
  return { ok: false, error: errBody.error ?? `HTTP ${resp.status}` };
}

async function handleDeleteAnnotation(
  tabId: number,
  serial: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 1. Re-read storage (Pitfall 1)
  const state = await loadStorageState();

  // 2. Derive URL from tab (anti-spoof — T-06-01)
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { ok: false, error: 'Cannot determine tab URL' };
  }
  const origin = new URL(tab.url).origin;

  // 3. Resolve route (D-04: origin→folder ▸ origin→host)
  const route = resolveFolderAwareRoute(origin, state);
  if (!route.ok) return route;
  const { host, targetDir } = route;
  if (!host.token) {
    return { ok: false, error: `No token set for host "${host.name}" — enter it in the popup` };
  }

  // 4. Relay DELETE to host (folder-mapped origins pass ?targetDir=)
  let resp: Response;
  try {
    resp = await relayFetchWithRepair(
      host,
      withTargetDir(
        `http://127.0.0.1:${host.port}/annotation/${encodeURIComponent(serial)}`,
        targetDir
      ),
      {
        method: 'DELETE',
      },
      host.token,
    );
  } catch (e: unknown) {
    return { ok: false, error: `Host unreachable: ${String(e)}` };
  }

  if (resp.ok) {
    return { ok: true };
  }

  let errBody: { error?: string } = {};
  try {
    errBody = (await resp.json()) as { error?: string };
  } catch { /* not JSON */ }
  return { ok: false, error: errBody.error ?? `HTTP ${resp.status}` };
}

/**
 * GET /screenshot relay — fetch a PNG from the host and return it as a base64 data-URL.
 *
 * Security (T-06-02 / INVARIANT B):
 *  - tabId bound to sender.tab.id (IDOR guard in onMessage switch, same as list/edit/delete).
 *  - Host URL derived from chrome.tabs.get(tabId) — never from message body (anti-spoof).
 *  - base64 conversion uses ArrayBuffer → Uint8Array → btoa (Web standard, no native deps).
 *  - Content script NEVER fetches localhost directly — this SW is the sole HTTP client.
 */
async function handleGetScreenshot(
  tabId: number,
  serial: string,
  file: string
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  // 1. Re-read storage (Pitfall 1)
  const state = await loadStorageState();

  // 2. Derive URL from tab (anti-spoof — T-06-01)
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { ok: false, error: 'Cannot determine tab URL' };
  }
  const origin = new URL(tab.url).origin;

  // 3. Resolve route (D-04: origin→folder ▸ origin→host)
  const route = resolveFolderAwareRoute(origin, state);
  if (!route.ok) return route;
  const { host, targetDir } = route;
  if (!host.token) {
    return { ok: false, error: `No token set for host "${host.name}" — enter it in the popup` };
  }

  // 4. Relay GET to host /screenshot — SW has host_permissions (INVARIANT B)
  //    Folder-mapped origins pass ?targetDir= so the host serves from that folder.
  let resp: Response;
  try {
    resp = await relayFetchWithRepair(
      host,
      withTargetDir(
        `http://127.0.0.1:${host.port}/screenshot?serial=${encodeURIComponent(serial)}&file=${encodeURIComponent(file)}`,
        targetDir
      ),
      { method: 'GET' },
      host.token,
    );
  } catch (e: unknown) {
    return { ok: false, error: `Host unreachable: ${String(e)}` };
  }

  if (!resp.ok) {
    let errBody: { error?: string } = {};
    try {
      errBody = (await resp.json()) as { error?: string };
    } catch { /* not JSON */ }
    return { ok: false, error: errBody.error ?? `HTTP ${resp.status}` };
  }

  // 5. Convert ArrayBuffer → base64 data-URL (Web standard — no native deps, MIT)
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const dataUrl = 'data:image/png;base64,' + btoa(binary);
  return { ok: true, dataUrl };
}

// ---------------------------------------------------------------------------
// handlePairNative — obtain token from native host and persist like handleAddHost
// ---------------------------------------------------------------------------

/**
 * ONB-02: Call chrome.runtime.sendNativeMessage to obtain the token from the
 * native host over the OS-level native-messaging channel, then persist it into
 * sfxTokens + sfxRegistry exactly as handleAddHost does.
 *
 * Security (T-09-06): sendNativeMessage is only available to extension service
 * workers and extension pages — web origins and content scripts cannot call it.
 * The pairing channel is structurally inaccessible to arbitrary web origins.
 *
 * Returns { ok: true, name } on success or { ok: false, error } on failure.
 */

const NATIVE_HOST_NAME = 'com.stickyfix.host';

async function handlePairNative(): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      { type: 'GET_TOKEN' },
      async (response: unknown) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message ?? 'native messaging error' });
          return;
        }

        const r = response as { type?: string; token?: string; port?: number; name?: string; notesDir?: string } | null;

        if (!r || r.type !== 'TOKEN' || typeof r.token !== 'string' || typeof r.name !== 'string') {
          resolve({ ok: false, error: 'Unexpected native host response' });
          return;
        }

        const { token, port, name, notesDir } = r;

        // Re-read storage at handler top (Pitfall 1 — MV3 SW globals zeroed after idle)
        const [registry, tokens] = await Promise.all([
          sfxRegistry.getValue(),
          sfxTokens.getValue(),
        ]);

        // Persist — same shape as handleAddHost (ONB-02 / PATTERNS sfxTokens pattern)
        tokens[name] = token;
        registry[name] = {
          name,
          port: typeof port === 'number' ? port : 0,
          notesDir: typeof notesDir === 'string' ? notesDir : '',
          origins: [],
          token,
        };

        await Promise.all([
          sfxTokens.setValue(tokens),
          sfxRegistry.setValue(registry),
        ]);

        resolve({ ok: true, name });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// handlePickFolder — open the OS folder dialog via native host, persist mapping
// ---------------------------------------------------------------------------

/**
 * ONB-04 / D-04: On the first note from an unmapped origin, ask the native host
 * to open an OS folder dialog over the native-messaging channel, then persist
 * the chosen folder as the origin→folder mapping in sfxOriginMap for silent
 * reuse — mirroring the Phase 3 origin→host one-time prompt.
 *
 * Security:
 *  - Origin is derived from chrome.tabs.get(tabId).url (origin-from-tab) — NEVER
 *    from the message body (Phase 3/8 anti-spoof invariant, T-09-15).
 *  - sendNativeMessage is SW-only (T-09-06) — web origins/content scripts cannot
 *    reach the native channel.
 *
 * Returns { ok:true, folder } on success or { ok:false, error } otherwise.
 */
async function handlePickFolder(
  tabId: number
): Promise<{ ok: true; folder: string } | { ok: false; error: string; cancelled?: boolean }> {
  // Derive origin from the tab URL — page cannot spoof this (T-09-15 / T-03-01)
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return { ok: false, error: 'Cannot determine tab origin (tab has no URL)' };
  }
  const origin = new URL(tab.url).origin;

  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      // WIRE PROTOCOL type — must be the literal the native host dispatches on
      // ('PICK_FOLDER'), NOT the extension-internal SFX_MSG.PICK_FOLDER
      // ('SFX_PICK_FOLDER'). The native host (native-host.ts) checks
      // `m.type === 'PICK_FOLDER'`; sending the SFX_ constant made it fall through
      // to "unknown message → exit 0" so the dialog never opened. Mirrors
      // handlePairNative which correctly sends the literal 'GET_TOKEN'.
      { type: 'PICK_FOLDER', origin },
      async (response: unknown) => {
        // CASE 1: native messaging itself failed → the native host is not
        // installed/reachable. This is NOT a user cancel — tell them to install
        // the host, not to retry the (never-opened) dialog. No `cancelled` flag.
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: 'stickyfix host not found — run: npx stickyfix init' });
          return;
        }

        const r = response as {
          type?: string;
          origin?: string;
          folder?: string | null;
          error?: string;
        } | null;

        // CASE 2: host returned a structured ERROR frame → host not running /
        // token or config missing. Surface the real host error, not a cancel
        // message. No `cancelled` flag — retrying the dialog won't fix it.
        if (r && r.type === 'ERROR') {
          resolve({ ok: false, error: r.error ?? 'stickyfix host error' });
          return;
        }

        // CASE 3: not a valid FOLDER_PICKED frame, or empty/null folder → the
        // user dismissed the dialog (or the pick was invalid). This IS a cancel,
        // so flag it (`cancelled: true`) — UI shows "drop again to pick one".
        if (!r || r.type !== 'FOLDER_PICKED' || typeof r.folder !== 'string' || r.folder.length === 0) {
          resolve({ ok: false, error: 'No folder selected', cancelled: true });
          return;
        }

        const folder = r.folder;

        // Re-read sfxOriginMap at handler top (Pitfall 1 — MV3 SW globals zeroed)
        // and persist origin→folder, mirroring the existing origin→host persist
        // (handleSetRoute lines above). Silent reuse thereafter (D-04).
        const originMap = await sfxOriginMap.getValue();
        originMap[origin] = folder;
        await sfxOriginMap.setValue(originMap);

        resolve({ ok: true, folder });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// handleAddHost — probe a specific port and add it to the registry
// ---------------------------------------------------------------------------

async function handleAddHost(
  port: number
): Promise<{ ok: true; host: HostEntry } | { ok: false; error: string }> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Invalid port' };
  }

  let host: HostEntry;
  try {
    host = await probePort(port);
  } catch {
    return { ok: false, error: 'No stickyfix host responding on port ' + port };
  }

  // Re-read registry + tokens at handler top (Pitfall 1 — no module-level cache)
  const [registry, tokens] = await Promise.all([
    sfxRegistry.getValue(),
    sfxTokens.getValue(),
  ]);

  registry[host.name] = { ...host, token: tokens[host.name] ?? null };
  await sfxRegistry.setValue(registry);

  return { ok: true, host };
}

// ---------------------------------------------------------------------------
// handleRemoveHost — remove a host and all its origin mappings from the registry
// ---------------------------------------------------------------------------

async function handleRemoveHost(
  name: string
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  // Re-read all three stores at handler top (Pitfall 1)
  const [registry, tokens, originMap] = await Promise.all([
    sfxRegistry.getValue(),
    sfxTokens.getValue(),
    sfxOriginMap.getValue(),
  ]);

  delete registry[name];
  delete tokens[name];

  for (const origin of Object.keys(originMap)) {
    if (originMap[origin] === name) {
      delete originMap[origin];
    }
  }

  await Promise.all([
    sfxRegistry.setValue(registry),
    sfxTokens.setValue(tokens),
    sfxOriginMap.setValue(originMap),
  ]);

  return { ok: true, name };
}

// ---------------------------------------------------------------------------
// handleCaptureTab — SW-side handler for SFX_CAPTURE_TAB (Plan 04-03)
// ---------------------------------------------------------------------------

/**
 * Captures the visible viewport of the tab identified by `tabId`.
 *
 * SECURITY (T-04-07 / T-04-09 / INVARIANT B):
 *  - This is the ONLY caller of chrome.tabs.captureVisibleTab in the codebase.
 *  - windowId is derived from chrome.tabs.get(tabId) — NEVER trusted from the
 *    message body (anti-spoof, Pitfall 8).
 */
async function handleCaptureTab(
  tabId: number
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.windowId) return { ok: false, error: 'No windowId for tab' };
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } catch (e: unknown) {
    return { ok: false, error: String(e) };
  }
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
    msg: SfxMessage | MsgSetRoute | MsgGetTabId | MsgCaptureTab | MsgAddHost | MsgRemoveHost | MsgGetScreenshot,
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

      case SFX_CAPTURE_TAB: {
        // T-04 IDOR / T-03-01 anti-spoof: a content script may only capture
        // ITS OWN tab. Bind the requested tabId to sender.tab.id (the same
        // trust model SFX_GET_TAB_ID uses) — never trust tabId from the body.
        const reqTabId = (msg as MsgCaptureTab).tabId;
        if (sender.tab?.id == null || sender.tab.id !== reqTabId) {
          sendResponse({ ok: false, error: 'forbidden' });
          return true;
        }
        handleCaptureTab(reqTabId)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true; // MANDATORY — captureVisibleTab is async (Pitfall 1)
      }

      case SFX_MSG.ADD_HOST:
        handleAddHost((msg as MsgAddHost).port)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;

      case SFX_MSG.REMOVE_HOST:
        handleRemoveHost((msg as MsgRemoveHost).name)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;

      case SFX_MSG.PAIR_NATIVE:
        // ONB-02: SW pairs with native host and persists token+registry.
        // Security (T-09-06): sendNativeMessage is SW-only — web origins cannot trigger this.
        handlePairNative()
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true; // MANDATORY — keep channel open for async response (Pitfall 2)

      case SFX_MSG.PICK_FOLDER:
        // ONB-04 / D-04: open the OS folder dialog via the native host and
        // persist origin→folder. Origin is derived from chrome.tabs.get(tabId)
        // INSIDE handlePickFolder — never from the message body (T-09-15 anti-spoof).
        // Security (T-09-06): sendNativeMessage is SW-only — web origins cannot trigger this.
        handlePickFolder((msg as import('../lib/types.js').MsgPickFolder).tabId)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true; // MANDATORY — keep channel open for async response (Pitfall 2)

      case SFX_LIST_ANNOTATIONS: {
        // T-06-06 IDOR guard: bind requested tabId to sender.tab.id — a page in
        // another tab must not enumerate notes for a URL it does not control
        // (cross-tab info disclosure). Same trust model as capture/edit/delete:
        // never trust tabId from the message body.
        const listMsg = msg as MsgListAnnotations;
        if (sender.tab?.id == null || sender.tab.id !== listMsg.tabId) {
          sendResponse({ ok: false, error: 'forbidden' });
          return true;
        }
        handleListAnnotations(listMsg.tabId, listMsg.scope)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;
      }

      case SFX_EDIT_ANNOTATION: {
        // T-06-06 IDOR guard: only the tab that owns the note may edit it
        const editMsg = msg as MsgEditAnnotation;
        if (sender.tab?.id == null || sender.tab.id !== editMsg.tabId) {
          sendResponse({ ok: false, error: 'forbidden' });
          return true;
        }
        handleEditAnnotation(editMsg.tabId, editMsg.serial, editMsg.comment)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;
      }

      case SFX_DELETE_ANNOTATION: {
        // T-06-06 IDOR guard: only the tab that owns the note may delete it
        const delMsg = msg as MsgDeleteAnnotation;
        if (sender.tab?.id == null || sender.tab.id !== delMsg.tabId) {
          sendResponse({ ok: false, error: 'forbidden' });
          return true;
        }
        handleDeleteAnnotation(delMsg.tabId, delMsg.serial)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;
      }

      case SFX_GET_SCREENSHOT: {
        // T-06-06 IDOR guard: only the tab that owns the note may fetch its screenshots
        // tabId bound to sender.tab.id — never trusted from the message body (anti-spoof)
        const shotMsg = msg as MsgGetScreenshot;
        if (sender.tab?.id == null || sender.tab.id !== shotMsg.tabId) {
          sendResponse({ ok: false, error: 'forbidden' });
          return true;
        }
        handleGetScreenshot(shotMsg.tabId, shotMsg.serial, shotMsg.file)
          .then(sendResponse)
          .catch((err: unknown) =>
            sendResponse({ ok: false, error: String(err) })
          );
        return true;
      }

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

// ---------------------------------------------------------------------------
// Re-inject review UI after a page reload/navigation (pin persistence)
// ---------------------------------------------------------------------------
// When a tab that is in review mode reloads, Chrome destroys the injected
// content script. Re-inject review.js + CSS once the document finishes loading
// so the FAB, chip, and persistent pins reappear WITHOUT the user having to
// exit and re-enter review mode. Best-effort, same posture as handleEnterReview:
// restricted URLs (chrome://, web store) or a tab closed mid-load just no-op.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Only two signals matter: an in-page URL change (SPA nav) or a finished load.
  // Skip the noisy favicon/title updates so we don't read storage on every event.
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  void (async () => {
    const prefs = await sfxPrefs.getValue();
    if (!prefs.reviewMode[String(tabId)]) return;

    // SPA in-page navigation: the URL changed without a document reload, so the
    // content script (and its pins, scoped to the prior URL) is still alive on
    // the old page's notes. Tell it to re-scope to the new URL. Best-effort:
    // during a hard navigation the old CS may already be gone (sendMessage
    // rejects) and the 'complete' branch below re-injects a fresh one.
    if (changeInfo.url) {
      chrome.tabs
        .sendMessage(tabId, { type: SFX_MSG.URL_CHANGED, tabId })
        .catch(() => {
          // No live receiver (CS not injected yet / mid-navigation) — ignore.
        });
    }

    if (changeInfo.status === 'complete') {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/review.js'],
        });
        await chrome.scripting.insertCSS({
          target: { tabId },
          files: ['content-scripts/review.css'],
        });
      } catch {
        // Restricted URL or tab gone — ignore (not a regression; best-effort).
      }
    }
  })();
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
