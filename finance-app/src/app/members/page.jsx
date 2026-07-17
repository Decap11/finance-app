"use client";

import ProtectedRoute from "../../Components/ProtectedRoute";
import GroupMembers from "../../views/GroupMembers";

export default function Page() {
  return (
    <ProtectedRoute>
      <GroupMembers />
    </ProtectedRoute>
  );
}
