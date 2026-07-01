/**
 * stikfix Notes Panel — Phase C (Review Loop v2)
 *
 * Exports: mountPanel, togglePanel, refreshPanel, teardownPanel, isPanelOpen
 *
 * Security invariants:
 *  - DOM via createElement/textContent only — no innerHTML with external strings (INVARIANT C)
 *  - Never fetches 127.0.0.1 directly — all HTTP via chrome.runtime.sendMessage SW relay
 *  - sfx-* namespace (clean-room gate)
 */

import './panel.css';
import { SFX_LIST_ANNOTATIONS } from '../../lib/types.js';
import { scrollToPinBySerial } from './pin.js';

// PinDescriptor shape returned by the SW relay
interface PinDescriptor {
  serial: string;
  mode: 'free' | 'element';
  status: string;
  url: string;
  text: string;
  reply?: string;
  fixedIn?: string;
  screenshots: string[];
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
  note_position?: { x: number; y: number };
}

type FilterStatus = 'all' | 'unread' | 'flagged' | 'resolved' | 'read';

// Module-level state (reset on teardown)
let _container: HTMLElement | null = null;
let _tabId: number = 0;
let _toast: ((msg: string, isError: boolean) => void) | null = null;
let _panelEl: HTMLDivElement | null = null;
let _open = false;
let _scopeAll = false;
let _filter: FilterStatus = 'all';
let _searchText = '';
let _pins: PinDescriptor[] = [];

// DOM references (set on mount, cleared on teardown)
let _countEl: HTMLSpanElement | null = null;
let _listEl: HTMLDivElement | null = null;
let _searchInput: HTMLInputElement | null = null;
let _filterBtns: Map<FilterStatus, HTMLButtonElement> = new Map();
let _scopeToggle: HTMLInputElement | null = null;
let _scopeLabel: HTMLSpanElement | null = null;

export function mountPanel(
  container: HTMLElement,
  tabId: number,
  toast: (msg: string, isError: boolean) => void
): void {
  // Idempotent — never double-mount
  if (_panelEl) return;

  _container = container;
  _tabId = tabId;
  _toast = toast;

  // Outer panel card
  const panel = document.createElement('div');
  panel.className = 'sfx-panel';
  panel.setAttribute('aria-label', 'Notes panel');
  panel.setAttribute('role', 'dialog');
  panel.style.display = 'none'; // hidden by default
  _panelEl = panel;

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'sfx-panel-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'sfx-panel-title-row';

  const title = document.createElement('span');
  title.className = 'sfx-panel-title';
  title.textContent = 'Notes';

  const count = document.createElement('span');
  count.className = 'sfx-panel-count';
  count.textContent = '0';
  _countEl = count;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sfx-panel-close';
  closeBtn.setAttribute('aria-label', 'Close notes panel');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => togglePanel());

  titleRow.appendChild(title);
  titleRow.appendChild(count);
  titleRow.appendChild(closeBtn);
  header.appendChild(titleRow);

  // --- Scope toggle row ---
  const scopeRow = document.createElement('div');
  scopeRow.className = 'sfx-panel-scope-row';

  const scopeCheckbox = document.createElement('input');
  scopeCheckbox.type = 'checkbox';
  scopeCheckbox.id = 'sfx-panel-scope-all';
  scopeCheckbox.className = 'sfx-panel-scope-checkbox';
  scopeCheckbox.checked = false;
  _scopeToggle = scopeCheckbox;

  const scopeLabelEl = document.createElement('label');
  scopeLabelEl.htmlFor = 'sfx-panel-scope-all';
  scopeLabelEl.className = 'sfx-panel-scope-lbl';
  scopeLabelEl.textContent = 'All pages';
  _scopeLabel = scopeLabelEl;

  scopeCheckbox.addEventListener('change', () => {
    _scopeAll = scopeCheckbox.checked;
    fetchAndRender();
  });

  scopeRow.appendChild(scopeCheckbox);
  scopeRow.appendChild(scopeLabelEl);
  header.appendChild(scopeRow);

  // --- Filter chips row ---
  const filterRow = document.createElement('div');
  filterRow.className = 'sfx-panel-filter-row';
  _filterBtns = new Map();

  const filters: { key: FilterStatus; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'flagged', label: 'Flagged' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'read', label: 'Read' },
  ];

  for (const f of filters) {
    const btn = document.createElement('button');
    btn.className = 'sfx-panel-filter-btn';
    btn.setAttribute('data-filter', f.key);
    btn.setAttribute('aria-pressed', f.key === _filter ? 'true' : 'false');
    if (f.key === _filter) btn.classList.add('sfx-panel-filter-active');
    // text content will be set by updateFilterCounts()
    btn.textContent = f.label;
    btn.addEventListener('click', () => {
      _filter = f.key;
      updateFilterActive();
      renderList();
    });
    _filterBtns.set(f.key, btn);
    filterRow.appendChild(btn);
  }
  header.appendChild(filterRow);

  // --- Search input ---
  const searchWrap = document.createElement('div');
  searchWrap.className = 'sfx-panel-search-wrap';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'sfx-panel-search';
  searchInput.placeholder = 'Search notes…';
  searchInput.setAttribute('aria-label', 'Search notes');
  _searchInput = searchInput;

  searchInput.addEventListener('input', () => {
    _searchText = searchInput.value;
    renderList();
  });

  searchWrap.appendChild(searchInput);
  header.appendChild(searchWrap);

  // --- List body ---
  const listEl = document.createElement('div');
  listEl.className = 'sfx-panel-list';
  listEl.setAttribute('role', 'list');
  _listEl = listEl;

  panel.appendChild(header);
  panel.appendChild(listEl);
  container.appendChild(panel);
}

