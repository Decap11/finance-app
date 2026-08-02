"use client";

import React, { useState, useEffect, FormEvent, SyntheticEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import "../styles/login.css";
import { supabase } from "../supabaseClient";

export default function Login() {
  const [email, setEmail] = useState<string>("");
  const [LogInpassword, setLogInPassword] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const router = useRouter();
  const searchParams = useSearchParams();

  const justRegistered = searchParams?.get("registered") === "1";
  const registeredEmail = searchParams?.get("email") || "";
  // Set by ProtectedRoute when the auth server no longer recognises the account,
  // i.e. an admin removed this member from the SACCO mid-session.
  const wasRemoved = searchParams?.get("removed") === "1";

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedEmail = localStorage.getItem("rememberedEmail");
      if (savedEmail) setEmail(savedEmail);
    }
    if (registeredEmail) setEmail(decodeURIComponent(registeredEmail));
  }, [registeredEmail]);

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email || !LogInpassword) return;

    setIsLoading(true);
    setErrorMsg("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: LogInpassword,
    });

    if (error) {
      setIsLoading(false);
      let friendlyMsg = error.message;
      if (error.message.toLowerCase().includes("invalid login") || error.message.toLowerCase().includes("invalid credentials")) {
        friendlyMsg = "Incorrect email or password. Please try again.";
      } else if (error.message.toLowerCase().includes("email not confirmed")) {
        friendlyMsg = "Please confirm your email address before logging in. Check your inbox.";
      } else if (error.message.toLowerCase().includes("too many requests")) {
        friendlyMsg = "Too many login attempts. Please wait a moment and try again.";
      }
      setErrorMsg(friendlyMsg);
      return;
    }

    if (!data.user) {
      setIsLoading(false);
      setErrorMsg("Failed to retrieve user data.");
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    setIsLoading(false);

    if (typeof window !== "undefined") {
      localStorage.setItem("rememberedEmail", email.trim());
    }

    if (profile && profile.role === 'admin') {
      if (typeof window !== "undefined" && window.location.search.includes("onboarding=1")) {
        router.push("/admin?tab=settings&onboarding=1");
      } else {
        router.push("/admin");
      }
    } else {
      router.push("/dashboard");
    }
  };

  const togglePassword = () => {
    const passwordInput = document.getElementById("password") as HTMLInputElement | null;
    if (passwordInput) {
      passwordInput.type =
        passwordInput.type === "password" ? "text" : "password";
    }
  };

  const handleImageError = (event: SyntheticEvent<HTMLImageElement, Event>) => {
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

      {justRegistered && (
        <div style={{
          background: 'linear-gradient(135deg, #d4edda, #c3e6cb)',
          border: '1px solid #28a745',
          borderRadius: '0.8rem',
          padding: '1.2rem 1.6rem',
          marginBottom: '1.5rem',
          textAlign: 'center',
          fontSize: '1.3rem',
          color: '#155724',
          lineHeight: '1.5',
        }}>
          <strong>✅ SACCO registered successfully!</strong><br />
          We&apos;ve sent a confirmation link to <strong>{registeredEmail}</strong>.<br />
          Please check your email, click the link, then log in here.
        </div>
      )}

      {wasRemoved && (
        <div style={{
          background: 'linear-gradient(135deg, #fee2e2, #fecaca)',
          border: '1px solid #ef4444',
          borderRadius: '0.8rem',
          padding: '1.2rem 1.6rem',
          marginBottom: '1.5rem',
          textAlign: 'center',
          fontSize: '1.3rem',
          color: '#991b1b',
          lineHeight: '1.5',
        }}>
          <strong>Your account is no longer active.</strong><br />
          It has been removed from the SACCO. Contact your SACCO administrator if you
          believe this is a mistake.
        </div>
      )}

      {errorMsg && <div className="error-message" style={{ color: 'red', textAlign: 'center', marginBottom: '1rem' }}>{errorMsg}</div>}

      <form id="loginForm" onSubmit={handleLogin}>
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

        <button type="submit" className="btn-submit" id="submitBtn" disabled={isLoading}>
          {isLoading ? "Logging in..." : "Secure Login"}
          {!isLoading && <i
            className="fa-solid fa-arrow-right-to-bracket"
            style={{ marginLeft: "0.8rem" }}
          ></i>}
        </button>
      </form>

      <div className="auth-footer" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div>
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="auth-link">
            Sign up here
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
