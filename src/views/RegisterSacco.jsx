"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../styles/signUp.css"; // Reuse the signup styles

export default function RegisterSacco() {
  // Admin Details
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [memberId, setMemberId] = useState("");
  
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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!fullName || !phone || !email || !password || !memberId || !saccoName || !saccoUniqueNumber) return;
    if (!termsAccepted) {
      setErrorMsg("You must accept the terms and conditions.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    const { supabase } = await import("../supabaseClient.js");

    // Generate acronym and group code using user entered unique number
    const generatedAcronym = saccoName.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().substring(0, 8);
    const generatedGroupCode = `${generatedAcronym}-${saccoUniqueNumber.trim().toUpperCase()}`;
    const adminMemberNumber = `MEM-${memberId.trim().toUpperCase()}`;

    // 1. Sign up the admin user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password: password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          member_number: adminMemberNumber,
          group_id: generatedGroupCode,
          role: 'admin',
          status: 'active',
        }
      }
    });

    if (authError) {
      setErrorMsg(authError.message);
      setIsLoading(false);
      return;
    }

    if (!authData?.user) {
      setErrorMsg("Signup completed but failed to retrieve user session details.");
      setIsLoading(false);
      return;
    }

    // 2. Call the RPC to create the SACCO and link the admin
    const { error: rpcError } = await supabase.rpc('register_new_sacco', {
      p_sacco_name: saccoName.trim(),
      p_acronym: generatedAcronym,
      p_group_code: generatedGroupCode,
      p_admin_profile_id: authData.user.id
    });

    setIsLoading(false);

    if (rpcError) {
      setErrorMsg("SACCO Registration Failed: " + rpcError.message);
      return;
    }

    if (typeof window !== "undefined") {
      localStorage.setItem("rememberedEmail", email.trim());
      localStorage.setItem("rememberedPassword", password);
    }

    // 3. Navigate to admin settings route to make initial group configurations
    router.push("/admin?tab=settings");
  }

  return (
    <div className="auth-container" style={{ margin: "2rem auto" }}>
      <div className="auth-header">
        <h1 className="auth-title">Register Your SACCO</h1>
        <p className="auth-subtitle">
          Create a new SACCO group and become its Administrator.
        </p>
      </div>

      {errorMsg && <div className="error-message" style={{ color: 'red', textAlign: 'center', marginBottom: '1rem' }}>{errorMsg}</div>}

      <form id="registerSaccoForm" onSubmit={handleSubmit}>
        <h3 style={{ marginBottom: "1rem", color: "var(--text-dark)" }}>SACCO Details</h3>
        
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


        <h3 style={{ margin: "2rem 0 1rem", color: "var(--text-dark)" }}>Admin Profile Details</h3>

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
            <a href="#" className="auth-link">Terms of Service</a>{" "}
            and{" "}
            <a href="#" className="auth-link">Privacy Policy</a>.
          </label>
        </div>

        <button type="submit" className="btn-submit" id="submitBtn" disabled={isLoading}>
          {isLoading ? "Registering..." : "Register SACCO"}{" "}
          {!isLoading && <i className="fa-solid fa-arrow-right" style={{ marginLeft: "0.8rem" }}></i>}
        </button>
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
