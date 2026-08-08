"use client";

import React, { Suspense } from "react";
import ResetPassword from "../../views/ResetPassword";
import Loader from "../../Components/loader";

/**
 * The other half of the reset flow, and the reason it had to be added alongside
 * /forgot-password rather than after it.
 *
 * ForgotPassword calls supabase.auth.resetPasswordForEmail with
 * `redirectTo: ${origin}/reset-password`. That is the link Supabase puts in the member's
 * email. With no route here, following it landed on a 404 -- so even if someone had
 * reached the request form, the email it sent led nowhere. Both halves are needed for
 * either to be worth anything.
 */
export default function Page() {
  return (
    <div className="auth-page">
      <Suspense fallback={<Loader />}>
        <ResetPassword />
      </Suspense>
    </div>
  );
}
