"use client";

import AdminRoute from "../../Components/AdminRoute";
import AdminDashboardPage from "../../views/adminDashboardPage";

export default function Page() {
  return (
    <AdminRoute>
      <AdminDashboardPage />
    </AdminRoute>
  );
}
