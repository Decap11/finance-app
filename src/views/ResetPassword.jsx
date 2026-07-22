"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient.js";
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

    if (!password || password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
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

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">New Password</label>
          <div className="form-input-container">
            <i className="fa-solid fa-lock form-icon"></i>
            <input
              type={showPassword ? "text" : "password"}
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="form-input"
              disabled={isLoading}
              minLength={6}
            />
            <i
              className={showPassword ? "fa-regular fa-eye-slash pwd-toggle" : "fa-regular fa-eye pwd-toggle"}
              onClick={() => setShowPassword(!showPassword)}
              style={{ cursor: "pointer" }}
            ></i>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Confirm New Password</label>
          <div className="form-input-container">
            <i className="fa-solid fa-lock form-icon"></i>
            <input
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="form-input"
              disabled={isLoading}
              minLength={6}
            />
            <i
              className={showConfirmPassword ? "fa-regular fa-eye-slash pwd-toggle" : "fa-regular fa-eye pwd-toggle"}
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              style={{ cursor: "pointer" }}
            ></i>
          </div>
        </div>

        <button type="submit" className="btn-submit" disabled={isLoading}>
          {isLoading ? "Saving changes..." : "Save Password & Login"}
          {!isLoading && <i
            className="fa-solid fa-circle-check"
            style={{ marginLeft: "0.8rem" }}
          ></i>}
        </button>
      </form>
    </div>
  );
}
