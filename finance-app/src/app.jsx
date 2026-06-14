import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import SignupForm from "./Components/SignUp";
import MemberSavingsPage from "./pages/memberSavingsPage";
import MemberDashboardPage from "./pages/memberDashboardpage";
import MemberLoansPage from "./pages/memberloansPage";
import AdminDashboardPage from "./pages/adminDashboardPage";
import OnBoardingSteps from "./pages/onBoardingSteps";
import GroupMembers from "./pages/GroupMembers";
import Payments from "./pages/Payments";
import Settings from "./pages/setting";
import LandingPage from "./pages/LandingPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/home" element={<LandingPage />} />
        <Route path="/onboarding" element={<OnBoardingSteps />} />
        <Route path="/signup" element={<SignupForm />} />
        <Route path="/admin" element={<AdminDashboardPage />} />

        <Route path="/savings" element={<MemberSavingsPage />} />
        <Route path="/dashboard" element={<MemberDashboardPage />} />

        <Route path="/loans" element={<MemberLoansPage />} />
        <Route path="/members" element={<GroupMembers />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/settings" element={<Settings />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
