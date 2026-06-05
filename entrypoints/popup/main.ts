/**
 * stickyfix popup — vanilla DOM, no framework (D-07)
 *
 * Responsibilities:
 *   - Read sfxRegistry + sfxTokens from chrome.storage.local → render host rows
 *   - Persist per-host tokens to sfxTokens on blur/change (EXT-09)
 *   - Show empty state + Refresh button (sends SFX_REFRESH_HOSTS to SW)
 *   - Query active tab → send SFX_GET_ROUTE → render routing line
 *   - Review Mode toggle:
 *       CRITICAL: chrome.permissions.request MUST be the FIRST awaited call
 *       in the click handler (Pattern 3 / Pitfall 3 — no storage/tabs await
 *       before it or Chrome silently rejects the permission dialog).
 *
 * This file MUST NOT fetch 127.0.0.1/localhost — all HTTP is the SW's job.
 */

import { SFX_MSG } from '../../lib/types.js';
import type { HostEntry, MsgAddHost, MsgRemoveHost, MsgPairNative } from '../../lib/types.js';
import { sfxRegistry, sfxTokens, sfxPrefs } from '../../lib/storage.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const root = document.querySelector<HTMLDivElement>('#sfx-popup-root')!;
const hostSummaryEl = document.getElementById('sfx-host-summary')!;
const hostListEl = document.getElementById('sfx-host-list')!;
const emptyStateEl = document.getElementById('sfx-empty-state') as HTMLElement;
const refreshBtn = document.getElementById('sfx-refresh-btn') as HTMLButtonElement;
const addBtn = document.getElementById('sfx-add-btn') as HTMLButtonElement;
const addForm = document.getElementById('sfx-add-form') as HTMLElement;
const addPortInput = document.getElementById('sfx-add-port') as HTMLInputElement;
const addSubmitBtn = document.getElementById('sfx-add-submit') as HTMLButtonElement;
const addErrorEl = document.getElementById('sfx-add-error') as HTMLElement;
const reviewBtn = document.getElementById('sfx-review-btn') as HTMLButtonElement;
const toggleErrorEl = document.getElementById('sfx-toggle-error') as HTMLElement;
const hintsCheckbox = document.getElementById('sfx-hints-checkbox') as HTMLInputElement;
const routingLineEl = document.getElementById('sfx-routing-line')!;

// Pairing banner elements (Phase 9 — additive, always in DOM)
const pairingBanner = document.getElementById('sfx-pairing-banner') as HTMLElement;
const pairingStatus = document.getElementById('sfx-pairing-status') as HTMLElement;
const pairBtn = document.getElementById('sfx-pair-btn') as HTMLButtonElement;
const pairingDetails = document.getElementById('sfx-pairing-details') as HTMLDetailsElement;
const pairingErrorDetail = document.getElementById('sfx-pairing-error-detail') as HTMLElement;

