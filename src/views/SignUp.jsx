"use client";

import React, { useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../styles/signUp.css";
import { supabase } from "../supabaseClient";

export default function SignupForm() {
  const [currentStep, setCurrentStep] = useState(1);

  // Form state
  const [saccoName, setSaccoName] = useState("");
  const [saccoUniqueNumber, setSaccoUniqueNumber] = useState("");
  const [memberId, setMemberId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("orphan") === "1") {
        setErrorMsg("Notice: Please enter your SACCO Name and Unique Code to join or automatically create your group.");
      }
    }
  }, []);

  function togglePassword(element, fieldId) {
    const inputField = document.getElementById(fieldId);
    if (!inputField) return;
    const isPassword = inputField.type === "password";
    inputField.type = isPassword ? "text" : "password";
    element.classList.toggle("fa-eye");
    element.classList.toggle("fa-eye-slash");
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

    if (!fullName || !phone || !email || !memberId || !saccoName || !saccoUniqueNumber || !password) {
      setErrorMsg("Please fill out all required fields.");
      return;
    }
    if (!termsAccepted) {
      setErrorMsg("You must accept the terms and conditions.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    const formattedMemberId = `MEM-${memberId.trim().toUpperCase()}`;
    const cleanName = saccoName.trim();
    const cleanUniqueNumber = saccoUniqueNumber.trim().toUpperCase();

    const generatedAcronym = cleanName.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 8) || "SACCO";
    const generatedGroupCode = cleanUniqueNumber.includes('-')
      ? cleanUniqueNumber
      : `${generatedAcronym}-${cleanUniqueNumber}`;

    let targetGroupCode = generatedGroupCode;
    let foundSaccoId = null;

    // 1. Check if SACCO group already exists in public.saccos
    try {
      const { data: saccoMatches } = await supabase
        .from('saccos')
        .select('id, group_code, name')
        .or(`group_code.ilike.${generatedGroupCode},group_code.ilike.%-${cleanUniqueNumber},group_code.ilike.${cleanUniqueNumber}`)
        .limit(5);

      if (saccoMatches && saccoMatches.length > 0) {
        const exactNameMatch = saccoMatches.find(s => s.name.toLowerCase().includes(cleanName.toLowerCase()));
        const matchedSacco = exactNameMatch || saccoMatches[0];
        foundSaccoId = matchedSacco.id;
        targetGroupCode = matchedSacco.group_code;
      } else if (cleanName) {
        const { data: nameMatch } = await supabase
          .from('saccos')
          .select('id, group_code, name')
          .ilike('name', `%${cleanName}%`)
          .limit(1)
          .maybeSingle();

        if (nameMatch) {
          foundSaccoId = nameMatch.id;
          targetGroupCode = nameMatch.group_code;
        }
      }
    } catch (sErr) {
      console.warn("SACCO lookup notice:", sErr);
    }

    // 2. Auto-Creation Strategy: If SACCO group does NOT exist yet, AUTO-CREATE IT seamlessly!
    if (!foundSaccoId) {
      try {
        const res = await fetch("/api/register-sacco", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password: password,
            fullName: fullName.trim(),
            phone: phone.trim(),
            memberId: memberId.trim(),
            saccoName: cleanName,
            saccoUniqueNumber: cleanUniqueNumber
          })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password: password
          });

          setIsLoading(false);
          if (typeof window !== "undefined") {
            localStorage.setItem("rememberedEmail", email.trim());
          }
          router.push("/admin?tab=settings&onboarding=1");
          return;
        }
      } catch (autoErr) {
        console.warn("Auto-creation API fallback notice:", autoErr);
      }
    }

    // 3. Joining an Existing SACCO as a Regular Member
    const { data: authData, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          member_number: formattedMemberId,
          group_id: targetGroupCode,
          role: 'member',
          status: 'active'
        }
      }
    });

    if (error) {
      if (error.message?.toLowerCase().includes("already registered")) {
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password
        });

        if (!signInErr && signInData?.user) {
          setIsLoading(false);
          router.push("/dashboard");
          return;
        }
        setErrorMsg("This email is already registered. Please log in or use a different password.");
      } else {
        setErrorMsg(error.message);
      }
      setIsLoading(false);
      return;
    }

    if (authData?.user?.id && foundSaccoId) {
      try {
        await supabase.from('profiles').upsert({
          id: authData.user.id,
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          member_number: formattedMemberId,
          group_id: targetGroupCode,
          role: 'member',
          status: 'active'
        }, { onConflict: 'id' });

        await supabase.from('sacco_memberships').upsert({
          sacco_id: foundSaccoId,
          profile_id: authData.user.id,
          role: 'member',
          status: 'active'
        }, { onConflict: 'sacco_id, profile_id' });

        await supabase.from('accounts').upsert([
          { sacco_id: foundSaccoId, profile_id: authData.user.id, account_type: 'savings', balance: 0.00, status: 'active' },
          { sacco_id: foundSaccoId, profile_id: authData.user.id, account_type: 'shares', balance: 0.00, status: 'active' },
          { sacco_id: foundSaccoId, profile_id: authData.user.id, account_type: 'development_fund', balance: 0.00, status: 'active' },
          { sacco_id: foundSaccoId, profile_id: authData.user.id, account_type: 'social_fund', balance: 0.00, status: 'active' },
          { sacco_id: foundSaccoId, profile_id: authData.user.id, account_type: 'loan', balance: 0.00, status: 'active' }
        ], { onConflict: 'sacco_id, profile_id, account_type' });
      } catch (mErr) {
        console.warn("Member account auto-provisioning notice:", mErr);
      }
    }

    setIsLoading(false);

    if (typeof window !== "undefined") {
      localStorage.setItem("rememberedEmail", email.trim());
    }

    setFullName("");
    setPhone("");
    setEmail("");
    setMemberId("");
    setSaccoName("");
    setSaccoUniqueNumber("");
    setPassword("");
    setTermsAccepted(false);

    router.push("/login?registered=1");
  }

  return (
    <div className="auth-container">
      <div className="auth-header">
        <Link href="/" className="auth-logo-link">
          <div className="auth-logo-badge">
            <img
              src="/images/sacco logo.png"
              alt="SACCO Logo"
              className="auth-logo"
            />
          </div>
        </Link>
        <h1 className="auth-title">Create Account / Join SACCO</h1>
        <p className="auth-subtitle">
          Join an existing SACCO group or instantly set up your new cooperative workspace.
        </p>
      </div>

      <div className="step-progress-wrapper">
        <div className="step-progress-bar">
          <div
            className="step-progress-fill"
            style={{ width: currentStep === 1 ? "50%" : "100%" }}
          ></div>
        </div>
        <div className="step-indicators">
          <button
            type="button"
            className={`step-dot-item ${currentStep === 1 ? "active" : ""}`}
            onClick={() => setCurrentStep(1)}
          >
            <div className="step-dot-num">1</div>
            <span className="step-dot-label">SACCO Info</span>
          </button>
          <button
            type="button"
            className={`step-dot-item ${currentStep === 2 ? "active" : ""}`}
            onClick={() => {
              if (saccoName.trim() && saccoUniqueNumber.trim()) {
                setCurrentStep(2);
                setErrorMsg("");
              } else {
                setErrorMsg("Please complete SACCO Info first.");
              }
            }}
          >
            <div className="step-dot-num">2</div>
            <span className="step-dot-label">Member Details</span>
          </button>
        </div>
      </div>

      {errorMsg && <div className="auth-error-banner">{errorMsg}</div>}

      <form id="signupForm" className="auth-form" onSubmit={handleSubmit}>
        {currentStep === 1 ? (
          <div>
            <div className="form-group">
              <label className="form-label">SACCO Name</label>
              <div className="form-input-container">
                <i className="fa-solid fa-building-columns form-icon"></i>
                <input
                  type="text"
                  id="saccoName"
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
                  id="saccoUniqueNumber"
                  className="form-input"
                  placeholder="e.g. 8134"
                  value={saccoUniqueNumber}
                  onChange={(e) => setSaccoUniqueNumber(e.target.value)}
                  required
                />
              </div>
            </div>

            <button
              type="button"
              className="btn-submit"
              onClick={handleNextStep}
            >
              <span>Continue to Member Details</span>
              <i className="fa-solid fa-arrow-right" style={{ marginLeft: "0.8rem" }}></i>
            </button>
          </div>
        ) : (
          <div>
            <div className="form-group">
              <label className="form-label">Member ID Number</label>
              <div className="form-input-container">
                <i className="fa-solid fa-id-badge form-icon"></i>
                <input
                  type="text"
                  id="memberId"
                  className="form-input"
                  placeholder="e.g. 0042"
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
                  id="fullName"
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
                  id="email"
                  className="form-input"
                  placeholder="e.g. member@email.com"
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
                  id="phone"
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
                <a href="#" className="auth-link">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="#" className="auth-link">
                  Privacy Policy
                </a>
                .
              </label>
            </div>

            <div style={{ display: "flex", gap: "1.2rem" }}>
              <button
                type="button"
                className="btn-back"
                onClick={handlePrevStep}
              >
                <i className="fa-solid fa-arrow-left" style={{ marginRight: "0.6rem" }}></i>
                Back
              </button>
              <button
                type="submit"
                className="btn-submit"
                id="submitBtn"
                disabled={isLoading}
              >
                {isLoading ? "Creating Account..." : "Create Account"}
                {!isLoading && (
                  <i
                    className="fa-solid fa-arrow-right"
                    style={{ marginLeft: "0.8rem" }}
                  ></i>
                )}
              </button>
            </div>
          </div>
        )}
      </form>

      <div className="auth-footer">
        <div>
          Already have an account?{" "}
          <Link href="/login" className="auth-link">
            Log in here
          </Link>
        </div>
        <div>
          Are you an Administrator?{" "}
          <Link href="/register-sacco" className="auth-link">
            Register your SACCO
          </Link>
        </div>
      </div>
    </div>
  );
}
