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
  const [showPassword, setShowPassword] = useState<boolean>(false);
  // Was a checkbox bound to nothing while the email was saved unconditionally below, so
  // the box did nothing whichever way it was left and every device remembered the last
  // address typed on it. Defaults to true only when there is already a saved address,
  // which is the state the member last left it in.
  const [rememberMe, setRememberMe] = useState<boolean>(false);
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
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
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

    // Honour the checkbox. Unticking it now actually forgets the address, which is what
    // it has always claimed to do -- on a shared phone, which is common here, leaving a
    // member's email on the sign-in screen is a real thing to be able to refuse.
    if (typeof window !== "undefined") {
      if (rememberMe) {
        localStorage.setItem("rememberedEmail", email.trim());
      } else {
        localStorage.removeItem("rememberedEmail");
      }
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

  // togglePassword removed: it reached into the DOM with getElementById and mutated
  // input.type behind React's back, so the icon never changed and React had no idea the
  // field had switched. `showPassword` state drives both the type and the glyph now.

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

      {/* role="alert" so a failed sign-in is announced rather than silently repainted --
          a member using a screen reader previously got no indication at all that the
          form had rejected them. */}
      {errorMsg && (
        <div className="auth-alert auth-alert-error" role="alert">
          <i className="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleLogin} noValidate>
        <div className="form-group">
          <label className="form-label" htmlFor="email">Email address</label>
          <div className="form-input-container">
            <i className="fa-regular fa-envelope form-icon" aria-hidden="true"></i>
            <input
              type="email"
              id="email"
              name="email"
              className="form-input"
              // Lets a password manager fill this, which is most of how members with a
              // long SACCO email actually sign in on a phone.
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <div className="form-label-row">
            <label className="form-label" htmlFor="password">Password</label>
            {/* Was a <button> with no handler, nested inside the <label>, pointing at a
                route that did not exist. A member who forgot their password had no way
                back into their own account. */}
            <Link href="/forgot-password" className="forgot-link">
              Forgot password?
            </Link>
          </div>
          <div className="form-input-container">
            <i className="fa-solid fa-lock form-icon" aria-hidden="true"></i>
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              name="password"
              className="form-input"
              autoComplete="current-password"
              value={LogInpassword}
              onChange={(e) => setLogInPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="pwd-toggle"
              onClick={() => setShowPassword((v) => !v)}
              // The label states what pressing it will DO, and aria-pressed carries the
              // current state. Announcing "show password" while the password is already
              // visible is the usual way this control goes wrong.
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
        </div>

        <div className="form-check">
          <input
            type="checkbox"
            id="remember"
            name="remember"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          />
          <label htmlFor="remember">Remember me on this device</label>
        </div>

        <button type="submit" className="btn-submit" disabled={isLoading}>
          {isLoading ? "Signing in…" : "Sign in"}
          {!isLoading && <i
            className="fa-solid fa-arrow-right-to-bracket"
            style={{ marginLeft: "0.8rem" }}
            aria-hidden="true"
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