// ---------------------------------------------------------------------------
// Utility: safe text helpers (no innerHTML with host-provided strings)
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Partial<HTMLElementTagNameMap[K]>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) Object.assign(node, attrs);
  for (const child of children) {
    if (typeof child === 'string') {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

// ---------------------------------------------------------------------------
// Pairing banner — state machine (09-UI-SPEC states 1-5)
// ---------------------------------------------------------------------------

/**
 * State 1: show banner, set status text, reveal Pair button.
 * Triggered on popup open when sfxRegistry is empty (fresh install).
 */
function showPairingState1(): void {
  pairingBanner.hidden = false;

  pairingStatus.className = '';
  pairingStatus.textContent = 'Host found — click to pair';

  pairBtn.hidden = false;
  pairBtn.disabled = false;
  pairBtn.className = '';
  pairBtn.textContent = 'Pair with host';

  pairingDetails.hidden = true;
}

/**
 * State 2: pairing in progress — disable button, show spinner class.
 */
function showPairingState2(): void {
  pairingBanner.hidden = false;

  pairingStatus.className = '';
  pairingStatus.textContent = 'Pairing…';

  pairBtn.hidden = false;
  pairBtn.disabled = true;
  pairBtn.classList.add('sfx-pairing');
  pairBtn.textContent = 'Pairing…';
}

/**
 * State 3: paired — show success message, hide button, schedule hide.
 * After 1200ms auto-transitions to state 5 (banner hidden).
 */
function showPairingState3(name: string): void {
  pairingBanner.hidden = false;

  pairingStatus.className = 'sfx-pairing-status--paired';
  // Phase 8 UAT finding: MUST NOT use checkmark alone — use word + glyph (09-UI-SPEC Color note)
  pairingStatus.textContent = '● Paired with ' + name;

  pairBtn.hidden = true;
  pairBtn.disabled = false;
  pairBtn.className = '';

  pairingDetails.hidden = true;

  // Auto-dismiss after 1200ms (UI-SPEC state 3 duration), then focus Review Mode btn
  setTimeout(() => {
    pairingBanner.hidden = true;
    reviewBtn.focus();
  }, 1200);
}

/**
 * State 4: pairing failed — show error, re-enable Retry button, show details.
 */
function showPairingState4(error: string): void {
  pairingBanner.hidden = false;

  pairingStatus.className = 'sfx-pairing-status--failed';
  // Build the error message as DOM nodes (no innerHTML with user-controlled strings)
  while (pairingStatus.firstChild) {
    pairingStatus.removeChild(pairingStatus.firstChild);
  }
  const line1 = document.createTextNode('Auto-pair failed. Run:');
  const br1 = document.createElement('br');
  const code = document.createElement('code');
  code.textContent = 'npx stickyfix init';
  const br2 = document.createElement('br');
  const line3 = document.createTextNode('Then click Refresh, or enter your token below.');
  pairingStatus.appendChild(line1);
  pairingStatus.appendChild(br1);
  pairingStatus.appendChild(code);
  pairingStatus.appendChild(br2);
  pairingStatus.appendChild(line3);

  pairBtn.hidden = false;
  pairBtn.disabled = false;
  pairBtn.className = '';
  pairBtn.textContent = 'Retry';

  // Show error detail in collapsible <details> if non-empty
  if (error) {
    pairingErrorDetail.textContent = error;
    pairingDetails.hidden = false;
    pairingDetails.open = false;
  } else {
    pairingDetails.hidden = true;
  }

  // Focus the retry button (UI-SPEC focus management)
  pairBtn.focus();
}

/**
 * State 5: already paired (returning user) — banner stays hidden.
 * The existing host list with green dot communicates paired status.
 */
function showPairingState5(): void {
  pairingBanner.hidden = true;
}

/**
 * doPair — invoked by Pair button click and Retry button click.
 * Sends PAIR_NATIVE to SW, handles response and updates state.
 */
async function doPair(registry: Record<string, HostEntry>, tokens: Record<string, string>): Promise<void> {
  showPairingState2();

  let resp: { ok: boolean; name?: string; error?: string } | null = null;
  try {
    const msg: MsgPairNative = { type: SFX_MSG.PAIR_NATIVE };
    resp = await chrome.runtime.sendMessage(msg);
  } catch (err) {
    resp = { ok: false, error: String(err) };
  }

  if (resp && resp.ok && typeof resp.name === 'string') {
    showPairingState3(resp.name);
    // Re-render host list now (banner still visible for 1200ms — host row with green dot appears)
    const [allRegistry, allTokensNow] = await Promise.all([
      sfxRegistry.getValue(),
      sfxTokens.getValue(),
    ]);
    renderHosts(allRegistry, allTokensNow);
  } else {
    showPairingState4(resp?.error ?? 'Unknown error');
  }

  // Suppress unused-param lint — registry and tokens provided by caller for future use
  void registry;
  void tokens;
}

// ---------------------------------------------------------------------------
// Render host rows
// ---------------------------------------------------------------------------

function renderHosts(
  registry: Record<string, HostEntry>,
  tokens: Record<string, string>
): void {
  const names = Object.keys(registry);

  // Update summary
  hostSummaryEl.textContent = names.length === 1 ? '1 host' : `${names.length} hosts`;

  // Toggle empty state vs host list
  if (names.length === 0) {
    hostListEl.hidden = true;
    emptyStateEl.hidden = false;
    return;
  }

  emptyStateEl.hidden = true;
  hostListEl.hidden = false;

  // Clear list and rebuild
  while (hostListEl.firstChild) {
    hostListEl.removeChild(hostListEl.firstChild);
  }

  for (const name of names) {
    const host = registry[name];
    const savedToken = tokens[name] ?? '';

    // Connection dot (green = reachable / grey = stale placeholder — true
    // reachability comes from SW on next REFRESH_HOSTS; we default to grey
    // and let the refresh cycle update. The SW owns HTTP probing.)
    const dot = el('span');
    dot.className = 'sfx-dot sfx-dot--grey';
    dot.setAttribute('title', 'port ' + String(host.port));

    // Host info block
    const nameEl = el('span');
    nameEl.className = 'sfx-host-name';
    nameEl.textContent = host.name;

    const portEl = el('span');
    portEl.className = 'sfx-host-port';
    portEl.textContent = ':' + String(host.port);

    const infoBlock = el('div');
    infoBlock.className = 'sfx-host-info';
    infoBlock.appendChild(nameEl);
    infoBlock.appendChild(portEl);

    // Token input (password-ish, monospace)
    const tokenInput = el('input');
    tokenInput.className = 'sfx-token-input';
    tokenInput.type = 'password';
    tokenInput.placeholder = 'token';
    tokenInput.value = savedToken;
    tokenInput.autocomplete = 'off';
    tokenInput.setAttribute('aria-label', name + ' token');

    // Persist the current input value to storage.local (EXT-09).
    // `silent` skips the re-render so we can keep focus / show inline confirm.
    async function persistToken(silent = false): Promise<void> {
      const allTokens = await sfxTokens.getValue();
      allTokens[host.name] = tokenInput.value;
      await sfxTokens.setValue(allTokens);
      if (!silent) {
        const [allRegistry, allTokensNow] = await Promise.all([
          sfxRegistry.getValue(),
          sfxTokens.getValue(),
        ]);
        renderHosts(allRegistry, allTokensNow);
      }
    }

    // Apply / Clear actions next to the token field
    const applyBtn = el('button');
    applyBtn.type = 'button';
    applyBtn.className = 'sfx-token-btn sfx-token-apply';
    applyBtn.textContent = 'Apply';
    applyBtn.title = 'Save this token';

    const clearBtn = el('button');
    clearBtn.type = 'button';
    clearBtn.className = 'sfx-token-btn sfx-token-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.title = 'Clear the saved token';

    // Remove host button — quiet destructive affordance (grey → red on hover)
    const removeBtn = el('button');
    removeBtn.type = 'button';
    removeBtn.className = 'sfx-host-remove';
    removeBtn.textContent = '−';
    removeBtn.title = 'Remove "' + name + '"';
    removeBtn.setAttribute('aria-label', 'Remove host ' + name);

    removeBtn.addEventListener('click', async () => {
      removeBtn.disabled = true;
      const msg: MsgRemoveHost = { type: SFX_MSG.REMOVE_HOST, name: host.name };
      try {
        await chrome.runtime.sendMessage(msg);
      } catch {
        // SW may be restarting — storage may still be updated; re-read anyway
      }
      const [allRegistry, allTokensNow] = await Promise.all([
        sfxRegistry.getValue(),
        sfxTokens.getValue(),
      ]);
      renderHosts(allRegistry, allTokensNow);
    });

    // Apply: persist without re-render, flash a brief ✓ so it's not silent.
    applyBtn.addEventListener('click', async () => {
      await persistToken(true);
      const prev = applyBtn.textContent;
      applyBtn.textContent = '✓';
      applyBtn.disabled = true;
      setTimeout(() => {
        applyBtn.textContent = prev;
        applyBtn.disabled = false;
      }, 900);
    });

    // Clear: empty the field and persist the removal (full re-render is fine).
    clearBtn.addEventListener('click', async () => {
      tokenInput.value = '';
      await persistToken();
    });

    // Persist on blur or Enter key (kept — Apply is an explicit alternative)
    tokenInput.addEventListener('blur', () => void persistToken(true));
    tokenInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        tokenInput.blur();
      }
    });

    // Right-column wrapper: [token input] over [Apply] [Clear] [−]
    const tokenWrap = el('div');
    tokenWrap.className = 'sfx-token-wrap';
    const tokenActions = el('div');
    tokenActions.className = 'sfx-token-actions';
    tokenActions.appendChild(applyBtn);
    tokenActions.appendChild(clearBtn);
    tokenActions.appendChild(removeBtn);
    tokenWrap.appendChild(tokenInput);
    tokenWrap.appendChild(tokenActions);

    // Row grid: [dot] [info] [token wrap]
    const row = el('div');
    row.className = 'sfx-host-row';
    row.appendChild(dot);
    row.appendChild(infoBlock);
    row.appendChild(tokenWrap);

    hostListEl.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Routing line
// ---------------------------------------------------------------------------

async function renderRoutingLine(): Promise<void> {
  routingLineEl.textContent = 'checking route…';

  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    routingLineEl.textContent = 'unmapped — pick on page';
    return;
  }

  const tab = tabs[0];
  if (!tab?.id || !tab.url) {
    routingLineEl.textContent = 'unmapped — pick on page';
    return;
  }

  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    routingLineEl.textContent = 'unmapped — pick on page';
    return;
  }

  try {
    const resp = await chrome.runtime.sendMessage({
      type: SFX_MSG.GET_ROUTE,
      tabId: tab.id,
      origin,
    });

    if (resp && resp.ok && resp.host) {
      const host = resp.host as HostEntry;
      routingLineEl.textContent =
        '→ ' + host.name + ' · ' + host.notesDir;
    } else {
      routingLineEl.textContent = 'unmapped — pick on page';
    }
  } catch {
    routingLineEl.textContent = 'unmapped — pick on page';
  }
}

