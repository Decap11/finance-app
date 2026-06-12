import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app.jsx";
// import MemberDashboardPage from "./pages/memberDashboardpage";
// import MemberSavingsPage from "./pages/memberSavingsPage";
// import MemberSharesPage from "./pages/memberSharesPage";
// import SignupForm from "./Components/SignUp";
// import MemberPaymentsPage from "./pages/memberPaymentsPage";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* <SignupForm /> */}
    {/* <MemberDashboardPage /> */}
    {/* <AdminDashboardPage /> */}
    {/* <MemberSavingsPage /> */}
    {/* <MemberSharesPage /> */}
    {/* <MemberLoansPage /> */}
    {/* <MemberPaymentsPage /> */}
    <App />
  </StrictMode>,
);
