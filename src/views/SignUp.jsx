"use client";

import "../styles/signUp.css";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignupForm() {
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
    const isPassword = inputField.type === "password";
    inputField.type = isPassword ? "text" : "password";
    element.classList.toggle("fa-eye");
    element.classList.toggle("fa-eye-slash");
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

    // Initialize Supabase Client dynamically so it doesn't break if not set yet
    const { supabase } = await import("../supabaseClient.js");

    // Generate acronym and group code using entered sacco name and unique number
    const generatedAcronym = saccoName.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 8);
    const generatedGroupCode = `${generatedAcronym}-${saccoUniqueNumber.trim().toUpperCase()}`;

    // Verify that the SACCO group code exists in the database
    const { data: saccoData, error: saccoError } = await supabase
      .from('saccos')
      .select('id')
      .eq('group_code', generatedGroupCode)
      .limit(1)
      .maybeSingle();

    if (saccoError) {
      setErrorMsg("Error validating Group ID: " + saccoError.message);
      setIsLoading(false);
      return;
    }

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

    // Redirect the user to the login page or members page
    router.push("/login");
  }

  async function handleGoogleSignUp() {
    setIsLoading(true);
    setErrorMsg("");
    try {
      const { supabase } = await import("../supabaseClient.js");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) throw error;
    } catch (err) {
      setErrorMsg(err.message || "Failed to connect to Google authentication.");
      setIsLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-header">
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <img src="/logo.jpg" alt="Logo" className="auth-logo" />
          <h1 className="auth-title">Join SACCO Management Platform</h1>
        </Link>
        <p className="auth-subtitle">Create an account to track your weekly savings and loans</p>
      </div>

      {errorMsg && (
        <div style={{
          backgroundColor: "#fef2f2",
          color: "#ef4444",
          padding: "1.2rem",
          borderRadius: "0.8rem",
          marginBottom: "2rem",
          fontSize: "1.3rem",
          border: "0.1rem solid #fee2e2",
          textAlign: "center"
        }}>
          {errorMsg}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Full Name</label>
          <div className="form-input-container">
            <i className="fa-regular fa-user form-icon"></i>
            <input
              type="text"
              id="fullName"
              className="form-input"
              placeholder="e.g. John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
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
              placeholder="e.g. 0700000000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
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
              placeholder="e.g. john@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">SACCO Member Number / ID</label>
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
          <label className="form-label">SACCO Name</label>
          <div className="form-input-container">
            <i className="fa-solid fa-building-columns form-icon"></i>
            <input
              type="text"
              id="saccoName"
              className="form-input"
              placeholder="e.g. Pewosa Sacco"
              value={saccoName}
              onChange={(e) => setSaccoName(e.target.value)}
              required
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
              placeholder="e.g. 2200"
              value={saccoUniqueNumber}
              onChange={(e) => setSaccoUniqueNumber(e.target.value)}
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
              minLength="8"
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

        <button type="submit" className="btn-submit" id="submitBtn" disabled={isLoading}>
          {isLoading ? "Creating..." : "Create Account"}{" "}
          {!isLoading && <i
            className="fa-solid fa-arrow-right"
            style={{ marginLeft: "0.8rem" }}
          ></i>}
        </button>

        <div className="auth-divider">
          <span>OR</span>
        </div>

        <button
          type="button"
          className="btn-google-auth"
          onClick={handleGoogleSignUp}
          disabled={isLoading}
        >
          <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
          </svg>
          <span>Continue with Google</span>
        </button>
      </form>

      <div className="auth-footer" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