// ---------------------------------------------------------------------------
// Refresh (sends REFRESH_HOSTS to SW, then re-renders)
// ---------------------------------------------------------------------------

async function doRefresh(): Promise<void> {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing…';

  try {
    await chrome.runtime.sendMessage({ type: SFX_MSG.REFRESH_HOSTS });
  } catch {
    // SW may be starting; re-read storage regardless
  }

  const [registry, tokens] = await Promise.all([
    sfxRegistry.getValue(),
    sfxTokens.getValue(),
  ]);
  renderHosts(registry, tokens);

  refreshBtn.disabled = false;
  refreshBtn.textContent = 'Refresh';
}

refreshBtn.addEventListener('click', doRefresh);

// ---------------------------------------------------------------------------
// Add-host form — wire + button and submit
// ---------------------------------------------------------------------------

addBtn.addEventListener('click', () => {
  const nowHidden = !addForm.hidden;
  addForm.hidden = nowHidden;
  addErrorEl.hidden = true;
  addErrorEl.textContent = '';
  if (!nowHidden) {
    addPortInput.focus();
  }
});

async function doAddHost(): Promise<void> {
  addErrorEl.hidden = true;
  addErrorEl.textContent = '';

  const port = parseInt(addPortInput.value, 10);
  const msg: MsgAddHost = { type: SFX_MSG.ADD_HOST, port };

  addSubmitBtn.disabled = true;
  addSubmitBtn.textContent = 'Probing…';

  let resp: { ok: boolean; host?: HostEntry; error?: string } | null = null;
  try {
    resp = await chrome.runtime.sendMessage(msg);
  } catch (err) {
    resp = { ok: false, error: String(err) };
  } finally {
    addSubmitBtn.disabled = false;
    addSubmitBtn.textContent = 'Probe & add';
  }

  if (resp && resp.ok) {
    // Success: hide + clear the form, re-render host list
    addForm.hidden = true;
    addPortInput.value = '39240';
    const [allRegistry, allTokensNow] = await Promise.all([
      sfxRegistry.getValue(),
      sfxTokens.getValue(),
    ]);
    renderHosts(allRegistry, allTokensNow);
  } else {
    addErrorEl.textContent = resp?.error ?? 'Unknown error';
    addErrorEl.hidden = false;
  }
}

