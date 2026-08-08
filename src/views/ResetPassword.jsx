"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE_TEXT, checkNewPassword } from "../utils/passwordPolicy";
import "../styles/login.css";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();

    // One shared rule. This form used to accept six characters while both registration
    // paths required eight, which made it the weakest way into any account: sign up under
    // the strict rule, then reset your way under the loose one.
    const problem = checkNewPassword(password, confirmPassword);
    if (problem) {
      setErrorMsg(problem);
      return;
    }

    setIsLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) {
        throw error;
      }

      setSuccessMsg("Your password has been reset successfully! Redirecting you to login...");
      setPassword("");
      setConfirmPassword("");

      // Redirect user after short delay
      setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch (err) {
      console.warn("Failed to reset password:", err);
      setErrorMsg(err.message || "An error occurred. Please request a new link.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageError = (event) => {
    event.currentTarget.src =
      "https://placehold.co/100x100/253b8e/ffffff?text=Logo";
  };

  return (
    <div className="auth-container">
      <div className="auth-header">
        <Link href="/">
          <img
            src="/images/sacco logo.png"
            alt="SACCO Logo"
            className="auth-logo"
            onError={handleImageError}
            style={{ cursor: "pointer" }}
          />
        </Link>
        <h1 className="auth-title">Create New Password</h1>
        <p className="auth-subtitle">
          Please enter and confirm your new account login password.
        </p>
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

      {successMsg && (
        <div style={{
          backgroundColor: "#ecfdf5",
          color: "#059669",
          padding: "1.2rem",
          borderRadius: "0.8rem",
          marginBottom: "2rem",
          fontSize: "1.3rem",
          border: "0.1rem solid #d1fae5",
          textAlign: "center"
        }}>
          {successMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label className="form-label" htmlFor="newPassword">New password</label>
          <div className="form-input-container">
            <i className="fa-solid fa-lock form-icon" aria-hidden="true"></i>
            <input
              type={showPassword ? "text" : "password"}
              id="newPassword"
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="form-input"
              disabled={isLoading}
              minLength={PASSWORD_MIN_LENGTH}
              aria-describedby="newPassword-hint"
            />
            <button
              type="button"
              className="pwd-toggle"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              aria-controls="newPassword"
            >
              <i
                className={showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}
                aria-hidden="true"
              ></i>
            </button>
          </div>
          <span className="form-hint" id="newPassword-hint">{PASSWORD_RULE_TEXT}</span>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="confirmPassword">Confirm new password</label>
          <div className="form-input-container">
            <i className="fa-solid fa-lock form-icon" aria-hidden="true"></i>
            <input
              type={showConfirmPassword ? "text" : "password"}
              id="confirmPassword"
              name="confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="form-input"
              disabled={isLoading}
              minLength={PASSWORD_MIN_LENGTH}
            />
            <button
              type="button"
              className="pwd-toggle"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              aria-pressed={showConfirmPassword}
              aria-controls="confirmPassword"
            >
              <i
                className={showConfirmPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}
                aria-hidden="true"
              ></i>
            </button>
          </div>
        </div>

        <button type="submit" className="btn-submit" disabled={isLoading}>
          {isLoading ? "Saving…" : "Save password and sign in"}
          {!isLoading && <i
            className="fa-solid fa-circle-check"
            style={{ marginLeft: "0.8rem" }}
          ></i>}
        </button>
      </form>
    </div>
  );
}