export function togglePanel(): void {
  if (!_panelEl) return;
  if (_open) {
    _open = false;
    _panelEl.style.display = 'none';
  } else {
    _open = true;
    _panelEl.style.display = '';
    fetchAndRender();
  }
}

export function refreshPanel(): void {
  if (!_open || !_panelEl) return;
  fetchAndRender();
}

export function teardownPanel(): void {
  if (_panelEl && _panelEl.parentElement) {
    _panelEl.parentElement.removeChild(_panelEl);
  }
  _panelEl = null;
  _container = null;
  _tabId = 0;
  _toast = null;
  _open = false;
  _scopeAll = false;
  _filter = 'all';
  _searchText = '';
  _pins = [];
  _countEl = null;
  _listEl = null;
  _searchInput = null;
  _filterBtns = new Map();
  _scopeToggle = null;
  _scopeLabel = null;
}

export function isPanelOpen(): boolean {
  return _open;
}

/**
 * The list scope the user is currently viewing: 'all' when the panel is open
 * AND the "All pages" toggle is on, otherwise undefined (current page only).
 * Used by the live poller so an All-pages view also live-updates on changes to
 * notes that live on other pages.
 */
export function getActiveScope(): 'all' | undefined {
  return _open && _scopeAll ? 'all' : undefined;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function fetchAndRender(): void {
  if (!_tabId) return;
  const scope = _scopeAll ? 'all' : undefined;

  try {
    chrome.runtime.sendMessage(
      { type: SFX_LIST_ANNOTATIONS, tabId: _tabId, scope, done: true },
      (resp: { ok: boolean; pins?: PinDescriptor[]; error?: string } | undefined) => {
        if (chrome.runtime.lastError || !resp) {
          const errMsg = chrome.runtime.lastError?.message ?? 'No response from SW';
          _toast?.(`Notes panel: ${errMsg}`, true);
          return;
        }
        if (!resp.ok) {
          _toast?.(`Notes panel: ${resp.error ?? 'Fetch failed'}`, true);
          return;
        }
        _pins = Array.isArray(resp.pins) ? resp.pins : [];
        updateFilterCounts();
        renderList();
      }
    );
  } catch (e: unknown) {
    _toast?.(`Notes panel: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

function filteredPins(): PinDescriptor[] {
  let result = _pins;

  // Status filter. 'all' shows OPEN work only (status !== 'read'); the dedicated
  // 'read' chip shows archived notes; other chips match their status exactly.
  if (_filter === 'all') {
    result = result.filter(p => p.status !== 'read');
  } else if (_filter === 'read') {
    result = result.filter(p => p.status === 'read');
  } else {
    result = result.filter(p => p.status === _filter);
  }

  // Search filter (case-insensitive over text + reply)
  if (_searchText.trim()) {
    const q = _searchText.toLowerCase();
    result = result.filter(p =>
      p.text.toLowerCase().includes(q) ||
      (p.reply ?? '').toLowerCase().includes(q)
    );
  }

  return result;
}

function updateFilterCounts(): void {
  const openCount = _pins.filter(p => p.status !== 'read').length;
  const counts: Record<FilterStatus, number> = {
    all: openCount,
    unread: _pins.filter(p => p.status === 'unread').length,
    flagged: _pins.filter(p => p.status === 'flagged').length,
    resolved: _pins.filter(p => p.status === 'resolved').length,
    read: _pins.filter(p => p.status === 'read').length,
  };

  for (const [key, btn] of _filterBtns) {
    const label = key === 'all' ? 'All' : key.charAt(0).toUpperCase() + key.slice(1);
    btn.textContent = `${label} (${counts[key]})`;
  }

  if (_countEl) {
    _countEl.textContent = String(openCount);
  }
}

function updateFilterActive(): void {
  for (const [key, btn] of _filterBtns) {
    const active = key === _filter;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    if (active) {
      btn.classList.add('sfx-panel-filter-active');
    } else {
      btn.classList.remove('sfx-panel-filter-active');
    }
  }
}

function renderList(): void {
  if (!_listEl) return;

  // Clear existing rows
  while (_listEl.firstChild) {
    _listEl.removeChild(_listEl.firstChild);
  }

  const visible = filteredPins();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sfx-panel-empty';
    empty.textContent = _pins.length === 0 ? 'No notes yet.' : 'No matches.';
    _listEl.appendChild(empty);
    return;
  }

  for (const pin of visible) {
    _listEl.appendChild(buildRow(pin));
  }
}

function buildRow(pin: PinDescriptor): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sfx-panel-row';
  row.setAttribute('role', 'listitem');
  row.setAttribute('tabindex', '0');

  // Status dot
  const dot = document.createElement('span');
  dot.className = `sfx-panel-dot sfx-panel-dot-${pin.status}`;
  dot.setAttribute('title', pin.status);
  row.appendChild(dot);

  // Body column
  const body = document.createElement('div');
  body.className = 'sfx-panel-row-body';

  // Top line: serial + mode glyph + first line of text
  const topLine = document.createElement('div');
  topLine.className = 'sfx-panel-row-top';

  const serialEl = document.createElement('span');
  serialEl.className = 'sfx-panel-serial';
  serialEl.textContent = `#${pin.serial}`;
  topLine.appendChild(serialEl);

  const modeEl = document.createElement('span');
  modeEl.className = 'sfx-panel-mode';
  modeEl.textContent = pin.mode === 'element' ? '📌' : '🗒';
  topLine.appendChild(modeEl);

  const textEl = document.createElement('span');
  textEl.className = 'sfx-panel-text';
  const firstLine = pin.text.split('\n')[0] ?? pin.text;
  textEl.textContent = firstLine;
  topLine.appendChild(textEl);

  body.appendChild(topLine);

  // Reply line (for flagged/resolved)
  if ((pin.status === 'resolved' || pin.status === 'flagged') && pin.reply) {
    const replyEl = document.createElement('div');
    replyEl.className = 'sfx-panel-reply';
    const prefix = pin.status === 'resolved' ? '✓ ' : '⚠ ';
    replyEl.textContent = prefix + pin.reply;
    body.appendChild(replyEl);
  }

  // All-pages mode: show page path
  if (_scopeAll) {
    try {
      const noteUrl = new URL(pin.url);
      const pathEl = document.createElement('div');
      pathEl.className = 'sfx-panel-path';
      pathEl.textContent = noteUrl.hostname + noteUrl.pathname;
      body.appendChild(pathEl);
    } catch {
      // malformed URL — skip path display
    }
  }

  row.appendChild(body);

  // Click/keyboard handler
  const handleActivate = () => {
    // Parse the note's URL. pin.url comes from a note file on disk (which may be
    // shared via a repo / written by another contributor), so it is untrusted:
    // only http(s) destinations may ever reach window.location (a javascript:/data:
    // url would otherwise execute in the page origin — security review W1).
    let noteUrl: URL | null = null;
    try {
      noteUrl = new URL(pin.url);
    } catch {
      noteUrl = null;
    }

    const onCurrentPage =
      noteUrl === null || // malformed → assume current page (best effort)
      (noteUrl.pathname === window.location.pathname &&
        noteUrl.hostname === window.location.hostname);

    if (onCurrentPage) {
      // Close panel, scroll to pin
      togglePanel();
      scrollToPinBySerial(pin.serial);
    } else if (noteUrl !== null && (noteUrl.protocol === 'http:' || noteUrl.protocol === 'https:')) {
      // Navigate to the note's page (All-pages mode only) — http(s) only.
      window.location.href = noteUrl.href;
    } else {
      _toast?.('Cannot open note — unsafe URL', true);
    }
  };

  row.addEventListener('click', handleActivate);
  row.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivate();
    }
  });

  return row;
}
