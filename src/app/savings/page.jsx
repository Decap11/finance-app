"use client";

import ProtectedRoute from "../../Components/ProtectedRoute";
import MemberSavingsPage from "../../views/memberSavingsPage";

export default function Page() {
  return (
    <ProtectedRoute>
      <MemberSavingsPage />
    </ProtectedRoute>
  );
}
