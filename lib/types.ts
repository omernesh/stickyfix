/**
 * Shared TypeScript types for the stickyfix extension.
 * Consumed by: background.ts, popup/main.ts, review.content/index.ts
 *
 * Re-exports AnnotationPayload/ElementContext/Screenshot from the host package
 * (single source of truth — do NOT redefine these interfaces here).
 */

// Re-export host payload types — the extension is a consumer of these shapes.
export type { AnnotationPayload, ElementContext, Screenshot } from '../host/src/types.js';

// ---------------------------------------------------------------------------
// Host registry types
// ---------------------------------------------------------------------------

/**
 * A single discovered stickyfix host.
 * Keyed by `name` in the registry (not port — ports change on restart).
 */
export interface HostEntry {
  name: string;
  port: number;
  origins: string[];
  notesDir: string;
  /** null until the user enters a token in the popup */
  token: string | null;
}

// ---------------------------------------------------------------------------
// Storage state
// ---------------------------------------------------------------------------

/**
 * The full shape of everything the SW reads from chrome.storage.local.
 * The SW re-reads this at the top of every message handler.
 */
export interface StorageState {
  /** host name → HostEntry */
  registry: Record<string, HostEntry>;
  /** host name → token string */
  tokens: Record<string, string>;
  /** origin → host name */
  originMap: Record<string, string>;
  /** extension preferences */
  prefs: { reviewMode: Record<string, boolean> };
}

// ---------------------------------------------------------------------------
// Message protocol (D-02) — content script ↔ service worker
// ---------------------------------------------------------------------------

/**
 * Message-type constants. Uppercase snake, sfx-namespaced.
 * Downstream plans (02/03/04) use these exact strings.
 */
export const SFX_MSG = {
  ENTER_REVIEW: 'SFX_ENTER_REVIEW',
  EXIT_REVIEW: 'SFX_EXIT_REVIEW',
  GET_ROUTE: 'SFX_GET_ROUTE',
  SEND_ANNOTATION: 'SFX_SEND_ANNOTATION',
  REFRESH_HOSTS: 'SFX_REFRESH_HOSTS',
  ADD_HOST: 'SFX_ADD_HOST',
  REMOVE_HOST: 'SFX_REMOVE_HOST',
} as const;

export type SfxMsgType = (typeof SFX_MSG)[keyof typeof SFX_MSG];

/**
 * Two extra message-type constants used by the content script ↔ SW channel.
 *
 * They live HERE (a side-effect-free module) and NOT in background.ts: the
 * content script imports these strings, and importing from background.ts would
 * drag its top-level SW registrations (chrome.runtime.onStartup/onInstalled/
 * onMessage.addListener) into the content-script bundle, where onStartup is
 * undefined → "Cannot read properties of undefined (reading 'addListener')"
 * crashes the content script on startup.
 */
export const SFX_SET_ROUTE = 'SFX_SET_ROUTE' as const;
export const SFX_GET_TAB_ID = 'SFX_GET_TAB_ID' as const;
// Add alongside SFX_SET_ROUTE, SFX_GET_TAB_ID (side-effect-free — see invariant A comment above)
export const SFX_CAPTURE_TAB = 'SFX_CAPTURE_TAB' as const;

export interface MsgCaptureTab {
  type: typeof SFX_CAPTURE_TAB;
  tabId: number;
}

// ---------------------------------------------------------------------------
// Discriminated union for all SW-bound messages
// ---------------------------------------------------------------------------

export interface MsgEnterReview {
  type: typeof SFX_MSG.ENTER_REVIEW;
  tabId: number;
  origin: string;
}

export interface MsgExitReview {
  type: typeof SFX_MSG.EXIT_REVIEW;
  tabId: number;
}

export interface MsgGetRoute {
  type: typeof SFX_MSG.GET_ROUTE;
  tabId: number;
  origin: string;
}

export interface MsgSendAnnotation {
  type: typeof SFX_MSG.SEND_ANNOTATION;
  tabId: number;
  payload: import('../host/src/types.js').AnnotationPayload;
}

export interface MsgRefreshHosts {
  type: typeof SFX_MSG.REFRESH_HOSTS;
}

export interface MsgAddHost {
  type: typeof SFX_MSG.ADD_HOST;
  port: number;
}

export interface MsgRemoveHost {
  type: typeof SFX_MSG.REMOVE_HOST;
  name: string;
}

/** Discriminated union of all messages the SW handles */
export type SfxMessage =
  | MsgEnterReview
  | MsgExitReview
  | MsgGetRoute
  | MsgSendAnnotation
  | MsgRefreshHosts
  | MsgAddHost
  | MsgRemoveHost;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export type SfxResponse<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
