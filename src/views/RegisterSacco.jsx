"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../styles/signUp.css"; // Reuse the signup styles

export default function RegisterSacco() {
  // Step management
  const [currentStep, setCurrentStep] = useState(1);

  // Admin Details (Step 1)
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [memberId, setMemberId] = useState("");

  // SACCO Details (Step 2)
  const [saccoName, setSaccoName] = useState("");
  const [saccoUniqueNumber, setSaccoUniqueNumber] = useState("");

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const router = useRouter();

  function togglePassword(element, fieldId) {
    const inputField = document.getElementById(fieldId);
    const isPassword = inputField.type === "password";
    inputField.type = isPassword ? "text" : "password";
    element.classList.toggle("fa-eye");
    element.classList.toggle("fa-eye-slash");
  }

  function handleNextStep(e) {
    e.preventDefault();
    if (!fullName || !phone || !email || !password || !memberId) {
      setErrorMsg("Please fill out all admin fields before proceeding.");
      return;
    }
    if (!termsAccepted) {
      setErrorMsg("You must accept the terms and conditions.");
      return;
    }
    setErrorMsg("");
    setCurrentStep(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!saccoName || !saccoUniqueNumber) {
      setErrorMsg("Please fill out all SACCO details before submitting.");
      return;
    }
    setIsLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/register-sacco", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          phone,
          email,
          password,
          memberId,
          saccoName,
          saccoUniqueNumber,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        let errStr = typeof data.error === "string" ? data.error : (data.error?.message || JSON.stringify(data.error) || "Failed to register SACCO");
        if (errStr === "{}" || !errStr) errStr = "Failed to register SACCO. Please check your network or try again.";
        throw new Error(errStr);
      }
      const { supabase } = await import("../supabaseClient.js");
      const { error: loginErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (loginErr) console.warn("Auto-login after SACCO registration warning:", loginErr.message);
      if (typeof window !== "undefined") {
        localStorage.setItem("rememberedEmail", email.trim());
        localStorage.setItem("rememberedPassword", password);
      }
      setIsLoading(false);
      router.push("/admin?tab=settings");
    } catch (err) {
      setIsLoading(false);
      let displayError = err.message || "An error occurred during registration.";
      if (displayError === "{}" || displayError === "[object Object]") {
        displayError = "Registration failed. Please ensure the SACCO Code is unique and try again.";
      }
      setErrorMsg(displayError);
    }
  }

  return (
    <div className="auth-container" style={{ margin: "2rem auto" }}>
      <div className="auth-header">
        <h1 className="auth-title">Register Your SACCO</h1>
        <p className="auth-subtitle">Create a new SACCO group and become its Administrator.</p>
      </div>

      {errorMsg && (
        <div className="error-message" style={{ color: "red", textAlign: "center", marginBottom: "1rem" }}>{errorMsg}</div>
      )}

      {/* Step Progress Bar */}
      <div className="step-progress-wrapper">
        <div className="step-progress-bar">
          <div className="step-progress-fill" style={{ width: currentStep === 1 ? "50%" : "100%" }}></div>
        </div>
        <div className="step-indicators">
          <button type="button" className={`step-dot-item ${currentStep >= 1 ? "active" : ""}`} onClick={() => setCurrentStep(1)}>
            <span className="step-dot-num">1</span>
            <span className="step-dot-label">Admin Details</span>
          </button>
          <button type="button" className={`step-dot-item ${currentStep === 2 ? "active" : ""}`} onClick={() => setCurrentStep(2)}>
            <span className="step-dot-num">2</span>
            <span className="step-dot-label">SACCO Details</span>
          </button>
        </div>
      </div>

      {currentStep === 1 ? (
        <form className="auth-form" onSubmit={handleNextStep}>
          <h3 style={{ marginBottom: "1rem", color: "var(--text-dark)" }}>Admin Profile Details</h3>
          <div className="form-group">
            <label className="form-label" htmlFor="memberId">Member ID Number</label>
            <div className="form-input-container">
              <i className="fa-solid fa-id-badge form-icon"></i>
              <input type="text" id="memberId" className="form-input" placeholder="e.g. 006" value={memberId} onChange={e => setMemberId(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="fullName">Full Name</label>
            <div className="form-input-container">
              <i className="fa-regular fa-user form-icon"></i>
              <input type="text" id="fullName" className="form-input" placeholder="e.g. Joseph Ssembatya" value={fullName} onChange={e => setFullName(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="email">Email Address</label>
            <div className="form-input-container">
              <i className="fa-regular fa-envelope form-icon"></i>
              <input type="email" id="email" className="form-input" placeholder="admin@sacco.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="phone">Phone Number</label>
            <div className="form-input-container">
              <i className="fa-solid fa-phone form-icon"></i>
              <input type="tel" id="phone" className="form-input" placeholder="+256 700 000000" value={phone} onChange={e => setPhone(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <div className="form-input-container">
              <i className="fa-solid fa-lock form-icon"></i>
              <input type="password" id="password" className="form-input" placeholder="Create a strong password" value={password} onChange={e => setPassword(e.target.value)} required minLength="6" />
              <i className="fa-regular fa-eye pwd-toggle" onClick={e => togglePassword(e.currentTarget, "password")}></i>
            </div>
          </div>
          <div className="terms-checkbox">
            <input type="checkbox" id="terms" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} required />
            <label htmlFor="terms">
              I agree to the <a href="#" className="auth-link">Terms of Service</a> and <a href="#" className="auth-link">Privacy Policy</a>.
            </label>
          </div>
          <button type="submit" className="btn-submit">Continue to SACCO Details <i className="fa-solid fa-arrow-right" style={{ marginLeft: "0.8rem" }}></i></button>
        </form>
      ) : (
        <form id="registerSaccoForm" className="auth-form" onSubmit={handleSubmit}>
          <h3 style={{ marginBottom: "1rem", color: "var(--text-dark)" }}>SACCO Details</h3>
          <div className="form-group">
            <label className="form-label" htmlFor="saccoName">SACCO Name</label>
            <div className="form-input-container">
              <i className="fa-solid fa-building-columns form-icon"></i>
              <input type="text" id="saccoName" className="form-input" placeholder="e.g. Hope Development SACCO" value={saccoName} onChange={e => setSaccoName(e.target.value)} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="saccoUniqueNumber">SACCO Unique Code</label>
            <div className="form-input-container">
              <i className="fa-solid fa-hashtag form-icon"></i>
              <input type="text" id="saccoUniqueNumber" className="form-input" placeholder="e.g. 8134" value={saccoUniqueNumber} onChange={e => setSaccoUniqueNumber(e.target.value)} required />
            </div>
          </div>
          <button type="submit" className="btn-submit" disabled={isLoading}>Register SACCO {isLoading && <i className="fa-solid fa-spinner fa-spin" style={{ marginLeft: "0.5rem" }}></i>}</button>
        </form>
      )}
    </div>
  );
}
