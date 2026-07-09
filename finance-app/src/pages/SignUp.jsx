import "../styles/signUp.css";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export default function SignupForm() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [memberId, setMemberId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [password, setPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const navigate = useNavigate();

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
    if (!fullName || !phone || !memberId || !groupId || !password) return;
    if (!termsAccepted) {
      setErrorMsg("You must accept the terms and conditions.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    const email = `${memberId.trim().toLowerCase()}@pewosa.com`;

    // Initialize Supabase Client dynamically so it doesn't break if not set yet
    const { supabase } = await import("../supabaseClient.js");

    const { error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          member_number: memberId.trim().toUpperCase(),
          group_id: groupId.trim().toUpperCase(),
        }
      }
    });

    setIsLoading(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    // Reset form fields after submission
    setFullName("");
    setPhone("");
    setMemberId("");
    setGroupId("");
    setPassword("");
    setTermsAccepted(false);

    // Redirect the user to the login page or members page
    navigate("/login");
  }

  return (
    <div className="auth-container">
      <div className="auth-header">
        <img
          src="/images/sacco logo.png"
          alt="SACCO Logo"
          className="auth-logo"
        />
        <h1 className="auth-title">Create your Account</h1>
        <p className="auth-subtitle">
          Join the SACCO and take control of your future.
        </p>
      </div>

      {errorMsg && <div className="error-message" style={{ color: 'red', textAlign: 'center', marginBottom: '1rem' }}>{errorMsg}</div>}

      <form id="signupForm" onSubmit={handleSubmit}>
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
          <label className="form-label">Member ID</label>
          <div className="form-input-container">
            <i className="fa-solid fa-id-badge form-icon"></i>
            <input
              type="text"
              id="memberId"
              className="form-input"
              placeholder="e.g. MEM-0042"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              required
              style={{ textTransform: "uppercase" }}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Group ID:</label>
          <div className="form-input-container">
            <i className="fa-regular fa-envelope form-icon"></i>
            <input
              type="text"
              id="groupId"
              className="form-input"
              placeholder="e.g. GROUP-001"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
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

      <div className="auth-footer">
        Already have an account?{" "}
        <Link to="/login" className="auth-link">
          Log in here
        </Link>
      </div>
    </div>
  );
}
