"use client";

import React from "react";
import SignupForm from "../../views/SignUp";

// .auth-page is what centres the card on the screen. It lives here, on an element that
// unmounts when the member leaves, rather than on `body` -- signUp.css outlives this route
// in the document, so a `body` rule would follow them onto the dashboard.
export default function Page() {
  return (
    <div className="auth-page">
      <SignupForm />
    </div>
  );
}
