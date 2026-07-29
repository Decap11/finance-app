"use client";

import React, { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../styles/registerSacco.css";
import { supabase } from "../supabaseClient";

export default function RegisterSacco() {
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Form fields
  const [saccoName, setSaccoName] = useState<string>("");
  const [saccoUniqueNumber, setSaccoUniqueNumber] = useState<string>("");
  const [memberId, setMemberId] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const router = useRouter();

  // Dynamic preview values
  const generatedAcronym = saccoName.trim()
    ? saccoName.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 8)
    : "SACCO";
  const generatedGroupCode = saccoUniqueNumber.trim()
    ? `${generatedAcronym}-${saccoUniqueNumber.trim().toUpperCase()}`
    : `${generatedAcronym}-XXXX`;
  const adminMemberNumber = memberId.trim()
    ? `MEM-${memberId.trim().toUpperCase()}`
    : "MEM-XXX";

  function togglePassword(element: HTMLElement, fieldId: string) {
    const inputField = document.getElementById(fieldId) as HTMLInputElement | null;
    if (!inputField) return;
    const isPassword = inputField.type === "password";
    inputField.type = isPassword ? "text" : "password";
    element.classList.toggle("fa-eye");
    element.classList.toggle("fa-eye-slash");
  }

  function formatError(err: any): string {
    if (!err) return "An unexpected error occurred.";
    console.error("RegisterSacco Error:", err);
    if (err.name === "AuthRetryableFetchError" || err.status === 500) {
      return "Supabase Auth Trigger Exception (500): The database trigger on auth.users experienced an unhandled error. Please execute supabase-patch-trigger.sql in your Supabase SQL Editor.";
    }
    if (typeof err === "string" && err.trim() !== "" && err !== "{}") return err;
    if (err.message && typeof err.message === "string" && err.message.trim() !== "" && err.message !== "{}") {
      return err.message;
    }
    if (err.details && typeof err.details === "string" && err.details.trim() !== "") return err.details;
    if (err.hint && typeof err.hint === "string" && err.hint.trim() !== "") return err.hint;
    if (err.error_description && typeof err.error_description === "string") return err.error_description;
    if (err.code && typeof err.code === "string") return `Database Error Code: ${err.code}`;

    const str = JSON.stringify(err);
    if (str && str !== "{}" && str !== "null") return str;
    return "Unable to connect to Supabase backend. Please check your internet connection or Vercel Environment Variables.";
  }

  function handleNextStep(e?: React.MouseEvent) {
    if (e) e.preventDefault();
    if (!saccoName.trim() || !saccoUniqueNumber.trim()) {
      setErrorMsg("Please enter both the SACCO Name and Unique Code before proceeding.");
      return;
    }
    setErrorMsg("");
    setCurrentStep(2);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handlePrevStep(e: React.MouseEvent) {
    e.preventDefault();
    setErrorMsg("");
    setCurrentStep(1);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (currentStep === 1) {
      handleNextStep();
      return;
    }

    if (!fullName || !phone || !email || !password || !memberId || !saccoName || !saccoUniqueNumber) {
      setErrorMsg("Please fill out all required fields.");
      return;
    }
    if (!termsAccepted) {
      setErrorMsg("You must accept the terms and conditions.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    const fullGroupCode = `${generatedAcronym}-${saccoUniqueNumber.trim().toUpperCase()}`;
    const fullAdminMemberNumber = `MEM-${memberId.trim().toUpperCase()}`;

    // 1. Sign up the admin user via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password: password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          member_number: fullAdminMemberNumber,
          group_id: fullGroupCode,
          role: 'admin',
          status: 'active',
        }
      }
    });

    if (authError) {
      const rawMsg = formatError(authError);
      let friendlyMsg = rawMsg;
      if (rawMsg.toLowerCase().includes("already registered")) {
        friendlyMsg = "This email is already registered. Please log in or use a different email.";
      } else if (rawMsg.toLowerCase().includes("password")) {
        friendlyMsg = "Password must be at least 8 characters long.";
      } else if (rawMsg.toLowerCase().includes("invalid email")) {
        friendlyMsg = "Please enter a valid email address.";
      }
      setErrorMsg(friendlyMsg);
      setIsLoading(false);
      return;
    }

    if (!authData?.user) {
      setErrorMsg("Signup completed but failed to retrieve user session details. Please try again.");
      setIsLoading(false);
      return;
    }

    // 2. Call the RPC to create the SACCO and link the admin atomically
    const { error: rpcError } = await supabase.rpc('register_new_sacco', {
      p_sacco_name: saccoName.trim(),
      p_acronym: generatedAcronym,
      p_group_code: fullGroupCode,
      p_admin_profile_id: authData.user.id
    });

    setIsLoading(false);

    if (rpcError) {
      const rawMsg = formatError(rpcError);
      let friendlyMsg = rawMsg;
      if (rawMsg.includes("already exists")) {
        friendlyMsg = "A SACCO with this unique number already exists. Please choose a different unique code.";
      } else if (rawMsg.includes("profile not found")) {
        friendlyMsg = "Your account was created but SACCO setup took too long. Please log in and try registering your SACCO again.";
      }
      setErrorMsg("SACCO Registration Failed: " + friendlyMsg);
      return;
    }

    if (typeof window !== "undefined") {
      localStorage.setItem("rememberedEmail", email.trim());
    }

    if (!authData.session) {
      router.push(`/login?registered=1&email=${encodeURIComponent(email.trim())}`);
      return;
    }

    router.push("/admin");
  }

  return (
    <div className="auth-container" style={{ margin: "2rem auto" }}>
      <div className="auth-header">
        <h1 className="auth-title">Register Your SACCO</h1>
        <p className="auth-subtitle">
          Create a new SACCO group and become its Administrator.
        </p>
      </div>

      {/* Stepper Navigation */}
      <div className="sacco-stepper">
        <div 
          className="sacco-stepper-progress" 
          style={{ width: currentStep === 1 ? "0%" : "100%" }}
        ></div>

        <button 
          type="button" 
          className={`sacco-step-item ${currentStep === 1 ? "active" : "completed"}`}
          onClick={() => setCurrentStep(1)}
        >
          <div className="sacco-step-num">
            {currentStep > 1 ? <i className="fa-solid fa-check"></i> : "1"}
          </div>
          <span className="sacco-step-label">SACCO Details</span>
        </button>

        <button 
          type="button" 
          className={`sacco-step-item ${currentStep === 2 ? "active" : ""}`}
          onClick={() => {
            if (saccoName.trim() && saccoUniqueNumber.trim()) {
              setCurrentStep(2);
              setErrorMsg("");
            } else {
              setErrorMsg("Please complete SACCO Details first.");
            }
          }}
        >
          <div className="sacco-step-num">2</div>
          <span className="sacco-step-label">Admin Profile</span>
        </button>
      </div>

      {/* Clean SACCO Identity Preview Box */}
      <div className="sacco-preview-card">
        <div className="sacco-preview-header">
          <span className="sacco-preview-title">
            <i className="fa-solid fa-id-badge"></i> SACCO Identity Preview
          </span>
          <span className="sacco-preview-acronym">{generatedAcronym}</span>
        </div>
        <div className="sacco-preview-grid">
          <div className="sacco-preview-item">
            <span className="sacco-preview-label">Group Code</span>
            <span className="sacco-preview-value">{generatedGroupCode}</span>
          </div>
          <div className="sacco-preview-item">
            <span className="sacco-preview-label">Admin Member ID</span>
            <span className="sacco-preview-value">{adminMemberNumber}</span>
          </div>
        </div>
      </div>

      {errorMsg && <div className="error-message">{errorMsg}</div>}

      <form id="registerSaccoForm" onSubmit={handleSubmit}>
        {currentStep === 1 ? (
          <div className="sacco-form-section">
            <h3 className="sacco-section-heading">
              <i className="fa-solid fa-building-columns"></i> SACCO Details
            </h3>

            <div className="form-group">
              <label className="form-label">SACCO Name</label>
              <div className="form-input-container">
                <i className="fa-solid fa-building-columns form-icon"></i>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Hope Development SACCO"
                  value={saccoName}
                  onChange={(e) => setSaccoName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">SACCO Unique Number / Code</label>
              <div className="form-input-container">
                <i className="fa-solid fa-hashtag form-icon"></i>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 8134"
                  value={saccoUniqueNumber}
                  onChange={(e) => setSaccoUniqueNumber(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="sacco-button-group">
              <button 
                type="button" 
                className="btn-submit" 
                onClick={handleNextStep}
              >
                <span>Continue to Admin Details</span>
                <i className="fa-solid fa-arrow-right"></i>
              </button>
            </div>
          </div>
        ) : (
          <div className="sacco-form-section">
            <h3 className="sacco-section-heading">
              <i className="fa-solid fa-user-gear"></i> Admin Profile Details
            </h3>

            <div className="form-group">
              <label className="form-label">Member ID Number</label>
              <div className="form-input-container">
                <i className="fa-solid fa-id-badge form-icon"></i>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 006"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Full Name</label>
              <div className="form-input-container">
                <i className="fa-regular fa-user form-icon"></i>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Joseph Ssembatya"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <div className="form-input-container">
                <i className="fa-regular fa-envelope form-icon"></i>
                <input
                  type="email"
                  className="form-input"
                  placeholder="admin@sacco.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <div className="form-input-container">
                <i className="fa-solid fa-phone form-icon"></i>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="+256 700 000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
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
                  minLength={8}
                />
                <i
                  className="fa-regular fa-eye pwd-toggle"
                  onClick={(e) => togglePassword(e.currentTarget as HTMLElement, "password")}
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
                <a href="#" className="auth-link">Terms of Service</a>{" "}
                and{" "}
                <a href="#" className="auth-link">Privacy Policy</a>.
              </label>
            </div>

            <div className="sacco-button-group">
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={handlePrevStep}
              >
                <i className="fa-solid fa-arrow-left"></i>
                <span>Back</span>
              </button>
              
              <button 
                type="submit" 
                className="btn-submit" 
                disabled={isLoading}
              >
                <span>{isLoading ? "Registering..." : "Register SACCO"}</span>
                {!isLoading && <i className="fa-solid fa-arrow-right"></i>}
              </button>
            </div>
          </div>
        )}
      </form>

      <div className="auth-footer">
        Are you just a member?{" "}
        <Link href="/signup" className="auth-link">
          Join an existing SACCO
        </Link>
      </div>
    </div>
  );
}
