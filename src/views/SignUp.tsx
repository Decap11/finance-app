"use client";

import React, { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../styles/signUp.css";
import { supabase } from "../supabaseClient";

export default function SignupForm() {
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Form state
  const [saccoName, setSaccoName] = useState<string>("");
  const [saccoUniqueNumber, setSaccoUniqueNumber] = useState<string>("");
  const [memberId, setMemberId] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const router = useRouter();

  function togglePassword(element: HTMLElement, fieldId: string) {
    const inputField = document.getElementById(fieldId) as HTMLInputElement | null;
    if (!inputField) return;
    const isPassword = inputField.type === "password";
    inputField.type = isPassword ? "text" : "password";
    element.classList.toggle("fa-eye");
    element.classList.toggle("fa-eye-slash");
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

    // Derive acronym and fallback group code
    const generatedAcronym = cleanName.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 8);
    const generatedGroupCode = cleanUniqueNumber.includes('-')
      ? cleanUniqueNumber
      : `${generatedAcronym}-${cleanUniqueNumber}`;

    let targetGroupCode = generatedGroupCode;
    let foundSaccoId: string | null = null;

    // Smart Multi-Strategy SACCO Resolution:
    // Strategy 1: Match exact generated group code or unique number ending (e.g. %-8134 or 8134)
    const { data: saccoMatches, error: saccoError } = await supabase
      .from('saccos')
      .select('id, group_code, name')
      .or(`group_code.ilike.${generatedGroupCode},group_code.ilike.%-${cleanUniqueNumber},group_code.ilike.${cleanUniqueNumber}`)
      .limit(5);

    if (saccoError) {
      setErrorMsg("Error validating SACCO group: " + saccoError.message);
      setIsLoading(false);
      return;
    }

    if (saccoMatches && saccoMatches.length > 0) {
      // Find match by name or pick first matched group
      const exactNameMatch = saccoMatches.find(s => s.name.toLowerCase().includes(cleanName.toLowerCase()));
      const matchedSacco = exactNameMatch || saccoMatches[0];
      foundSaccoId = matchedSacco.id;
      targetGroupCode = matchedSacco.group_code;
    } else if (cleanName) {
      // Strategy 2: Search by SACCO Name substring
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

    if (!targetGroupCode || !foundSaccoId) {
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
          group_id: targetGroupCode,
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
        <h1 className="auth-title">Create Member Account</h1>
        <p className="auth-subtitle">
          Join your SACCO group and take control of your financial future.
        </p>
      </div>

      {/* Step Progress Bar & Indicators */}
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
                  placeholder="e.g. Kisenyi Youth Sacco"
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
                  placeholder="e.g. 2200 or NS-2200"
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
                {isLoading ? "Creating..." : "Create Account"}
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
