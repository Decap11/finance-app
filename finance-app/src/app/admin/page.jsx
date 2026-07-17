"use client";

import ProtectedRoute from "../../Components/ProtectedRoute";
import AdminDashboardPage from "../../views/adminDashboardPage";

export default function Page() {
  return (
    <ProtectedRoute>
      <AdminDashboardPage />
    </ProtectedRoute>
  );
}