addSubmitBtn.addEventListener('click', () => void doAddHost());

addPortInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    void doAddHost();
  }
});

// ---------------------------------------------------------------------------
// Review Mode toggle — state helpers
// ---------------------------------------------------------------------------

function setReviewBtnEnter(): void {
  reviewBtn.textContent = 'Enter Review Mode';
  reviewBtn.className = '';
}

function setReviewBtnExit(): void {
  reviewBtn.textContent = 'Exit Review Mode';
  reviewBtn.className = 'sfx-exit-mode';
}

function setReviewBtnGrant(): void {
  reviewBtn.textContent = 'Grant page access to enter Review Mode';
  reviewBtn.className = 'sfx-grant-mode';
}

function showToggleError(msg: string): void {
  toggleErrorEl.textContent = msg;
  toggleErrorEl.hidden = false;
}

function clearToggleError(): void {
  toggleErrorEl.hidden = true;
  toggleErrorEl.textContent = '';
}

// ---------------------------------------------------------------------------
// Review Mode state — track per active tab via sfxPrefs.reviewMode
// ---------------------------------------------------------------------------

let reviewModeActive = false;

async function loadReviewState(): Promise<void> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }

  const tab = tabs[0];
  if (!tab?.id) return;

  try {
    const prefs = await sfxPrefs.getValue();
    const active = prefs.reviewMode[String(tab.id)] ?? false;
    reviewModeActive = active;
    if (active) {
      setReviewBtnExit();
    } else {
      setReviewBtnEnter();
    }
  } catch {
    // Default to Enter state
  }
}

