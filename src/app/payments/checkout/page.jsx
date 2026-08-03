"use client";

import { Suspense } from "react";
import ProtectedRoute from "../../../Components/ProtectedRoute";
import MemberLayout from "../../../layout/MemberLayout";
import UserHeader from "../../../Components/userHeader";
import SubscriptionCheckout from "../../../Components/SubscriptionCheckout";

// useSearchParams needs a Suspense boundary above it, or the build fails prerendering
// this route.
export default function Page() {
  return (
    <ProtectedRoute>
      <MemberLayout>
        <div className="dashboard-body">
          <UserHeader />
          <Suspense fallback={null}>
            <SubscriptionCheckout />
          </Suspense>
        </div>
      </MemberLayout>
    </ProtectedRoute>
  );
}
