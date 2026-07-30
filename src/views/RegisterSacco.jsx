"use client";

import React, { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../styles/registerSacco.css";
import { supabase } from "../supabaseClient";

export default function RegisterSacco() {
  const [currentStep, setCurrentStep] = useState(1);

  // Form fields
  const [saccoName, setSaccoName] = useState("");
  const [saccoUniqueNumber, setSaccoUniqueNumber] = useState("");
  const [memberId, setMemberId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
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

  function togglePassword(element, fieldId) {
    const inputField = document.getElementById(fieldId);
    if (!inputField) return;
    const isPassword = inputField.type === "password";
    inputField.type = isPassword ? "text" : "password";
    element.classList.toggle("fa-eye");
    element.classList.toggle("fa-eye-slash");
  }

  function formatError(err) {
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

  function handleNextStep(e) {
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

  function handlePrevStep(e) {
    e.preventDefault();
    setErrorMsg("");
    setCurrentStep(1);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleSubmit(e) {
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

    // 1. Primary Strategy: Server API call with admin privileges to guarantee DB writes
    try {
      const apiRes = await fetch("/api/register-sacco", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
          fullName: fullName.trim(),
          phone: phone.trim(),
          memberId: memberId.trim(),
          saccoName: saccoName.trim(),
          saccoUniqueNumber: saccoUniqueNumber.trim()
        })
      });

      const apiData = await apiRes.json();

      if (apiRes.ok && apiData.success) {
        const { error: loginErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password
        });

        setIsLoading(false);

        if (typeof window !== "undefined") {
          localStorage.setItem("rememberedEmail", email.trim());
        }

        if (loginErr) {
          router.push(`/login?registered=1&onboarding=1&email=${encodeURIComponent(email.trim())}`);
          return;
        }

        router.push("/admin?tab=settings&onboarding=1");
        return;
      }
    } catch (apiErr) {
      console.warn("Server API SACCO registration fallback notice:", apiErr);
    }

    // 2. Secondary Strategy: Client-side Supabase Auth + RPC Fallback
    let adminUserId = null;
    let hasSession = false;

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password: password,
      options: {
        data: {
          full_name: fullName.trim(),
          sacco_name: saccoName.trim(),
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
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });

        if (!signInError && signInData?.user) {
          adminUserId = signInData.user.id;
          hasSession = true;
        } else {
          friendlyMsg = "This email is already registered. Please log in or use a different email.";
          setErrorMsg(friendlyMsg);
          setIsLoading(false);
          return;
        }
      } else {
        if (rawMsg.toLowerCase().includes("password")) {
          friendlyMsg = "Password must be at least 8 characters long.";
        } else if (rawMsg.toLowerCase().includes("invalid email")) {
          friendlyMsg = "Please enter a valid email address.";
        }
        setErrorMsg(friendlyMsg);
        setIsLoading(false);
        return;
      }
    } else {
      adminUserId = authData?.user?.id || null;
      hasSession = Boolean(authData?.session);
    }

    if (!adminUserId) {
      setErrorMsg("Signup completed but failed to retrieve user session details. Please try again.");
      setIsLoading(false);
      return;
    }

    try {
      await supabase.from("profiles").upsert({
        id: adminUserId,
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        member_number: fullAdminMemberNumber,
        group_id: fullGroupCode,
        role: "admin",
        status: "active"
      }, { onConflict: "id" });
    } catch (pErr) {
      console.warn("Profile pre-upsert notice:", pErr);
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('register_new_sacco', {
      p_sacco_name: saccoName.trim(),
      p_acronym: generatedAcronym,
      p_group_code: fullGroupCode,
      p_admin_profile_id: adminUserId
    });

    try {
      const saccoId = rpcData?.sacco_id;
      if (saccoId) {
        await supabase.from("sacco_memberships").upsert({
          sacco_id: saccoId,
          profile_id: adminUserId,
          role: "admin",
          status: "active"
        }, { onConflict: "sacco_id, profile_id" });
      }
    } catch (mErr) {
      console.warn("Sacco membership upsert notice:", mErr);
    }

    setIsLoading(false);

    if (rpcError) {
      const rawMsg = formatError(rpcError);
      let friendlyMsg = rawMsg;
      if (rawMsg.includes("already exists")) {
        friendlyMsg = "A SACCO with this unique number already exists. Please choose a different unique code.";
      }
      setErrorMsg("SACCO Registration Failed: " + friendlyMsg);
      return;
    }

    if (typeof window !== "undefined") {
      localStorage.setItem("rememberedEmail", email.trim());
    }

    if (!hasSession) {
      router.push(`/login?registered=1&onboarding=1&email=${encodeURIComponent(email.trim())}`);
      return;
    }

    router.push("/admin?tab=settings&onboarding=1");
  }

  return (
    <div className="auth-container" style={{ margin: "2rem auto" }}>
      <div className="auth-header">
        <h1 className="auth-title">Register Your SACCO</h1>
        <p className="auth-subtitle">
          Create a new SACCO group and become its Administrator.
        </p>
      </div>

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
