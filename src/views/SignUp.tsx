"use client";

import React, { useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../styles/signUp.css";
import { supabase } from "../supabaseClient";
import { PASSWORD_MIN_LENGTH, checkNewPassword } from "../utils/passwordPolicy";

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
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("orphan") === "1") {
        setErrorMsg("Notice: Please enter your SACCO Name and Unique Code to join or automatically create your group.");
      }
    }
  }, []);

  // togglePassword removed: it read the field with getElementById, mutated input.type
  // behind React's back and hand-toggled Font Awesome classes on the icon element. React
  // never knew the field had changed, and the icon state lived in the DOM rather than in
  // the component. `showPassword` drives both now.

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
    const generatedAcronym = cleanName.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 8) || "SACCO";
    const generatedGroupCode = cleanUniqueNumber.includes('-')
      ? cleanUniqueNumber
      : `${generatedAcronym}-${cleanUniqueNumber}`;

    let targetGroupCode = generatedGroupCode;
    let foundSaccoId: string | null = null;

    // 1. Check if SACCO group already exists.
    //
    // Through an RPC rather than a direct read of public.saccos: this runs before signUp()
    // below, so the caller is still anonymous, and 0035 closed anonymous access to that
    // table -- it was handing out every SACCO's group code, fee schedule and admin id to
    // anyone with the publishable key. lookup_sacco_for_signup returns the three columns
    // this flow actually needs, for one match, and applies the same code-then-name
    // precedence the query here used to.
    try {
      const { data: match } = await supabase
        .rpc('lookup_sacco_for_signup', {
          p_group_code: generatedGroupCode,
          p_unique_number: cleanUniqueNumber,
          p_name: cleanName || null
        })
        .maybeSingle<{ id: string; group_code: string; name: string }>();

      if (match) {
        foundSaccoId = match.id;
        targetGroupCode = match.group_code;
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
          // Log in client session
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

    // Auto-provision membership and accounts for member in database tables
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
              <label className="form-label" htmlFor="saccoName">SACCO name</label>
              <div className="form-input-container">
                <i className="fa-solid fa-building-columns form-icon" aria-hidden="true"></i>
                <input
                  type="text"
                  id="saccoName"
                  name="organization"
                  className="form-input"
                  autoComplete="organization"
                  value={saccoName}
                  onChange={(e) => setSaccoName(e.target.value)}
                  required
                  autoFocus
                  aria-describedby="saccoName-hint"
                />
              </div>
              <span className="form-hint" id="saccoName-hint">
                The name your group is registered under.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="saccoUniqueNumber">
                SACCO unique number
              </label>
              <div className="form-input-container">
                <i className="fa-solid fa-hashtag form-icon" aria-hidden="true"></i>
                <input
                  type="text"
                  id="saccoUniqueNumber"
                  name="saccoUniqueNumber"
                  className="form-input"
                  inputMode="numeric"
                  value={saccoUniqueNumber}
                  onChange={(e) => setSaccoUniqueNumber(e.target.value)}
                  required
                  aria-describedby="saccoUniqueNumber-hint"
                />
              </div>
              <span className="form-hint" id="saccoUniqueNumber-hint">
                The code your administrator gave you. Ask them if you are not sure.
              </span>
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
              <label className="form-label" htmlFor="memberId">Member number</label>
              <div className="form-input-container">
                <i className="fa-solid fa-id-badge form-icon" aria-hidden="true"></i>
                <input
                  type="text"
                  id="memberId"
                  name="memberId"
                  className="form-input"
                  inputMode="numeric"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  required
                  aria-describedby="memberId-hint"
                />
              </div>
              <span className="form-hint" id="memberId-hint">
                Your number in the group register, as your administrator recorded it.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="fullName">Full name</label>
              <div className="form-input-container">
                <i className="fa-regular fa-user form-icon" aria-hidden="true"></i>
                <input
                  type="text"
                  id="fullName"
                  name="name"
                  className="form-input"
                  autoComplete="name"
                  autoCapitalize="words"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="email">Email address</label>
              <div className="form-input-container">
                <i className="fa-regular fa-envelope form-icon" aria-hidden="true"></i>
                <input
                  type="email"
                  id="email"
                  name="email"
                  className="form-input"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  aria-describedby="email-hint"
                />
              </div>
              <span className="form-hint" id="email-hint">
                Used to sign in and to recover your account.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="phone">Phone number</label>
              <div className="form-input-container">
                <i className="fa-solid fa-phone form-icon" aria-hidden="true"></i>
                <input
                  type="tel"
                  id="phone"
                  name="tel"
                  className="form-input"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  aria-describedby="phone-hint"
                />
              </div>
              <span className="form-hint" id="phone-hint">
                Include the country code, for example +256.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <div className="form-input-container">
                <i className="fa-solid fa-lock form-icon" aria-hidden="true"></i>
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="new-password"
                  className="form-input"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  aria-describedby="password-hint"
                />
                <button
                  type="button"
                  className="pwd-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  aria-controls="password"
                >
                  <i
                    className={showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}
                    aria-hidden="true"
                  ></i>
                </button>
              </div>
              {/* The requirement, stated up front rather than sprung as an error after
                  they submit. It was previously only discoverable by failing. */}
              <span className="form-hint" id="password-hint">
                At least {PASSWORD_MIN_LENGTH} characters.
              </span>
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
