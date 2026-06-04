/**
 * WXT storage.defineItem definitions for the stickyfix extension.
 * Uses chrome.storage.local via WXT's typed wrapper.
 *
 * NOTE: This file imports from 'wxt/utils/storage' and is intentionally
 * excluded from tsconfig.lib.json (node:test compile path) because wxt is
 * not resolvable in a plain Node.js context.
 */

import { storage } from 'wxt/utils/storage';
import type { HostEntry, StorageState } from './types.js';

// ---------------------------------------------------------------------------
// Named storage items
// ---------------------------------------------------------------------------

/** Host registry: name → HostEntry */
export const sfxRegistry = storage.defineItem<Record<string, HostEntry>>(
  'local:sfxRegistry',
  { fallback: {} }
);

/** Per-host auth tokens: name → token string */
export const sfxTokens = storage.defineItem<Record<string, string>>(
  'local:sfxTokens',
  { fallback: {} }
);

/** Origin → host name mapping (persisted after one-time dropdown selection) */
export const sfxOriginMap = storage.defineItem<Record<string, string>>(
  'local:sfxOriginMap',
  { fallback: {} }
);

/** Extension preferences */
export const sfxPrefs = storage.defineItem<{ reviewMode: Record<string, boolean>; showHints: boolean }>(
  'local:sfxPrefs',
  // showHints defaults ON. Note: prefs persisted before this field existed will
  // lack showHints — read sites must treat missing as default (prefs.showHints !== false).
  { fallback: { reviewMode: {}, showHints: true } }
);

// ---------------------------------------------------------------------------
// Convenience loader
// ---------------------------------------------------------------------------

/**
 * Load all storage keys in parallel and return a typed StorageState.
 * Call at the TOP of every SW message handler — never rely on module-level cache
 * (the MV3 service worker is recycled after ~30s idle; globals are zeroed).
 */
export async function loadStorageState(): Promise<StorageState> {
  const [registry, tokens, originMap, prefs] = await Promise.all([
    sfxRegistry.getValue(),
    sfxTokens.getValue(),
    sfxOriginMap.getValue(),
    sfxPrefs.getValue(),
  ]);
  return { registry, tokens, originMap, prefs };
}
