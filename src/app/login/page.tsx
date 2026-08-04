"use client";

import React, { Suspense } from "react";
import Login from "../../Components/login";
import Loader from "../../Components/loader";

// .auth-page is what centres the card on the screen. It lives here, on an element that
// unmounts when the member signs in, rather than on `body` -- login.css stays in the
// document after the route change, so a `body` rule would follow them to the dashboard.
export default function Page() {
  return (
    <div className="auth-page">
      <Suspense fallback={<Loader />}>
        <Login />
      </Suspense>
    </div>
  );
}
