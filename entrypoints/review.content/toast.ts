/**
 * stickyfix toast surface — shadow-root UI
 *
 * Shows transient (success) or persistent (error) feedback after a Send.
 * Never silent — every Send result surfaces a toast (REL-01 / FREE-04).
 *
 * Security invariants:
 *  - ALL host-derived strings (resp.file, resp.error) go into textContent only
 *    — NEVER innerHTML (INVARIANT C / T-04-03)
 *  - sfx-* namespace (INVARIANT D)
 *  - Error dismiss uses .onclick = (idempotent, no listener stacking — Shared Pattern 4)
 */

/**
 * Show a toast notification inside the shadow-root container.
 *
 * Success: role="status", aria-live="polite", auto-dismiss after 3000ms via opacity fade.
 * Error: role="alert", aria-live="assertive", persists until × is clicked.
 *
 * @param container  The shadow-root container from createShadowRootUi onMount
 * @param msg        Message text (truncated to 200 chars; goes into textContent only)
 * @param isError    true → error style + persistent; false → success + auto-dismiss
 */
export function showToast(container: HTMLElement, msg: string, isError: boolean): void {
  // Build toast via createElement/textContent — INVARIANT C
  const toast = document.createElement('div');
  toast.className = isError ? 'sfx-toast sfx-toast-error' : 'sfx-toast';
  toast.setAttribute('role', isError ? 'alert' : 'status');
  toast.setAttribute('aria-live', isError ? 'assertive' : 'polite');

  // Stripe — color-coded left border (success #16a34a / error #dc2626 via CSS)
  const stripe = document.createElement('div');
  stripe.className = 'sfx-toast-stripe';
  toast.appendChild(stripe);

  // Body: icon + message
  const body = document.createElement('div');
  body.className = 'sfx-toast-body';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'sfx-toast-icon';
  iconSpan.textContent = isError ? '✕' : '✓';
  body.appendChild(iconSpan);

  const msgSpan = document.createElement('span');
  msgSpan.className = 'sfx-toast-msg';
  // Truncate + textContent only — T-04-03 (resp.file / resp.error are host-derived)
  msgSpan.textContent = msg.slice(0, 200);
  body.appendChild(msgSpan);

  toast.appendChild(body);

  // Dismiss button — error toasts only; .onclick = (idempotent — Shared Pattern 4)
  if (isError) {
    const dismiss = document.createElement('button');
    dismiss.className = 'sfx-toast-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss error');
    dismiss.textContent = '×';
    // .onclick assignment — not addEventListener — prevents listener stacking
    // on any potential re-wire; also matches D-09 pattern for idempotency
    dismiss.onclick = () => toast.remove();
    toast.appendChild(dismiss);
  }

  container.appendChild(toast);

  // Success auto-dismiss after 3000ms via opacity transition then remove
  if (!isError) {
    setTimeout(() => {
      toast.style.opacity = '0';
      // Remove after CSS transition completes (200ms declared in styles.css)
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  }
}
