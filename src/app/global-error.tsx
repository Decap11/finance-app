"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import FailureNotice, { failureActionStyle } from "../Components/FailureNotice";
import { reportClientError } from "../utils/reportClientError";

/**
 * The last boundary: errors thrown by the root layout itself, which error.tsx cannot catch
 * because it sits below the layout it would need to wrap.
 *
 * This file REPLACES the root layout when it renders, which has three consequences the
 * markup below is shaped by:
 *
 *   1. It must supply its own <html> and <body>. Nothing else will.
 *   2. It receives none of the app's global styles, and none of the fonts or the Font Awesome
 *      stylesheet the layout loads -- hence FailureNotice being styled inline and its icon
 *      being a plain character rather than an <i class="fa-...">.
 *   3. `metadata` cannot be exported from a Client Component, so the tab title is set with
 *      React's <title> element instead.
 *
 * Rare by design: reaching here means the failure was in the shell rather than in a screen.
 */
export default function GlobalError({
  error,
  retry
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error in the root layout:", error);
    // Marked 'global' because these are the worst class of failure in the app -- the root
    // layout itself threw, so nothing rendered at all -- and they should be separable from
    // segment errors when reading the log.
    reportClientError(error, "global");
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <title>Something went wrong - PEWOSA SACCO</title>

        <FailureNotice icon="!" title="PEWOSA could not start" reference={error.digest} action={
          <button type="button" onClick={() => retry()} style={failureActionStyle}>
            Try again
          </button>
        }>
          <p style={{ margin: "0 0 1.2rem" }}>
            The app failed to load. This is a fault in the application, not in your account
            &mdash; your savings, contributions and loan records are untouched and complete.
          </p>
          <p style={{ fontSize: "1.3rem", color: "#64748b", margin: 0 }}>
            Try again below. If it keeps failing, tell your SACCO admin and quote the
            reference.
          </p>
        </FailureNotice>
      </body>
    </html>
  );
}
