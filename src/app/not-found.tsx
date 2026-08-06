import type { Metadata } from "next";
import Link from "next/link";
import FailureNotice, { failureActionStyle } from "../Components/FailureNotice";

export const metadata: Metadata = {
  title: "Page not found - PEWOSA SACCO"
};

/**
 * A URL that matches no route, and any segment that calls notFound().
 *
 * Renders inside the root layout, so unlike global-error.tsx this one does get the app's
 * global styles -- FailureNotice is still inline-styled because it is shared with the two
 * boundaries that do not.
 *
 * Sends the member to /dashboard rather than /: a signed-in member landing on the marketing
 * page after a mistyped URL looks like having been signed out, which for a savings app is a
 * more alarming thing to see than the 404 itself.
 */
export default function NotFound() {
  return (
    <FailureNotice icon="?" title="Page not found" action={
      <Link href="/dashboard" style={failureActionStyle}>
        Go to my dashboard
      </Link>
    }>
      <p style={{ margin: 0 }}>
        There is nothing at this address. The link may be out of date, or the page may have
        moved. Your account and records are unaffected.
      </p>
    </FailureNotice>
  );
}
