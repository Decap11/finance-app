"use client";

import ProtectedRoute from "../../Components/ProtectedRoute";
import Payments from "../../views/Payments";

export default function Page() {
  return (
    <ProtectedRoute>
      <Payments />
    </ProtectedRoute>
  );
}
