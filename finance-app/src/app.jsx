import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./utils/App-state.js";
// import { useState } from "react";

import SignupForm from "./Components/SignUp";
import Login from "./Components/login";
import MemberSavingsPage from "./pages/memberSavingsPage";
import MemberDashboardPage from "./pages/memberDashboardpage";
import MemberLoansPage from "./pages/memberloansPage";
import AdminDashboardPage from "./pages/adminDashboardPage";
import OnBoardingSteps from "./pages/onBoardingSteps";
import GroupMembers from "./pages/GroupMembers";
import Payments from "./pages/Payments";
import Settings from "./pages/setting";
import LandingPage from "./pages/LandingPage";
//1.Creating a new context

export default function App() {
  console.log(window.SaccoState.getMembers());
  return (
    //2.Provide a value to the child components

    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/home" element={<LandingPage />} />
        <Route path="/onboarding" element={<OnBoardingSteps />} />
        <Route path="/signup" element={<SignupForm />} />
        <Route path="/login" element={<Login />} />
        <Route path="/intro" element={<LandingPage />} />
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
