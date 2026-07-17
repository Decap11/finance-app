"use client";

import ProtectedRoute from "../../Components/ProtectedRoute";
import Settings from "../../views/setting";

export default function Page() {
  return (
    <ProtectedRoute>
      <Settings />
    </ProtectedRoute>
  );
}
