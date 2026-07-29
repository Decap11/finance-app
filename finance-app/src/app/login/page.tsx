"use client";

import React, { Suspense } from "react";
import Login from "../../Components/login";
import Loader from "../../Components/loader";

export default function Page() {
  return (
    <Suspense fallback={<Loader />}>
      <Login />
    </Suspense>
  );
}
