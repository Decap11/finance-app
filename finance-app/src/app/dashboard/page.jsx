"use client";

import ProtectedRoute from "../../Components/ProtectedRoute";
import MemberDashboardPage from "../../views/memberDashboardpage";

export default function Page() {
  return (
    <ProtectedRoute>
      <MemberDashboardPage />
    </ProtectedRoute>
  );
}
