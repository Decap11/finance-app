"use client";

import "../styles/login.css";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// import { useSaccoState } from "../context/useSaccoState";

export default function Login() {
  const [email, setEmail] = useState("");
  const [LogInpassword, setLogInPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedEmail = localStorage.getItem("rememberedEmail");
      const savedPassword = localStorage.getItem("rememberedPassword");
      if (savedEmail) setEmail(savedEmail);
      if (savedPassword) setLogInPassword(savedPassword);
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !LogInpassword) return;

    setIsLoading(true);
    setErrorMsg("");

    const { supabase } = await import("../supabaseClient.js");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: LogInpassword,
    });

    if (error) {
      setIsLoading(false);
      setErrorMsg(error.message);
      return;
    }

    // Fetch user profile role to route appropriately
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    setIsLoading(false);

    if (typeof window !== "undefined") {
      localStorage.setItem("rememberedEmail", email.trim());
      localStorage.setItem("rememberedPassword", LogInpassword);
    }

    if (profile && profile.role === 'admin') {
      router.push("/admin");
    } else {
      router.push("/dashboard");
    }
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
          Don't have an account?{" "}
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
