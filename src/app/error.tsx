"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import FailureNotice, { failureActionStyle } from "../Components/FailureNotice";
import { reportClientError } from "../utils/reportClientError";

/**
 * The boundary for everything below the root layout.
 *
 * Until this file existed there was no error boundary anywhere in the App Router, so any
 * uncaught render error anywhere in the app gave a member a blank screen with their savings
 * behind it, and no way forward but the browser's back button.
 *
 * `retry` re-fetches and re-renders this boundary's children -- the prop is named `retry` in
 * this version of Next, not `reset`; `reset` still exists but only clears the error state
 * without re-fetching, which for a screen whose content comes from Supabase would just
 * re-render the same failure.
 *
 * This does NOT cover the root layout itself. Errors there are caught by global-error.tsx.
 */
export default function ErrorBoundary({
  error,
  retry
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // The console keeps the full object for anyone with DevTools open. reportClientError
    // carries the digest to the server, which is what makes the reference shown below
    // something an operator can actually look up rather than a number the member reads out
    // to nobody.
    console.error("Unhandled render error:", error);
    reportClientError(error, "segment");
  }, [error]);

  return (
    <FailureNotice icon="!" title="Something went wrong" reference={error.digest} action={
      <button type="button" onClick={() => retry()} style={failureActionStyle}>
        Try again
      </button>
    }>
      <p style={{ margin: "0 0 1.2rem" }}>
        This screen could not be displayed. Your savings, contributions and loan records are
        unaffected &mdash; nothing was changed by this.
      </p>
      <p style={{ fontSize: "1.3rem", color: "#64748b", margin: 0 }}>
        If anything you submitted did not go through, it was not recorded, so it is safe to
        try it again. If this keeps happening, tell your SACCO admin and quote the reference
        below.
      </p>
    </FailureNotice>
  );
}
