import "../styles/login.css";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

// import { useSaccoState } from "../context/useSaccoState";

export default function Login() {
  const [memberId, setMemberId] = useState("");
  const [LogInpassword, setLogInPassword] = useState("");
  // const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();
    // TODO: Add login logic here
    const loginData = {
      memberId,
      LogInpassword,
    };
    console.log(loginData);
    navigate("/dashboard");
  };

  const togglePassword = () => {
    const passwordInput = document.getElementById("password");
    if (passwordInput) {
      passwordInput.type =
        passwordInput.type === "password" ? "text" : "password";
    }
  };

  const handleImageError = (event) => {
    event.currentTarget.src =
      "https://placehold.co/100x100/253b8e/ffffff?text=Logo";
  };

  return (
    <div className="auth-container">
      <div className="auth-header">
        <img
          src="/images/sacco logo.png"
          alt="SACCO Logo"
          className="auth-logo"
          onError={handleImageError}
        />
        <h1 className="auth-title">Welcome Back</h1>
        <p className="auth-subtitle">
          Sign in to securely access your SACCO financial records.
        </p>
      </div>

      <form id="loginForm" onSubmit={handleLogin}>
        <div className="form-group">
          <label className="form-label">Email or Member ID</label>
          <div className="form-input-container">
            <i className="fa-regular fa-user form-icon"></i>
            <input
              type="text"
              id="username"
              className="form-input"
              placeholder="e.g. MEM-0042"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            Password
            <button type="button" className="forgot-link">
              Forgot password?
            </button>
          </label>
          <div className="form-input-container">
            <i className="fa-solid fa-lock form-icon"></i>
            <input
              type="password"
              id="password"
              className="form-input"
              placeholder="Enter your password"
              value={LogInpassword}
              onChange={(e) => setLogInPassword(e.target.value)}
              required
            />
            <i
              className="fa-regular fa-eye pwd-toggle"
              onClick={togglePassword}
            ></i>
          </div>
        </div>

        <div
          style={{
            fontSize: "1.3rem",
            marginBottom: "2rem",
            color: "var(--text-light)",
            display: "flex",
            alignItems: "center",
            gap: "0.8rem",
          }}
        >
          <input
            type="checkbox"
            id="remember"
            style={{
              width: "1.4rem",
              height: "1.4rem",
              accentColor: "var(--primary-color)",
              cursor: "pointer",
            }}
          />
          <label htmlFor="remember" style={{ cursor: "pointer" }}>
            Remember me on this device
          </label>
        </div>

        <button type="submit" className="btn-submit" id="submitBtn">
          Secure Login
          <i
            className="fa-solid fa-arrow-right-to-bracket"
            style={{ marginLeft: "0.8rem" }}
          ></i>
        </button>
      </form>

      <div className="auth-footer">
        Don't have an account?{" "}
        <Link to="/signup" className="auth-link">
          Sign up here
        </Link>
      </div>
    </div>
  );
}
