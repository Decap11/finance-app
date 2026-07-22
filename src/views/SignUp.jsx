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

    // Redirect the user to the login page or members page
    router.push("/login");
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
