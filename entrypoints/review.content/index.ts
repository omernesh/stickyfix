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

import { mountChip, teardownChip, getTabId } from './chip.js';
import { mountFab } from './fab.js';
import { openCard, closeCard } from './card.js';
import { showToast } from './toast.js';
import { SFX_MSG } from '../../lib/types.js';

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',       // NOT in static manifest — EXT-02
  cssInjectionMode: 'ui',        // WXT injects CSS into the shadow root (A4 check on first build)

  async main(ctx) {
    // createShadowRootUi must be called inside main(ctx) — ctx is not available
    // in a plain scripting.executeScript func injection (WXT Discussion #623)
    const ui = await createShadowRootUi(ctx, {
      name: 'sfx-review-ui',
      position: 'inline',         // 'overlay' is undocumented — use 'inline'
      // z-index 2147483647 is set in :host via styles.css (cssInjectionMode:'ui')
      // WXT does not expose zIndex as an option for createShadowRootUi

      onMount(container: HTMLElement) {
        // Pass the ui.remove function so the chip's Exit button can unmount
        mountChip(container, () => ui.remove());

        // Shared toast adapter — all surfaces (card) use this single function
        // to surface feedback inside the ONE shared shadow-root container (D-01/D-08)
        const toast = (msg: string, isError: boolean) =>
          showToast(container, msg, isError);

        // Resolve tabId once from chip's canonical getTabId (not duplicated here)
        // and mount the FAB. openCard/closeCard share the same container.
        getTabId()
          .then(tabId => {
            // WR-01: wire aria-expanded on the FAB element returned by mountFab.
            // 'false' at construction (set in fab.ts); flip to 'true' when the
            // card opens, back to 'false' when it dismisses.
            const fab = mountFab(container, () => {
              fab.setAttribute('aria-expanded', 'true');
              openCard(container, tabId, () => {
                // onDismiss: card closed (Cancel or Send success) → collapse FAB
                fab.setAttribute('aria-expanded', 'false');
              }, toast);
            });
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
        if (elements?.container) {
          teardownChip(elements.container);
          // Also close any open card so card-state stays consistent
          closeCard();
        }
      },
    });

    ui.mount();

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
