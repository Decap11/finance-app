"use client";

import "../styles/LandingPage.css";
import Link from "next/link";

export default function LandingPage() {
  return (
    <>
      <div className="landing-page">
        <nav className="navbar" id="navbar">
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
              SACCO
              <span style={{ color: "var(--primary-light)" }}>Finance</span>
            </span>
            <span className="logo-badge">SaaS v1.0</span>
          </a>
          <Link href="/register-sacco" className="nav-cta">
            Create Workspace
          </Link>
        </nav>

        {/* Hero Section */}
        <header className="hero">
          <div className="hero-content">
            <span className="tagline">Cloud Cooperative Platform</span>
            <h1 className="hero-title">
              The Secure Operating System for <span>Modern SACCOs</span>
            </h1>
            <p className="hero-desc">
              Automate mandatory weekly obligations, manage shared capital
              ledger streams, calculate loans with intelligent estimators, and
              penalize attendance deviations within a highly secured
              multi-tenant workspace.
            </p>
            <div className="hero-btn-group">
              <Link href="/register-sacco" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                Register Organization <i className="fa-solid fa-arrow-right" style={{ marginLeft: '0.8rem' }}></i>
              </Link>
              {/* <button href="sacco-link.html" className="btn-secondary">
                Connect Workspace <i className="fa-solid fa-network-wired"></i>
              </button> */}
            </div>
          </div>

          {/* Interactive Simulated Mockup Graphic */}
          <div className="hero-visual">
            <div
              style={{
                width: "130%",
                maxWidth: "48rem",
                height: "35rem",
                background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                borderRadius: "var(--border-radius)",
                padding: "3rem",
                color: "white",
                boxShadow: "0 3rem 6rem rgba(37,59,142,0.15)",
                border: "1px solid rgba(255,255,255,0.08)",
                position: "relative",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "-10rem",
                  right: "-10rem",
                  width: "25rem",
                  height: "25rem",
                  background: "rgba(59,130,246,0.15)",
                  borderRadius: "50%",
                  filter: "blur(40px)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: "-8rem",
                  left: "-8rem",
                  width: "20rem",
                  height: "20rem",
                  background: "rgba(37,59,142,0.25)",
                  borderRadius: "50%",
                  filter: "blur(30px)",
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  paddingBottom: "1.5rem",
                  position: "relative",
                  zIndex: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.8rem",
                  }}
                >
                  <span
                    style={{
                      width: "1.2rem",
                      height: "1.2rem",
                      background: "#ef4444",
                      borderRadius: "50%",
                    }}
                  />
                  <span
                    style={{
                      width: "1.2rem",
                      height: "1.2rem",
                      background: "#f59e0b",
                      borderRadius: "50%",
                    }}
                  />
                  <span
                    style={{
                      width: "1.2rem",
                      height: "1.2rem",
                      background: "#10b981",
                      borderRadius: "50%",
                    }}
                  />
                  <span
                    style={{
                      marginLeft: "1rem",
                      fontSize: "1.2rem",
                      fontWeight: 600,
                      opacity: 0.8,
                      fontFamily: "monospace",
                      letterSpacing: "0.05rem",
                    }}
                  >
                    SECURED ENVIRONMENT
                  </span>
                </div>
                <i
                  className="fa-solid fa-shield-halved"
                  style={{ color: "var(--primary-light)", fontSize: "1.8rem" }}
                />
              </div>

              <div
                style={{ margin: "2rem 0", position: "relative", zIndex: 10 }}
              >
                <div
                  style={{
                    fontSize: "1.3rem",
                    opacity: 0.6,
                    marginBottom: "0.5rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.1rem",
                  }}
                >
                  AGGREGATE COOPERATIVE CAPITAL
                </div>
                <div
                  style={{
                    fontSize: "3.6rem",
                    fontWeight: 800,
                    color: "#ffffff",
                    letterSpacing: "-0.05rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                  }}
                >
                  Shs 84,500,000
                  <span
                    style={{
                      fontSize: "1.3rem",
                      background: "rgba(16,185,129,0.2)",
                      color: "#10b981",
                      padding: "0.4rem 0.8rem",
                      borderRadius: "2rem",
                      fontWeight: 700,
                    }}
                  >
                    +14.2%
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "1.2rem",
                    marginTop: "2.5rem",
                    height: "8rem",
                    alignItems: "flex-end",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "35%",
                      background: "rgba(255,255,255,0.06)",
                      borderRadius: "0.6rem",
                    }}
                  />
                  <div
                    style={{
                      width: "100%",
                      height: "50%",
                      background: "rgba(255,255,255,0.06)",
                      borderRadius: "0.6rem",
                    }}
                  />
                  <div
                    style={{
                      width: "100%",
                      height: "75%",
                      background: "rgba(255,255,255,0.1)",
                      borderRadius: "0.6rem",
                    }}
                  />
                  <div
                    style={{
                      width: "100%",
                      height: "60%",
                      background: "rgba(255,255,255,0.06)",
                      borderRadius: "0.6rem",
                    }}
                  />
                  <div
                    style={{
                      width: "100%",
                      height: "95%",
                      background:
                        "linear-gradient(to top, var(--primary-color), var(--primary-light))",
                      borderRadius: "0.6rem",
                      boxShadow: "0 0.5rem 1.5rem rgba(59,130,246,0.3)",
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderTop: "1px solid rgba(255,255,255,0.1)",
                  paddingTop: "1.5rem",
                  position: "relative",
                  zIndex: 10,
                  fontSize: "1.2rem",
                  opacity: 0.8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                  }}
                >
                  <i
                    className="fa-solid fa-circle"
                    style={{ color: "#10b981", fontSize: "0.8rem" }}
                  />
                  <span>Admin Gateway: Online</span>
                </div>
                <span>28 Members Configured</span>
              </div>
            </div>

            <div className="stats-card-overlay">
              <div className="stats-icon">
                <i className="fa-solid fa-users" />
              </div>
              <div className="stats-details">
                <h4>Add & Invite Frictions</h4>
                <p>Sub-millisecond ledger setup</p>
              </div>
            </div>
          </div>
        </header>

        <section className="features">
          <div className="section-header">
            <h2 className="section-title">Core Management Engine</h2>
            <p className="section-desc">
              Designed with industry-standard security and usability principles
              to govern your collective financial resources effectively.
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
                <i className="fa-solid fa-shield-halved" />
              </div>
              <h3>Multi-Tenant Separation</h3>
              <p>
                Every cooperative runs in its own private silo, securely
                accessed using an exclusive Organization Code generated during
                signup.
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
                <i className="fa-solid fa-chart-pie" />
              </div>
              <h3>Mandatory Weekly Pools</h3>
              <p>
                Organize structured obligation tracks: set up standard weekly
                share targets, developmental capital logs, and voluntary social
                funding pools.
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
                <i className="fa-solid fa-calculator" />
              </div>
              <h3>Loan Processing & Auditing</h3>
              <p>
                Enable members to calculate loan interests instantly with a
                transparent 5% monthly fee dashboard and submit applications
                directly to admins.
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
                <i className="fa-solid fa-user-check" />
              </div>
              <h3>Attendance & Fine Logs</h3>
              <p>
                Enforce governance guidelines. Track weekly cooperative physical
                meetings, check in members, and automatically trigger fines for
                absentees.
              </p>
            </div>
          </div>
        </section>

        <section
          className="testimonials"
          id="impact"
          style={{
            padding: "10rem 8%",
            background: "var(--bg-color)",
            borderTop: "1px solid rgba(226, 232, 240, 0.8)",
          }}
        >
          <div className="section-header">
            <span
              className="tagline"
              style={{
                background: "rgba(245, 158, 11, 0.08)",
                color: "var(--accent-color)",
              }}
            >
              Cooperative Impact
            </span>
            <h2 className="section-title">Empowering Real Community Growth</h2>
            <p className="section-desc">
              See how active cooperative members are leveraging secure capital
              pools and low-interest loans to expand their businesses and build
              a better future.
            </p>
          </div>
          <div
            className="testimonials-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(32rem, 1fr))",
              gap: "4rem",
              maxWidth: "110rem",
              margin: "0 auto",
            }}
          >
            <div
              className="testimonial-card"
              style={{
                background: "var(--white)",
                borderRadius: "var(--border-radius)",
                border: "1px solid rgba(226, 232, 240, 0.8)",
                overflow: "hidden",
                boxShadow: "var(--card-shadow)",
                display: "flex",
                flexDirection: "column",
                transition: "var(--transition)",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "26rem",
                  overflow: "hidden",
                  background: "#e2e8f0",
                }}
              >
                <img
                  src="/images/happy_member_market.png"
                  alt="Happy Market Retailer"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transition: "var(--transition)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: "1.5rem",
                    left: "1.5rem",
                    background: "rgba(15, 23, 42, 0.75)",
                    backdropFilter: "blur(8px)",
                    padding: "0.6rem 1.4rem",
                    borderRadius: "2rem",
                    color: "var(--white)",
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                  }}
                >
                  <i
                    className="fa-solid fa-store"
                    style={{ color: "var(--accent-color)" }}
                  />{" "}
                  Retail & Commerce
                </div>
              </div>
              <div
                style={{
                  padding: "3.5rem",
                  flexGrow: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.4rem",
                      color: "var(--accent-color)",
                      fontSize: "1.2rem",
                      marginBottom: "1.5rem",
                    }}
                  >
                    <i className="fa-solid fa-star" />
                    <i className="fa-solid fa-star" />
                    <i className="fa-solid fa-star" />
                    <i className="fa-solid fa-star" />
                    <i className="fa-solid fa-star" />
                  </div>
                  <h4
                    style={{
                      fontSize: "2rem",
                      fontWeight: 700,
                      color: "var(--text-dark)",
                      marginBottom: "1rem",
                      lineHeight: 1.3,
                    }}
                  >
                    "My boutique grew threefold within six months"
                  </h4>
                  <p
                    style={{
                      fontSize: "1.45rem",
                      color: "var(--text-light)",
                      lineHeight: 1.6,
                      marginBottom: "2.5rem",
                      fontStyle: "italic",
                    }}
                  >
                    "Before our SACCO linked to this platform, tracking my
                    weekly shares was chaotic. The automated ledger gave the
                    cooperative the transparency to approve my Shs 1.5M business
                    loan in record time. Today, my shop is fully stocked and
                    thriving!"
                  </p>
                </div>
                <div
                  style={{
                    borderTop: "1px solid rgba(226, 232, 240, 0.6)",
                    paddingTop: "2rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <h5
                      style={{
                        fontSize: "1.5rem",
                        fontWeight: 700,
                        color: "var(--text-dark)",
                      }}
                    >
                      Sarah Namubiru
                    </h5>
                    <span
                      style={{
                        fontSize: "1.2rem",
                        color: "var(--text-light)",
                        fontWeight: 500,
                      }}
                    >
                      Boutique Owner • Member #0014
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 700,
                      background: "rgba(37, 59, 142, 0.08)",
                      color: "var(--primary-color)",
                      padding: "0.5rem 1rem",
                      borderRadius: "2rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05rem",
                    }}
                  >
                    Kikuubo Traders
                  </span>
                </div>
              </div>
            </div>

            <div
              className="testimonial-card"
              style={{
                background: "var(--white)",
                borderRadius: "var(--border-radius)",
                border: "1px solid rgba(226, 232, 240, 0.8)",
                overflow: "hidden",
                boxShadow: "var(--card-shadow)",
                display: "flex",
                flexDirection: "column",
                transition: "var(--transition)",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "26rem",
                  overflow: "hidden",
                  background: "#e2e8f0",
                }}
              >
                <img
                  src="/images/happy_farmer_success.png"
                  alt="Happy Farmer"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transition: "var(--transition)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: "1.5rem",
                    left: "1.5rem",
                    background: "rgba(15, 23, 42, 0.75)",
                    backdropFilter: "blur(8px)",
                    padding: "0.6rem 1.4rem",
                    borderRadius: "2rem",
                    color: "var(--white)",
                    fontSize: "1.1rem",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                  }}
                >
                  <i
                    className="fa-solid fa-wheat-awn"
                    style={{ color: "#10b981" }}
                  />{" "}
                  Agriculture & Farming
                </div>
              </div>
              <div
                style={{
                  padding: "3.5rem",
                  flexGrow: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.4rem",
                      color: "var(--accent-color)",
                      fontSize: "1.2rem",
                      marginBottom: "1.5rem",
                    }}
                  >
                    <i className="fa-solid fa-star" />
                    <i className="fa-solid fa-star" />
                    <i className="fa-solid fa-star" />
                    <i className="fa-solid fa-star" />
                    <i className="fa-solid fa-star" />
                  </div>
                  <h4
                    style={{
                      fontSize: "2rem",
                      fontWeight: 700,
                      color: "var(--text-dark)",
                      marginBottom: "1rem",
                      lineHeight: 1.3,
                    }}
                  >
                    "Funded solar irrigation for my maize field"
                  </h4>
                  <p
                    style={{
                      fontSize: "1.45rem",
                      color: "var(--text-light)",
                      lineHeight: 1.6,
                      marginBottom: "2.5rem",
                      fontStyle: "italic",
                    }}
                  >
                    "Contributing Shs 1,000 weekly to our development fund pool
                    was incredibly simple on the mobile interface. The SACCO
                    awarded me a development yield loan that allowed me to buy
                    solar pumps, saving my crop yields during dry spells!"
                  </p>
                </div>
                <div
                  style={{
                    borderTop: "1px solid rgba(226, 232, 240, 0.6)",
                    paddingTop: "2rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <h5
                      style={{
                        fontSize: "1.5rem",
                        fontWeight: 700,
                        color: "var(--text-dark)",
                      }}
                    >
                      David Kibirige
                    </h5>
                    <span
                      style={{
                        fontSize: "1.2rem",
                        color: "var(--text-light)",
                        fontWeight: 500,
                      }}
                    >
                      Maize Farmer • Member #0128
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 700,
                      background: "rgba(16, 185, 129, 0.08)",
                      color: "#10b981",
                      padding: "0.5rem 1rem",
                      borderRadius: "2rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05rem",
                    }}
                  >
                    Mityana Growers
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>


        <footer>
          <a href="#" className="footer-logo">
            <img
              src="images/sacco logo.png"
              alt="SACCO Logo"
              style={{ width: "3rem", height: "auto" }}
              onError={(event) => {
                event.currentTarget.src =
                  "https://placehold.co/40x40/ffffff/253b8e?text=S";
              }}
            />
            <span>
              SACCO
              <span style={{ color: "var(--primary-light)" }}>Finance</span>
            </span>
          </a>
          <ul className="footer-links">
            <li>
              <a href="#">Security Audits</a>
            </li>
            <li>
              <a href="#">Privacy Framework</a>
            </li>
            <li>
              <Link href="/dashboard">Link Dashboard</Link>
            </li>
          </ul>
          <p className="footer-copyright">
            &copy; 2026 SACCO Finance SaaS Platform. Built using
            compliance-grade cooperative protocols. All rights reserved.
          </p>
        </footer>
      </div>
    </>
  );
}
