/**
 * Sends a render failure to /api/client-errors.
 *
 * The digest is the reason this exists. An error boundary shows the member a reference and
 * tells them to quote it; without this call nothing carrying that reference ever reaches the
 * server, so the operator is handed a number with nothing to look it up in.
 *
 * sendBeacon rather than fetch, where it exists. A boundary very often renders moments
 * before the member gives up and closes the tab or hits back, and a normal fetch is
 * cancelled when the document goes away -- losing precisely the reports from the failures
 * bad enough to make somebody leave. A beacon is queued by the browser and survives it.
 *
 * Nothing here may throw. This runs inside an error boundary, so an exception raised on the
 * way to reporting an exception is what turns a handled failure into a blank screen.
 */
export function reportClientError(error, boundary) {
  try {
    if (typeof window === 'undefined') return;

    const body = JSON.stringify({
      digest: error?.digest || null,
      boundary,
      message: error?.message || null,
      stack: error?.stack || null,
      path: window.location?.pathname || null
    });

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(
        '/api/client-errors',
        new Blob([body], { type: 'application/json' })
      );
      return;
    }

    // keepalive gives fetch the same survive-the-unload property, for browsers without
    // sendBeacon. The catch is required: a rejected promise here is an unhandled rejection
    // raised from inside an error boundary.
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {});
  } catch {
    // Reporting is best-effort by definition. A failure to report must never be visible.
  }
}
