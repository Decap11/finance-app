"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient.js";
import "../styles/login.css";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        throw error;
      }

      setSuccessMsg("A password recovery link has been sent to your email address!");
      setEmail("");
    } catch (err) {
      console.warn("Failed to request password reset:", err);
      setErrorMsg(err.message || "An error occurred. Please try again.");
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
        <h1 className="auth-title">Reset Password</h1>
        <p className="auth-subtitle">
          Enter your email address and we'll send you a recovery link to restore access.
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
          <label className="form-label">Email Address</label>
          <div className="form-input-container">
            <i className="fa-regular fa-envelope form-icon"></i>
            <input
              type="email"
              placeholder="e.g. member@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="form-input"
              disabled={isLoading}
            />
          </div>
        </div>

        <button type="submit" className="btn-submit" disabled={isLoading}>
          {isLoading ? "Sending link..." : "Send Recovery Link"}
          {!isLoading && <i
            className="fa-solid fa-paper-plane"
            style={{ marginLeft: "0.8rem" }}
          ></i>}
        </button>
      </form>

      <div className="auth-footer" style={{ marginTop: "2.5rem", textAlign: "center" }}>
        <Link href="/login" className="auth-link" style={{ fontSize: "1.4rem", fontWeight: 600 }}>
          Back to Login
        </Link>
      </div>
    </div>
  );
}
