"use client";

import ProtectedRoute from "../../Components/ProtectedRoute";
import MemberLoansPage from "../../views/memberloansPage";

export default function Page() {
  return (
    <ProtectedRoute>
      <MemberLoansPage />
    </ProtectedRoute>
  );
}
