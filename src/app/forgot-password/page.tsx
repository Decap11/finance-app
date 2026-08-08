"use client";

import React, { Suspense } from "react";
import ForgotPassword from "../../views/ForgotPassword";
import Loader from "../../Components/loader";

/**
 * views/ForgotPassword.jsx has existed for some time with no route pointing at it, so the
 * "Forgot password?" control on the sign-in card led nowhere -- and, being a <button> with
 * no handler, it did not even navigate. A member who forgot their password had no way back
 * into their own account short of asking an admin to look it up, which nobody can do.
 *
 * Same wrapper as /login: .auth-page centres the card and lives here rather than on `body`,
 * because login.css stays in the document after the route changes.
 */
export default function Page() {
  return (
    <div className="auth-page">
      <Suspense fallback={<Loader />}>
        <ForgotPassword />
      </Suspense>
    </div>
  );
}
