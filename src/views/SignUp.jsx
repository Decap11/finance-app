"use client";

import "../styles/signUp.css";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignupForm() {
  const [currentStep, setCurrentStep] = useState(1);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [memberId, setMemberId] = useState("");
  const [saccoName, setSaccoName] = useState("");
  const [saccoUniqueNumber, setSaccoUniqueNumber] = useState("");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  function togglePassword(element, fieldId) {
    const inputField = document.getElementById(fieldId);
    if (!inputField) return;
    const isPassword = inputField.type === "password";
    inputField.type = isPassword ? "text" : "password";
    element.classList.toggle("fa-eye");
    element.classList.toggle("fa-eye-slash");
  }

  function handleNextStep(e) {
    e.preventDefault();
    setErrorMsg("");
    if (!fullName.trim()) {
      setErrorMsg("Please enter your full name.");
      return;
    }
    if (!phone.trim()) {
      setErrorMsg("Please enter your phone number.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    setCurrentStep(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!fullName || !phone || !email || !memberId || !saccoName || !saccoUniqueNumber || !password) return;
    if (!termsAccepted) {
      setErrorMsg("You must accept the terms and conditions.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    const formattedMemberId = `MEM-${memberId.trim().toUpperCase()}`;

    // Initialize Supabase Client dynamically
    const { supabase } = await import("../supabaseClient.js");

    // Generate acronym and group code using entered sacco name and unique number
    const generatedAcronym = saccoName.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 8);
    const generatedGroupCode = `${generatedAcronym}-${saccoUniqueNumber.trim().toUpperCase()}`;

    // Verify that the SACCO group code exists in the database
    const { data: saccoRows, error: saccoError } = await supabase
      .from('saccos')
      .select('id, group_code')
      .ilike('group_code', generatedGroupCode)
      .limit(1);

    if (saccoError) {
      setErrorMsg("Error validating Group ID: " + saccoError.message);
      setIsLoading(false);
      return;
    }

    const saccoData = saccoRows && saccoRows.length > 0 ? saccoRows[0] : null;

    if (!saccoData) {
      setErrorMsg("Registration Failed: The SACCO group does not exist. Please check the SACCO Name and Unique Number.");
      setIsLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password: password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          member_number: formattedMemberId,
          group_id: generatedGroupCode,
          status: 'active'
        }
      }
    });

    setIsLoading(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    if (typeof window !== "undefined") {
      localStorage.setItem("rememberedEmail", email.trim());
      localStorage.setItem("rememberedPassword", password);
    }

    // Reset form fields after submission
    setFullName("");
    setPhone("");
    setEmail("");
    setMemberId("");
    setSaccoName("");
    setSaccoUniqueNumber("");
    setPassword("");
    setTermsAccepted(false);

    // Redirect the user to the login page
    router.push("/login");
  }

  return (
    <div className="auth-container">
      <div className="auth-header">
        <Link href="/" className="auth-logo-link">
          <div className="auth-logo-badge">
            <img src="/logo.jpg" alt="Logo" className="auth-logo" />
          </div>
          <h1 className="auth-title">Join SACCO Platform</h1>
        </Link>
        <p className="auth-subtitle">Create an account to track weekly savings and loans</p>
      </div>

      {/* Responsive Step Progress Bar */}
      <div className="step-progress-wrapper">
        <div className="step-progress-bar">
          <div 
            className="step-progress-fill" 
            style={{ width: currentStep === 1 ? "50%" : "100%" }}
          />
        </div>
        <div className="step-indicators">
          <button 
            type="button"
            className={`step-dot-item ${currentStep >= 1 ? "active" : ""}`}
            onClick={() => setCurrentStep(1)}
          >
            <span className="step-dot-num">1</span>
            <span className="step-dot-label">Personal Info</span>
          </button>
          <button 
            type="button"
            className={`step-dot-item ${currentStep === 2 ? "active" : ""}`}
            onClick={() => {
              if (fullName && phone && email) setCurrentStep(2);
            }}
          >
            <span className="step-dot-num">2</span>
            <span className="step-dot-label">SACCO Group</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="auth-error-banner">
          <i className="fa-solid fa-circle-exclamation" style={{ marginRight: "0.8rem" }}></i>
          {errorMsg}
        </div>
      )}

      {currentStep === 1 ? (
        <form className="auth-form" onSubmit={handleNextStep}>
          <div className="form-group">
            <label className="form-label" htmlFor="fullName">Full Name</label>
            <div className="form-input-container">
              <i className="fa-regular fa-user form-icon"></i>
              <input
                type="text"
                id="fullName"
                className="form-input"
                placeholder="e.g. Ssembatya Joseph"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="phone">Phone Number</label>
            <div className="form-input-container">
              <i className="fa-solid fa-phone form-icon"></i>
              <input
                type="tel"
                id="phone"
                className="form-input"
                placeholder="e.g. 0770000000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email Address</label>
            <div className="form-input-container">
              <i className="fa-regular fa-envelope form-icon"></i>
              <input
                type="email"
                id="email"
                className="form-input"
                placeholder="e.g. joseph@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn-submit">
            Continue to SACCO Link <i className="fa-solid fa-arrow-right" style={{ marginLeft: "0.8rem" }}></i>
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="memberId">SACCO Member Number / ID</label>
            <div className="form-input-container">
              <i className="fa-solid fa-id-card form-icon"></i>
              <input
                type="text"
                id="memberId"
                className="form-input"
                placeholder="e.g. 001 or MEM-001"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="saccoName">SACCO Name</label>
            <div className="form-input-container">
              <i className="fa-solid fa-building-columns form-icon"></i>
              <input
                type="text"
                id="saccoName"
                className="form-input"
                placeholder="e.g. Hope Development Sacco"
                value={saccoName}
                onChange={(e) => setSaccoName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="saccoUniqueNumber">SACCO Unique Code</label>
            <div className="form-input-container">
              <i className="fa-solid fa-hashtag form-icon"></i>
              <input
                type="text"
                id="saccoUniqueNumber"
                className="form-input"
                placeholder="e.g. 8134"
                value={saccoUniqueNumber}
                onChange={(e) => setSaccoUniqueNumber(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <div className="form-input-container">
              <i className="fa-solid fa-lock form-icon"></i>
              <input
                type="password"
                id="password"
                className="form-input"
                placeholder="Create a strong password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength="6"
              />
              <i
                className="fa-regular fa-eye pwd-toggle"
                onClick={(e) => togglePassword(e.currentTarget, "password")}
              ></i>
            </div>
          </div>

          <div className="terms-checkbox">
            <input
              type="checkbox"
              id="terms"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              required
            />
            <label htmlFor="terms">
              I agree to the{" "}
              <a href="#" className="auth-link">Terms of Service</a> and{" "}
              <a href="#" className="auth-link">Privacy Policy</a>.
            </label>
          </div>

          <div style={{ display: "flex", gap: "1.2rem", marginTop: "1rem" }}>
            <button 
              type="button" 
              className="btn-back"
              onClick={() => setCurrentStep(1)}
            >
              <i className="fa-solid fa-arrow-left" style={{ marginRight: "0.6rem" }}></i> Back
            </button>

            <button 
              type="submit" 
              className="btn-submit" 
              style={{ flex: 1 }}
              disabled={isLoading}
            >
              {isLoading ? "Creating..." : "Create Account"}{" "}
              {!isLoading && <i className="fa-solid fa-check" style={{ marginLeft: "0.8rem" }}></i>}
            </button>
          </div>
        </form>
      )}

      <div className="auth-footer">
        <div>
          Already have an account?{" "}
          <Link href="/login" className="auth-link">
            Log in here
          </Link>
        </div>
        <div style={{ marginTop: "0.6rem" }}>
          Are you an Administrator?{" "}
          <Link href="/register-sacco" className="auth-link">
            Register your SACCO
          </Link>
        </div>
      </div>
    </div>
  );
}

