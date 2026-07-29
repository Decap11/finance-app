"use client";

import React, { useState, useEffect } from "react";
import "../styles/LandingPage.css";
import Link from "next/link";

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 30) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="landing-page">
      {/* Navbar Header */}
      <nav className={`navbar ${scrolled ? "scrolled" : ""}`} id="navbar">
        <a href="#" className="logo-group">
          <img
            src="images/sacco logo.png"
            alt="SACCO Logo"
            className="logo-img"
            onError={(event) => {
              event.currentTarget.src =
                "https://placehold.co/80x80/253b8e/ffffff?text=SF";
            }}
          />
          <span className="logo-text">
            SACCO<span className="logo-text-accent">Finance</span>
          </span>
          <span className="logo-badge">SaaS v1.0</span>
        </a>
        <div className="nav-actions">
          <Link href="/login" className="nav-link-login">
            Log In
          </Link>
          <Link href="/signup" className="nav-cta">
            <span>Sign Up</span>
            <i className="fa-solid fa-user-plus"></i>
          </Link>
          <Link href="/register-sacco" className="nav-link-sacco">
            <span>Create SACCO</span>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="hero">
        <div className="hero-content">
          <span className="tagline">Cloud Cooperative Platform</span>
          <h1 className="hero-title">
            The Secure Operating System for <span>Modern SACCOs</span>
          </h1>
          <p className="hero-desc">
            Automate mandatory weekly obligations, manage shared capital ledger
            streams, calculate loans with intelligent estimators, and govern physical
            attendance within a secured workspace.
          </p>
          <div className="hero-btn-group">
            <Link href="/signup" className="btn-primary">
              <span>Sign Up Now</span>
              <i className="fa-solid fa-arrow-right"></i>
            </Link>
            <Link href="/register-sacco" className="btn-secondary">
              <span>Register SACCO</span>
              <i className="fa-solid fa-building-columns"></i>
            </Link>
          </div>
        </div>

        {/* Interactive Simulated Mockup Graphic */}
        <div className="hero-visual">
          <div className="mockup-card">
            <div className="mockup-bg-blur-1"></div>
            <div className="mockup-bg-blur-2"></div>

            <div className="mockup-header">
              <div className="mockup-dots">
                <span className="dot dot-red"></span>
                <span className="dot dot-yellow"></span>
                <span className="dot dot-green"></span>
                <span className="mockup-status-title">SECURED ENVIRONMENT</span>
              </div>
              <i className="fa-solid fa-shield-halved mockup-shield-icon"></i>
            </div>

            <div className="mockup-body">
              <div className="mockup-label">AGGREGATE COOPERATIVE CAPITAL</div>
              <div className="mockup-balance">
                <span>Shs 84,500,000</span>
                <span className="mockup-growth-badge">+14.2%</span>
              </div>

              <div className="mockup-chart-bars">
                <div className="chart-bar bar-1"></div>
                <div className="chart-bar bar-2"></div>
                <div className="chart-bar bar-3"></div>
                <div className="chart-bar bar-4"></div>
                <div className="chart-bar bar-active"></div>
              </div>
            </div>

            <div className="mockup-footer">
              <div className="mockup-online-tag">
                <i className="fa-solid fa-circle"></i>
                <span>Admin Gateway: Online</span>
              </div>
              <span>28 Members Configured</span>
            </div>
          </div>

          <div className="stats-card-overlay">
            <div className="stats-icon">
              <i className="fa-solid fa-users"></i>
            </div>
            <div className="stats-details">
              <h4>Fast & Easy Onboarding</h4>
              <p>Sub-millisecond ledger setup</p>
            </div>
          </div>
        </div>
      </header>

      {/* Features Section */}
      <section className="features">
        <div className="section-header">
          <h2 className="section-title">Core Management Engine</h2>
          <p className="section-desc">
            Designed with industry-standard security and usability principles to govern your collective financial resources effectively.
          </p>
        </div>
        <div className="features-grid">
          <div className="feature-card">
            <div
              className="feature-icon-wrapper"
              style={{
                backgroundColor: "rgba(37,59,142,0.1)",
                color: "var(--primary-color)",
              }}
            >
              <i className="fa-solid fa-shield-halved"></i>
            </div>
            <h3>Multi-Tenant Separation</h3>
            <p>
              Every cooperative runs in its own private silo, securely accessed using an exclusive Organization Code generated during signup.
            </p>
          </div>
          <div className="feature-card">
            <div
              className="feature-icon-wrapper"
              style={{
                backgroundColor: "rgba(245,158,11,0.1)",
                color: "var(--accent-color)",
              }}
            >
              <i className="fa-solid fa-chart-pie"></i>
            </div>
            <h3>Mandatory Weekly Pools</h3>
            <p>
              Organize structured obligation tracks: set up standard weekly share targets, developmental capital logs, and voluntary social funding pools.
            </p>
          </div>
          <div className="feature-card">
            <div
              className="feature-icon-wrapper"
              style={{
                backgroundColor: "rgba(16,185,129,0.1)",
                color: "#10b981",
              }}
            >
              <i className="fa-solid fa-calculator"></i>
            </div>
            <h3>Loan Processing & Auditing</h3>
            <p>
              Enable members to calculate loan interests instantly with a transparent 5% monthly fee dashboard and submit applications directly to admins.
            </p>
          </div>
          <div className="feature-card">
            <div
              className="feature-icon-wrapper"
              style={{
                backgroundColor: "rgba(239,68,68,0.1)",
                color: "#ef4444",
              }}
            >
              <i className="fa-solid fa-user-check"></i>
            </div>
            <h3>Attendance & Fine Logs</h3>
            <p>
              Enforce governance guidelines. Track weekly physical meetings, check in members, and automatically trigger fines for absentees.
            </p>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="testimonials" id="impact">
        <div className="section-header">
          <span className="tagline tagline-impact">Cooperative Impact</span>
          <h2 className="section-title">Empowering Real Community Growth</h2>
          <p className="section-desc">
            See how active cooperative members are leveraging secure capital pools and low-interest loans to expand their businesses and build a better future.
          </p>
        </div>

        <div className="testimonials-grid">
          <div className="testimonial-card">
            <div className="testimonial-img-wrapper">
              <img
                src="/images/happy_member_market.png"
                alt="Happy Market Retailer"
                className="testimonial-img"
              />
              <div className="testimonial-badge">
                <i className="fa-solid fa-store"></i> Retail & Commerce
              </div>
            </div>
            <div className="testimonial-body">
              <div>
                <div className="testimonial-stars">
                  <i className="fa-solid fa-star"></i>
                  <i className="fa-solid fa-star"></i>
                  <i className="fa-solid fa-star"></i>
                  <i className="fa-solid fa-star"></i>
                  <i className="fa-solid fa-star"></i>
                </div>
                <h4 className="testimonial-headline">
                  "My boutique grew threefold within six months"
                </h4>
                <p className="testimonial-quote">
                  "Before our SACCO linked to this platform, tracking my weekly shares was chaotic. The automated ledger gave the cooperative the transparency to approve my Shs 1.5M business loan in record time."
                </p>
              </div>
              <div className="testimonial-author">
                <div>
                  <h5 className="author-name">Sarah Namubiru</h5>
                  <span className="author-role">Boutique Owner • Member #0014</span>
                </div>
                <span className="author-sacco-tag">Kikuubo Traders</span>
              </div>
            </div>
          </div>

          <div className="testimonial-card">
            <div className="testimonial-img-wrapper">
              <img
                src="/images/happy_farmer_success.png"
                alt="Happy Farmer"
                className="testimonial-img"
              />
              <div className="testimonial-badge">
                <i className="fa-solid fa-wheat-awn"></i> Agriculture & Farming
              </div>
            </div>
            <div className="testimonial-body">
              <div>
                <div className="testimonial-stars">
                  <i className="fa-solid fa-star"></i>
                  <i className="fa-solid fa-star"></i>
                  <i className="fa-solid fa-star"></i>
                  <i className="fa-solid fa-star"></i>
                  <i className="fa-solid fa-star"></i>
                </div>
                <h4 className="testimonial-headline">
                  "Funded solar irrigation for my maize field"
                </h4>
                <p className="testimonial-quote">
                  "Contributing Shs 1,000 weekly to our development fund pool was incredibly simple on the mobile interface. The SACCO awarded me a yield loan that allowed me to buy solar pumps!"
                </p>
              </div>
              <div className="testimonial-author">
                <div>
                  <h5 className="author-name">David Kibirige</h5>
                  <span className="author-role">Maize Farmer • Member #0128</span>
                </div>
                <span className="author-sacco-tag tag-green">Mityana Growers</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Sign Up Banner */}
      <section className="cta-banner-section">
        <h2 className="cta-title">Ready to Join Your SACCO Cooperative?</h2>
        <p className="cta-desc">
          Create your personal member account in seconds and start tracking your shares, savings, and loan applications effortlessly.
        </p>
        <div className="cta-btn-group">
          <Link href="/signup" className="cta-btn-primary">
            <span>Sign Up Now</span>
            <i className="fa-solid fa-user-plus"></i>
          </Link>
          <Link href="/login" className="cta-btn-secondary">
            <span>Log In</span>
            <i className="fa-solid fa-arrow-right-to-bracket"></i>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <a href="#" className="footer-logo">
          <span>SACCO Finance SaaS</span>
        </a>
        <ul className="footer-links">
          <li><Link href="/login">Login</Link></li>
          <li><Link href="/signup">Member Signup</Link></li>
          <li><Link href="/register-sacco">Register SACCO</Link></li>
        </ul>
        <div className="footer-copyright">
          © {new Date().getFullYear()} SACCO Finance SaaS. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
