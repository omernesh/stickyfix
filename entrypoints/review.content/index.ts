/**
 * stickyfix review UI content script — runtime-only (NOT in static manifest).
 *
 * WXT registration:'runtime' means this file is compiled to
 * content-scripts/review.js but NOT added to the manifest's content_scripts
 * array. The SW injects it on demand via chrome.scripting.executeScript (EXT-02).
 *
 * createShadowRootUi REQUIRES the ContentScriptContext (ctx) from main(ctx).
 * This is the only way to use it with on-demand injection (WXT Discussion #623).
 */

import './styles.css'; // MUST be top-level for cssInjectionMode:'ui' to pick it up

import { mountChip, teardownChip, getTabId, refreshChipRoute } from './chip.js';
import { mountFab } from './fab.js';
import { openCard, closeCard, openElementCard } from './card.js';
import { showToast } from './toast.js';
import { SFX_MSG } from '../../lib/types.js';
import { captureElementContext } from '../../lib/element-context.js';
import { exitPickMode } from './picker.js';
import { mountPins, teardownPins } from './pin.js';
import { mountPanel, togglePanel, teardownPanel, refreshPanel } from './panel.js';

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',       // NOT in static manifest — EXT-02
  cssInjectionMode: 'ui',        // WXT injects CSS into the shadow root (A4 check on first build)

  async main(ctx) {
    // Idempotency guard: never allow two review UIs in one frame.
    //
    // The DOM check alone is insufficient: createShadowRootUi only appends the
    // <sfx-review-ui> host during ui.mount() (below), which runs AFTER the
    // `await createShadowRootUi(...)` on the next line. A second injection — the
    // SW re-injecting on tabs.onUpdated 'complete', a double 'complete' fire, or
    // a fast re-enter — can run main() inside that await window, see no host
    // element yet, and mount a duplicate chip. A synchronous flag on the
    // isolated-world `window` (shared by every executeScript injection into the
    // same frame) closes that race: it is set before the first await and checked
    // before it. Cleared in onRemove so a later re-enter can mount again.
    const w = window as Window & { __sfxReviewActive?: boolean };
    if (w.__sfxReviewActive || document.querySelector('sfx-review-ui')) return;
    w.__sfxReviewActive = true;

    // SPA re-scope wiring (set once tabId resolves in onMount; torn down in
    // onRemove). pinRefresh re-fetches pins + chip route for the current URL
    // when the SW signals an in-page navigation; detachUrlListener removes the
    // runtime listener so it never outlives the UI or fires after exit.
    let pinRefresh: (() => void) | null = null;
    let detachUrlListener: (() => void) | null = null;

    // createShadowRootUi must be called inside main(ctx) — ctx is not available
    // in a plain scripting.executeScript func injection (WXT Discussion #623)
    const ui = await createShadowRootUi(ctx, {
      name: 'sfx-review-ui',
      position: 'inline',         // 'overlay' is undocumented — use 'inline'
      // FIX 3: anchor to documentElement + append:'last' ensures the shadow host
      // is the LAST child of <html>.  With equal max z-index (2147483647 set in
      // :host) DOM paint order gives us the top slot over page popovers.
      anchor: document.documentElement,
      append: 'last',
      // z-index 2147483647 is set in :host via styles.css (cssInjectionMode:'ui')
      // WXT does not expose zIndex as an option for createShadowRootUi

      onMount(container: HTMLElement) {
        // Shared toast adapter — defined ABOVE mountChip so it is in scope for
        // the picker handler (onPickerClick) passed as mountChip's 3rd arg (D-01/D-08)
        const toast = (msg: string, isError: boolean) =>
          showToast(container, msg, isError);

        // onMount-scoped mutable: holds the resolved tabId so the picker handler
        // (which is synchronously passed to mountChip) can close over it once resolved.
        let resolvedTabId: number | null = null;

        // Mount chip synchronously — BEFORE the async getTabId().then block.
        // chip.ts will call onPickerClick(el) when the user clicks a page element
        // in pick mode. The handler is a safe no-op when resolvedTabId is still null
        // (matches the existing FAB skip behavior when tabId rejects).
        mountChip(container, () => ui.remove(), (el: Element, reArm: () => void) => {
          if (resolvedTabId === null) return;
          openElementCard(
            container, resolvedTabId, captureElementContext(el),
            () => { /* element card has no FAB to collapse */ },
            toast,
            // onSent: re-arm pick mode AND re-fetch pins after a successful Send
            () => {
              reArm();
              if (resolvedTabId !== null) {
                teardownPins();
                mountPins(container, resolvedTabId, toast).catch(
                  (err: unknown) => toast(`Could not load pins — ${String(err)}`, true)
                );
              }
              // Refresh the chip: a card Send may have just established a folder
              // mapping → swap the chip from dropdown/needs-folder to routed label.
              refreshChipRoute(container);
              // Phase C: sync notes panel after Send
              refreshPanel();
            },
            // onDiscard: re-arm pick mode only (nothing was written → no pin re-fetch).
            // Fires on Discard/Esc; never on Send success (onSent owns that path) so
            // pick mode is never double-armed for a single card close.
            () => {
              reArm();
            }
          );
        }, () => togglePanel());

        // Resolve tabId once from chip's canonical getTabId (not duplicated here)
        // and mount the FAB. openCard/closeCard share the same container.
        getTabId()
          .then(tabId => {
            // Store resolved tabId so the picker handler (above) can use it
            resolvedTabId = tabId;

            // WR-01: wire aria-expanded on the FAB element returned by mountFab.
            // 'false' at construction (set in fab.ts); flip to 'true' when the
            // card opens, back to 'false' when it dismisses.
            const fab = mountFab(container, () => {
              fab.setAttribute('aria-expanded', 'true');
              openCard(
                container,
                tabId,
                () => {
                  // onDismiss: card closed (Cancel or Send success) → collapse FAB
                  fab.setAttribute('aria-expanded', 'false');
                },
                toast,
                // onSent (Phase 6): re-fetch pins after a successful free-note Send
                // Guard: resolvedTabId captured by closure (may be null on race)
                () => {
                  if (resolvedTabId !== null) {
                    teardownPins();
                    mountPins(container, resolvedTabId, toast).catch(
                      (err: unknown) => toast(`Could not load pins — ${String(err)}`, true)
                    );
                  }
                  // Refresh the chip: a card Send may have just established a folder
                  // mapping → swap the chip from dropdown/needs-folder to routed label.
                  refreshChipRoute(container);
                  // Phase C: sync notes panel after Send
                  refreshPanel();
                }
              );
            });

            // Phase 6: mount pins after tabId resolves (PIN-01)
            mountPins(container, tabId, toast).catch(
              (err: unknown) => toast(`Could not load pins — ${String(err)}`, true)
            );

            // Phase C: mount notes panel (hidden by default; tabId now resolved)
            mountPanel(container, tabId, toast);

            // SPA navigation re-scope: pins + chip route are URL-scoped, but an
            // in-page nav does not reload the document, so without this the prior
            // URL's pins linger on the new page. The SW sends URL_CHANGED on such
            // navs; re-fetch pins (URL-filtered by the host) and refresh the chip.
            pinRefresh = () => {
              if (!container.isConnected) return; // UI already removed — no-op
              teardownPins();
              mountPins(container, tabId, toast).catch(
                (err: unknown) => toast(`Could not load pins — ${String(err)}`, true)
              );
              refreshChipRoute(container);
            };
            const urlChangeListener = (msg: { type?: string }) => {
              if (msg?.type === SFX_MSG.URL_CHANGED) pinRefresh?.();
            };
            chrome.runtime.onMessage.addListener(urlChangeListener);
            detachUrlListener = () =>
              chrome.runtime.onMessage.removeListener(urlChangeListener);
          })
          .catch(() => {
            // If tabId resolution fails, FAB is not mounted — the chip already
            // shows 'Tab error' in this case. Silently skip FAB (not a regression
            // from the chip-only Phase 3 baseline).
          });

        // Return teardown object so WXT calls onRemove on invalidation
        return { container };
      },

      onRemove(elements: { container: HTMLElement } | undefined) {
        // Release the isolated-world guard so a later re-enter can mount again
        // (chip-X close, EXIT_REVIEW, and ctx invalidation all route here).
        w.__sfxReviewActive = false;
        // Detach the SPA URL-change listener and disarm pin refresh so neither
        // outlives the UI (a stray URL_CHANGED after exit must not remount pins).
        detachUrlListener?.();
        detachUrlListener = null;
        pinRefresh = null;
        if (elements?.container) {
          teardownChip(elements.container);
          // Also close any open card so card-state stays consistent
          closeCard();
          // Exit pick mode so it never outlives the UI (picker.ts idempotent)
          exitPickMode();
          // Phase 6: tear down pins + remove scroll/resize listeners (T-06-09)
          teardownPins();
          // Phase C: tear down notes panel
          teardownPanel();
        }
      },
    }).catch((err: unknown) => {
      // createShadowRootUi rejected before mount — release the guard so a later
      // injection can retry instead of the flag wedging Review Mode off.
      w.__sfxReviewActive = false;
      throw err;
    });

    // If mounting fails, release the guard so a later injection can retry —
    // otherwise the sticky flag would wedge Review Mode off for this frame
    // until a full page reload (createShadowRootUi/mount throwing is rare but
    // must stay recoverable, matching the pre-flag behavior).
    try {
      ui.mount();
    } catch (err) {
      w.__sfxReviewActive = false;
      throw err;
    }

    // TOP-LAYER PROMOTION: promote the shadow host into the browser top layer via
    // the Popover API so it paints above all normal page content regardless of
    // z-index or DOM order (beats React portals, fixed popovers, dialog elements).
    // popover="manual" — never light-dismisses on outside click or Esc; the overlay
    // stays up for the entire Review Mode session.
    // Graceful fallback: if the Popover API is unsupported (shouldn't happen in
    // Chrome MV3), the try/catch silently preserves the d63862e z-index behavior.
    try {
      const hostEl = ui.shadowHost;
      hostEl.setAttribute('popover', 'manual');
      hostEl.showPopover();
    } catch {
      // Popover API unsupported — falls back to z-index:2147483647 from d63862e
    }

    // Unmount if the content script context is invalidated (e.g., extension reload)
    ctx.onInvalidated(ui.remove);

    // WR-07: listen for EXIT_REVIEW via the extension runtime message channel
    // (SW → content script, same extension world) instead of a page-level
    // CustomEvent that any page script can forge or suppress.
    // The listener is removed automatically when the context is invalidated.
    const exitListener = (msg: { type?: string }) => {
      if (msg?.type === SFX_MSG.EXIT_REVIEW) {
        ui.remove();
      }
    };
    chrome.runtime.onMessage.addListener(exitListener);
    ctx.onInvalidated(() => chrome.runtime.onMessage.removeListener(exitListener));
  },
});