// ---------------------------------------------------------------------------
// Show-hints preference — checkbox load + persist
// ---------------------------------------------------------------------------

/** Load the showHints pref into the checkbox (default true when undefined). */
async function loadHintsPref(): Promise<void> {
  try {
    const prefs = await sfxPrefs.getValue();
    // Treat missing/legacy as default ON (prefs persisted before showHints existed)
    hintsCheckbox.checked = prefs.showHints !== false;
  } catch {
    hintsCheckbox.checked = true;
  }
}

// Persist on change — read-modify-write so reviewMode is preserved (never clobbered).
hintsCheckbox.addEventListener('change', () => {
  void (async () => {
    try {
      const prefs = await sfxPrefs.getValue();
      prefs.showHints = hintsCheckbox.checked;
      await sfxPrefs.setValue(prefs);
    } catch {
      // Non-fatal — the next open re-reads current state
    }
  })();
});

// ---------------------------------------------------------------------------
// Review Mode toggle click handler
//
// CRITICAL ORDERING (Pattern 3 / Pitfall 3):
//   chrome.permissions.request MUST be the FIRST awaited call.
//   Any storage read or chrome.tabs.query BEFORE the request breaks the
//   gesture chain — Chrome silently rejects the permission dialog.
// ---------------------------------------------------------------------------

