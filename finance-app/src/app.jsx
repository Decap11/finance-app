import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import "./utils/App-state.js";
// import { useState } from "react";

import SignupForm from "./pages/SignUp.jsx";
import Login from "./Components/login";
import MemberSavingsPage from "./pages/memberSavingsPage";
import MemberDashboardPage from "./pages/memberDashboardpage";
import MemberLoansPage from "./pages/memberloansPage";
import AdminDashboardPage from "./pages/adminDashboardPage";
import OnBoardingSteps from "./pages/onBoardingSteps";
import RegisterSacco from "./pages/RegisterSacco";
import GroupMembers from "./pages/GroupMembers";
import Payments from "./pages/Payments";
import Settings from "./pages/setting";
import LandingPage from "./pages/LandingPage";
import Loader from "./Components/loader";
import ProtectedRoute from "./Components/ProtectedRoute.jsx";

//1.Creating a new context

export default function App() {
  return (
    //2.Provide a value to the child components

    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/home" element={<LandingPage />} />
        <Route path="/onboarding" element={<OnBoardingSteps />} />
        <Route path="/signup" element={<SignupForm />} />
        <Route path="/register-sacco" element={<RegisterSacco />} />
        <Route path="/login" element={<Login />} />
        <Route path="/intro" element={<LandingPage />} />
        <Route path="/admin" element={<ProtectedRoute><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="/loader" element={<Loader />} />

        <Route path="/savings" element={<ProtectedRoute><MemberSavingsPage /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><MemberDashboardPage /></ProtectedRoute>} />

        <Route path="/loans" element={<ProtectedRoute><MemberLoansPage /></ProtectedRoute>} />
        <Route path="/members" element={<ProtectedRoute><GroupMembers /></ProtectedRoute>} />
        <Route path="/payments" element={<ProtectedRoute><Payments /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