reviewBtn.addEventListener('click', async () => {
  clearToggleError();
  reviewBtn.disabled = true;

  // ── EXIT branch ────────────────────────────────────────────────────────────
  if (reviewModeActive) {
    let tab: chrome.tabs.Tab | undefined;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs[0];
    } catch {
      showToggleError('Could not query active tab.');
      reviewBtn.disabled = false;
      return;
    }

    if (!tab?.id) {
      showToggleError('No active tab.');
      reviewBtn.disabled = false;
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: SFX_MSG.EXIT_REVIEW,
        tabId: tab.id,
      });
    } catch {
      // Best-effort — content script may already be gone
    }

    // Update prefs
    try {
      const prefs = await sfxPrefs.getValue();
      prefs.reviewMode[String(tab.id)] = false;
      await sfxPrefs.setValue(prefs);
    } catch {
      // Non-fatal
    }

    reviewModeActive = false;
    setReviewBtnEnter();
    reviewBtn.disabled = false;
    return;
  }

  // ── ENTER branch ───────────────────────────────────────────────────────────
  // STEP 1: permission request — MUST be the FIRST awaited call (user gesture).
  // DO NOT insert any chrome.storage or chrome.tabs call before this line.
  let granted: boolean;
  try {
    granted = await chrome.permissions.request({
      origins: ['<all_urls>'],
    });
  } catch {
    granted = false;
  }

  if (!granted) {
    setReviewBtnGrant();
    showToggleError('Page access is required to enter Review Mode.');
    reviewBtn.disabled = false;
    return;
  }

  // STEP 2: only after grant — query the active tab and send ENTER_REVIEW
  let tab: chrome.tabs.Tab | undefined;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  } catch {
    showToggleError('Could not query active tab.');
    reviewBtn.disabled = false;
    return;
  }

  if (!tab?.id || !tab.url) {
    showToggleError('No active tab URL.');
    reviewBtn.disabled = false;
    return;
  }

  let origin: string;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    showToggleError('Active tab has no valid URL.');
    reviewBtn.disabled = false;
    return;
  }

  let resp: { ok: boolean; route?: HostEntry | null; error?: string } | null = null;
  try {
    resp = await chrome.runtime.sendMessage({
      type: SFX_MSG.ENTER_REVIEW,
      tabId: tab.id,
      origin,
    });
  } catch (err) {
    showToggleError('SW error: ' + String(err));
    reviewBtn.disabled = false;
    return;
  }

  if (!resp || !resp.ok) {
    showToggleError(resp?.error ?? 'Could not enter Review Mode.');
    reviewBtn.disabled = false;
    return;
  }

  // Update prefs + UI
  try {
    const prefs = await sfxPrefs.getValue();
    prefs.reviewMode[String(tab.id)] = true;
    await sfxPrefs.setValue(prefs);
  } catch {
    // Non-fatal
  }

  reviewModeActive = true;
  setReviewBtnExit();
  reviewBtn.disabled = false;

  // Update routing line to reflect the route returned
  if (resp.route) {
    const host = resp.route;
    routingLineEl.textContent =
      '→ ' + host.name + ' · ' + host.notesDir;
  }

  // Review Mode is now active — close the popup so the user lands straight on
  // the page (no extra click to dismiss). Success path only.
  window.close();
});

// ---------------------------------------------------------------------------
// Pair button click handler — wired once; doPair is invoked on each click
// (covers both initial "Pair with host" and "Retry" states)
// ---------------------------------------------------------------------------

pairBtn.addEventListener('click', () => {
  // Read registry+tokens at click time (Pitfall 1 — re-read, not cached)
  void (async () => {
    const [registry, tokens] = await Promise.all([
      sfxRegistry.getValue(),
      sfxTokens.getValue(),
    ]);
    await doPair(registry, tokens);
  })();
});

// ---------------------------------------------------------------------------
// Initialization — runs on popup open
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  // Load host list and review state in parallel
  const [registry, tokens] = await Promise.all([
    sfxRegistry.getValue(),
    sfxTokens.getValue(),
  ]);

  renderHosts(registry, tokens);
  await loadReviewState();
  await loadHintsPref();
  await renderRoutingLine();

  // Pairing banner state machine (09-UI-SPEC Interaction Contract):
  //   - Empty registry (fresh install / cleared state) → state 1 (show banner, focus btn)
  //   - Non-empty registry (returning user) → state 5 (banner stays hidden)
  // Auto-fire on popup open is intentionally NOT done — button-driven per UI-SPEC rationale.
  if (Object.keys(registry).length === 0) {
    showPairingState1();
    pairBtn.focus(); // focus the primary action for fresh-install UX
  } else {
    showPairingState5();
  }
}

init().catch(err => {
  // Fail-safe: show a minimal error rather than a blank popup
  const errEl = el('p');
  errEl.style.cssText = 'color:#dc2626;padding:12px;font-size:12px';
  errEl.textContent = 'Error loading popup: ' + String(err);
  root.appendChild(errEl);
});
