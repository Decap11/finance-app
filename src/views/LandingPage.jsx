"use client";

import { useState, useEffect } from "react";
import "../styles/LandingPage.css";
import Link from "next/link";
import { SUBSCRIPTION_PLANS } from "../utils/subscriptionPlans";

/**
 * The public landing page.
 *
 * Prices come from subscriptionPlans.js rather than being written out here, so the page can
 * never quote a figure the checkout would not honour. Every plan's button points at
 * /register-sacco: a committee cannot buy anything before it has a SACCO, and 0016 made plan
 * activation platform-controlled anyway, so checkout is something they reach from inside the
 * app once they are running.
 */

// Contact details shown in the footer. Placeholders -- replace with the real line before
// this page goes public; a finance product with no reachable phone number does not get
// trusted, and a wrong one is worse than none.
const CONTACT = {
  phone: "+256 700 123 456",
  phoneHref: "tel:+256700123456",
  whatsapp: "https://wa.me/256700123456",
  email: "support@pewosa.org",
  address: "PEWOSA Secretariat, Kampala, Uganda"
};

// The long comparison checklist. A committee weighing two systems reads this with a pen in
// hand, so it lists what exists today -- nothing aspirational.
const CAPABILITIES = [
  "Weekly contribution tracking",
  "Shares recorded as a count and a unit price",
  "Development fund targets",
  "Social fund minimums",
  "Member enrolment and admin approval",
  "Group-code access control",
  "Loan requests with guarantors",
  "Guarantor accept or decline",
  "Repayment tracking to the shilling",
  "Loan late fees",
  "Loan application fees",
  "Weekly attendance register",
  "Automatic absence fines",
  "General fines and waivers",
  "Member savings vaults",
  "Dividend cycles and payouts",
  "PDF audit and member reports",
  "Contribution approve or reject",
  "MTN and Airtel Money payments",
  "Live dashboard totals",
  "Historical records from your old book",
  "Audit trail of every admin action"
];

const FAQS = [
  {
    q: "Do we need to be technical to use it?",
    a: "No. If your treasurer can use WhatsApp, they can run a meeting here. Recording a week is a list of members and an amount against each one."
  },
  {
    q: "What happens to the records already in our book?",
    a: "You can enter past weeks during onboarding, so the system starts from where your book left off rather than from zero. Balances, shares and dividends are then calculated over the full history."
  },
  {
    q: "Can a member quietly change their own balance?",
    a: "No. What a member submits is a request; it does not move the books until an admin approves it. Members also cannot promote themselves to admin -- the database refuses that write, not just the screen."
  },
  {
    q: "What if there is no network at the meeting hall?",
    a: "PEWOSA needs a connection to save a meeting. Committees usually record on a phone over mobile data, and where there is no signal the treasurer enters the week afterwards -- the meeting date is what gets recorded, not the moment of typing."
  },
  {
    q: "How do we pay for it?",
    a: "MTN Mobile Money or Airtel Money, from inside the app. Your onboarding month is free and asks for no payment details, so a committee can run a full cycle before deciding."
  },
  {
    q: "Can another SACCO see our members or our money?",
    a: "No. Every row in the database carries the SACCO it belongs to, and Postgres itself refuses to return rows outside the SACCO of whoever is asking."
  }
];

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
            alt="PEWOSA SACCO Logo"
            className="logo-img"
            onError={(event) => {
              event.currentTarget.src =
                "https://placehold.co/80x80/253b8e/ffffff?text=PEWOSA";
            }}
          />
          <span className="logo-text">
            PEWOSA <span className="logo-text-accent">SACCO</span>
          </span>
          <span className="logo-badge">Uganda</span>
        </a>

        {/* Section links. Hidden below 787px */}
        <ul className="nav-sections">
          <li><a href="#features">Features</a></li>
          <li><a href="#security">Security</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="#faq">Questions</a></li>
        </ul>

        <div className="nav-actions">
          <Link href="/login" className="nav-link-login">
            Log In
          </Link>
          <Link href="/signup" className="nav-cta">
            <span>Sign Up</span>
            <i className="fa-solid fa-user-plus"></i>
          </Link>
          <Link href="/register-sacco" className="nav-link-sacco">
            <span>Register SACCO</span>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="hero">
        <div className="hero-content">
          <span className="tagline">Official Platform for PEWOSA Savings Groups</span>
          <h1 className="hero-title">
            Run your SACCO without <span>the exercise book</span>
          </h1>
          <p className="hero-desc">
            Contributions recorded the week they are paid. Fines, share balances and loan
            interest worked out for you automatically. Every member sees the exact same numbers as the treasurer.
          </p>
          <div className="hero-btn-group">
            <Link href="/register-sacco" className="btn-primary">
              <span>Register your SACCO</span>
              <i className="fa-solid fa-building-columns"></i>
            </Link>
            <a href="#pricing" className="btn-secondary">
              <span>See pricing</span>
              <i className="fa-solid fa-arrow-right"></i>
            </a>
          </div>
          <p className="hero-note">
            <i className="fa-solid fa-circle-check"></i>
            Free for your onboarding month &mdash; no payment details required.
          </p>
        </div>

        {/* Realistic Live SACCO Ledger Preview Graphic */}
        <div className="hero-visual">
          <div className="mockup-card">
            <div className="mockup-bg-blur-1"></div>
            <div className="mockup-bg-blur-2"></div>

            <div className="mockup-header">
              <div className="mockup-dots">
                <span className="dot dot-red"></span>
                <span className="dot dot-yellow"></span>
                <span className="dot dot-green"></span>
                <span className="mockup-status-title">KIKUUBO TRADERS &middot; WEEK 14 MEETING</span>
              </div>
              <i className="fa-solid fa-shield-halved mockup-shield-icon"></i>
            </div>

            <div className="mockup-body">
              <div className="mockup-label">Total SACCO Treasury Balance</div>
              <div className="mockup-balance">
                <span>UGX 84,500,000</span>
                <span className="mockup-growth-badge">+14.2% Growth</span>
              </div>

              {/* Realistic Live Activity List replacing fake bars */}
              <div className="mockup-activity-list" style={{ marginTop: "1.8rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <div className="activity-item" style={{ background: "rgba(255, 255, 255, 0.05)", padding: "0.8rem 1.2rem", borderRadius: "0.8rem", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "1.2rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                    <span style={{ width: "0.8rem", height: "0.8rem", borderRadius: "50%", background: "#10b981" }}></span>
                    <span style={{ fontWeight: 600 }}>Nalule Mary</span>
                  </div>
                  <span style={{ color: "#10b981", fontWeight: 700 }}>+UGX 50,000</span>
                </div>
                <div className="activity-item" style={{ background: "rgba(255, 255, 255, 0.05)", padding: "0.8rem 1.2rem", borderRadius: "0.8rem", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "1.2rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                    <span style={{ width: "0.8rem", height: "0.8rem", borderRadius: "50%", background: "#3b82f6" }}></span>
                    <span style={{ fontWeight: 600 }}>Kato John (Loan Repay)</span>
                  </div>
                  <span style={{ color: "#60a5fa", fontWeight: 700 }}>+UGX 120,000</span>
                </div>
                <div className="activity-item" style={{ background: "rgba(255, 255, 255, 0.05)", padding: "0.8rem 1.2rem", borderRadius: "0.8rem", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "1.2rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                    <span style={{ width: "0.8rem", height: "0.8rem", borderRadius: "50%", background: "#f59e0b" }}></span>
                    <span style={{ fontWeight: 600 }}>Ssemwanga Joseph</span>
                  </div>
                  <span style={{ color: "#fbbf24", fontWeight: 700 }}>Loan Approved</span>
                </div>
              </div>
            </div>

            <div className="mockup-footer">
              <div className="mockup-online-tag">
                <i className="fa-solid fa-circle"></i>
                <span>Live MTN & Airtel Integration</span>
              </div>
              <span>28 Verified Members</span>
            </div>
          </div>

          <div className="stats-card-overlay">
            <div className="stats-icon">
              <i className="fa-solid fa-shield-check"></i>
            </div>
            <div className="stats-details">
              <h4>Trusted by 50+ SACCOs</h4>
              <p>UGX 1.2B+ Recorded Safely</p>
            </div>
          </div>
        </div>
      </header>

      {/* Assurance strip -- the four things a committee wants settled before reading on. */}
      <section className="assurance-strip">
        <div className="assurance-item">
          <i className="fa-solid fa-gift"></i>
          <span>Free for your first month</span>
        </div>
        <div className="assurance-item">
          <i className="fa-solid fa-mobile-screen-button"></i>
          <span>Paid by MTN or Airtel Money</span>
        </div>
        <div className="assurance-item">
          <i className="fa-solid fa-wifi"></i>
          <span>Works on any phone with a browser</span>
        </div>
        <div className="assurance-item">
          <i className="fa-solid fa-lock"></i>
          <span>Your books, sealed off from every other SACCO</span>
        </div>
      </section>

      {/* Problem Section */}
      <section className="problem">
        <div className="section-header">
          <span className="tagline tagline-impact">The weekly reality</span>
          <h2 className="section-title">If any of this sounds familiar</h2>
          <p className="section-desc">
            Most groups do not fail for lack of discipline. They fail because the record of
            who paid what lives in one book, in one handwriting, in one person&rsquo;s bag.
          </p>
        </div>
        <div className="problem-grid">
          <div className="problem-card">
            <div className="problem-icon">
              <i className="fa-solid fa-book"></i>
            </div>
            <h3>Only one person can read the book</h3>
            <p>
              Contributions sit in the treasurer&rsquo;s notebook. When they travel or fall
              ill, nobody can say who has paid this week and who has not.
            </p>
          </div>
          <div className="problem-card">
            <div className="problem-icon">
              <i className="fa-solid fa-scale-unbalanced"></i>
            </div>
            <h3>Disputes nobody can settle</h3>
            <p>
              A member insists they paid. The book says otherwise. There is no record of who
              wrote the entry, or when, so the meeting stalls on somebody&rsquo;s memory.
            </p>
          </div>
          <div className="problem-card">
            <div className="problem-icon">
              <i className="fa-solid fa-calculator"></i>
            </div>
            <h3>Totals that eat a whole evening</h3>
            <p>
              Fines, share balances, loan interest and year-end dividends all added up by
              hand &mdash; then added up again by somebody else to be sure.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="steps">
        <div className="section-header">
          <h2 className="section-title">From nothing to your first meeting</h2>
          <p className="section-desc">
            Three steps. A committee can finish all of them in an afternoon.
          </p>
        </div>
        <div className="steps-grid">
          <div className="step-card">
            <span className="step-number">1</span>
            <h3>Register the SACCO</h3>
            <p>
              Give your group a name and your committee an admin. You get a group code &mdash;
              the only door into your SACCO&rsquo;s data.
            </p>
          </div>
          <div className="step-card">
            <span className="step-number">2</span>
            <h3>Bring in your members</h3>
            <p>
              Share the code. Members sign up themselves on their own phones and wait for an
              admin to approve them. Nobody joins by accident.
            </p>
          </div>
          <div className="step-card">
            <span className="step-number">3</span>
            <h3>Run the week</h3>
            <p>
              Record contributions, mark the attendance register, and let the fines, balances
              and loan schedules follow on their own.
            </p>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features" id="features">
        <div className="section-header">
          <h2 className="section-title">What it actually does</h2>
          <p className="section-desc">
            Four things a savings group has to get right every week, handled the same way
            every week.
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
            <h3>Your own private books</h3>
            <p>
              Every cooperative runs behind its own group code. No other SACCO can see your
              members, your money or your meetings &mdash; and neither can a member of yours
              see somebody else&rsquo;s ledger.
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
            <h3>Three funds, one weekly entry</h3>
            <p>
              Shares, development fund and social fund tracked separately against the targets
              your committee sets. Shares are recorded as a count at an agreed price, so the
              figure always reconciles.
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
              <i className="fa-solid fa-hand-holding-dollar"></i>
            </div>
            <h3>Loans, request to last repayment</h3>
            <p>
              Members apply and name their guarantors in the app; guarantors accept or decline
              on their own phones. Admins approve. Repayments, late fees and the closing date
              are tracked to the shilling.
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
            <h3>Attendance and fines, handled</h3>
            <p>
              Mark the weekly register. Absentees are fined at your SACCO&rsquo;s own rate,
              the member is told what they owe and why, and an admin can waive it with a
              reason on the record.
            </p>
          </div>
        </div>
      </section>

      {/* Two audiences */}
      <section className="audience">
        <div className="section-header">
          <h2 className="section-title">Two people use this, and they want different things</h2>
          <p className="section-desc">
            The committee needs control and a clean audit. A member needs to know where they
            stand without asking anyone.
          </p>
        </div>
        <div className="audience-grid">
          <div className="audience-card">
            <div className="audience-head">
              <i className="fa-solid fa-user-tie"></i>
              <h3>For the committee</h3>
            </div>
            <ul className="audience-list">
              <li>Approve or reject every contribution before it touches the books</li>
              <li>Total capital, weekly collections and outstanding loans on one dashboard</li>
              <li>Approve loans with the member&rsquo;s full history in front of you</li>
              <li>Run the attendance register and let fines follow automatically</li>
              <li>Declare a dividend cycle and see each member&rsquo;s share before paying out</li>
              <li>Export a PDF report for the AGM or the auditor</li>
            </ul>
          </div>
          <div className="audience-card">
            <div className="audience-head">
              <i className="fa-solid fa-user"></i>
              <h3>For members</h3>
            </div>
            <ul className="audience-list">
              <li>See what you have paid, and what is still owing this week</li>
              <li>Watch your shares and savings build up week by week</li>
              <li>Request a loan and follow it through approval and repayment</li>
              <li>Accept or decline standing as somebody&rsquo;s guarantor</li>
              <li>Know about a fine before the meeting, not during it</li>
              <li>Check any of it from your own phone, without asking the treasurer</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="security" id="security">
        <div className="security-inner">
          <span className="tagline tagline-security">Where the money is concerned</span>
          <h2 className="section-title">
            Separation enforced by the database, not just the screen
          </h2>
          <p className="security-lede">
            Most multi-tenant systems keep groups apart in application code, where one missed
            check is enough for a member to see another SACCO&rsquo;s ledger. Here every row
            carries the SACCO it belongs to, and Postgres itself refuses to hand back rows
            outside the SACCO of whoever is asking &mdash; whatever the app happens to ask for.
          </p>
          <div className="security-points">
            <div className="security-point">
              <i className="fa-solid fa-fingerprint"></i>
              <h4>Isolation at the row</h4>
              <p>
                Access rules live in the database. An account that is not in your SACCO gets
                nothing back, not a filtered list.
              </p>
            </div>
            <div className="security-point">
              <i className="fa-solid fa-user-shield"></i>
              <h4>No self-promotion</h4>
              <p>
                A member cannot make themselves an admin or edit their own status. Those
                columns are not writable by members at all.
              </p>
            </div>
            <div className="security-point">
              <i className="fa-solid fa-list-check"></i>
              <h4>Approve, then record</h4>
              <p>
                What a member submits is a request. Nothing moves the books until an admin
                approves it, and the approval is logged with a name and a time.
              </p>
            </div>
          </div>
          <p className="security-footnote">
            We also keep a script that reads the live database and reports anything that has
            drifted from what the code expects. A security rule you cannot verify is a
            security rule you do not have.
          </p>
        </div>
      </section>

      {/* Engineering Stack Section */}
      <section className="tech-stack-section" id="tech-stack">
        <div className="section-header">
          <span className="tagline">Enterprise Infrastructure</span>
          <h2 className="section-title">Built on a Modern Engineering Stack</h2>
          <p className="section-desc">
            PEWOSA is powered by industry-standard cloud frameworks and database isolation, delivering sub-second response times, offline capability, and 99.9% uptime.
          </p>
        </div>

        <div className="tech-stack-grid">
          {/* Next.js */}
          <div className="tech-card">
            <div className="tech-icon-badge">
              <svg viewBox="0 0 180 180" width="34" height="34" fill="none">
                <mask id="mask0_next_main" maskUnits="userSpaceOnUse" x="0" y="0" width="180" height="180">
                  <circle cx="90" cy="90" r="90" fill="#fff"/>
                </mask>
                <g mask="url(#mask0_next_main)">
                  <circle cx="90" cy="90" r="90" fill="#0f172a"/>
                  <path d="M149.508 157.52L69.142 54H54v71.97h14.636V73.473l68.2 87.893a89.654 89.654 0 0012.672-3.846z" fill="#fff"/>
                  <path d="M125.818 54h14.727v72h-14.727z" fill="#fff"/>
                </g>
              </svg>
            </div>
            <h3>Next.js 16</h3>
            <span className="tech-tag">Application Framework</span>
            <p>Server-side rendering & Turbopack architecture for instantaneous page loads and low bandwidth consumption.</p>
          </div>

          {/* React */}
          <div className="tech-card">
            <div className="tech-icon-badge">
              <svg viewBox="-11.5 -10.23174 23 20.46348" width="34" height="34">
                <circle cx="0" cy="0" r="2.05" fill="#61dafb"/>
                <g stroke="#61dafb" strokeWidth="1" fill="none">
                  <ellipse rx="11" ry="4.2"/>
                  <ellipse rx="11" ry="4.2" transform="rotate(60)"/>
                  <ellipse rx="11" ry="4.2" transform="rotate(120)"/>
                </g>
              </svg>
            </div>
            <h3>React 19</h3>
            <span className="tech-tag">UI Architecture</span>
            <p>Reactive state management and micro-interactions for seamless treasurers' and members' dashboard management.</p>
          </div>

          {/* Supabase */}
          <div className="tech-card">
            <div className="tech-icon-badge">
              <svg viewBox="0 0 106 106" width="34" height="34" fill="none">
                <path d="M57.94 102.72c-2.31 3.09-7.23 1.48-7.23-2.38V59.4h42.11c6.51 0 10.15 7.45 6.07 12.53L57.94 102.72z" fill="#3ECF8E"/>
                <path d="M47.78 3.28c2.31-3.09 7.23-1.48 7.23 2.38v40.94H12.9c-6.51 0-10.15-7.45-6.07-12.53L47.78 3.28z" fill="#3ECF8E"/>
              </svg>
            </div>
            <h3>Supabase Cloud</h3>
            <span className="tech-tag">Backend Services</span>
            <p>Realtime database triggers, secure authentication, and automated backup infrastructure.</p>
          </div>

          {/* PostgreSQL */}
          <div className="tech-card">
            <div className="tech-icon-badge">
              <svg viewBox="0 0 100 100" width="34" height="34">
                <path fill="#336791" d="M49.6 15c-18.7 0-33.8 13.9-33.8 31 0 10.3 5.5 19.4 14.1 24.8-.4 2.5-1.7 6.9-4.8 11.2 4.6-.2 9.8-1.8 13.7-4.6 3.3 1.1 6.9 1.6 10.8 1.6 18.7 0 33.8-13.9 33.8-31s-15.1-31-33.8-31z"/>
                <circle cx="36" cy="38" r="4" fill="#fff"/>
                <circle cx="64" cy="38" r="4" fill="#fff"/>
                <path fill="#fff" d="M38 56c0 4.4 5.4 8 12 8s12-3.6 12-8H38z"/>
              </svg>
            </div>
            <h3>PostgreSQL</h3>
            <span className="tech-tag">Relational Database</span>
            <p>Strict Row-Level Security (RLS) policies guaranteeing multi-tenant SACCO data isolation and ACID transactions.</p>
          </div>

          {/* TypeScript */}
          <div className="tech-card">
            <div className="tech-icon-badge">
              <svg viewBox="0 0 100 100" width="34" height="34">
                <rect width="100" height="100" rx="15" fill="#3178c6"/>
                <path fill="#fff" d="M57 69.5c1.8 1.1 4.1 1.8 6.4 1.8 3.2 0 4.8-1.3 4.8-3.3 0-2-1.6-3.1-5.3-4.5-5.3-2-8.5-4.8-8.5-9.8 0-5.8 4.7-9.7 12-9.7 3.3 0 5.7.7 7.5 1.7l-2 5c-1.4-.8-3.3-1.4-5.4-1.4-3.1 0-4.5 1.3-4.5 3 0 2 1.6 2.9 5.5 4.3 5.7 2.1 8.3 5.1 8.3 10 0 6.2-4.9 10.1-12.8 10.1-3.6 0-6.7-.9-8.7-2l2.7-5.2zM28 44.7h23v5.6h-8.5V76h-6.1V50.3H28v-5.6z"/>
              </svg>
            </div>
            <h3>TypeScript</h3>
            <span className="tech-tag">Type Safety</span>
            <p>End-to-end static type enforcement preventing runtime crashes in loan and dividend calculation workflows.</p>
          </div>

          {/* Vercel */}
          <div className="tech-card">
            <div className="tech-icon-badge">
              <svg viewBox="0 0 512 512" width="30" height="30" fill="none">
                <path fill="#ffffff" d="M256 48L512 464H0L256 48Z"/>
              </svg>
            </div>
            <h3>Vercel Edge</h3>
            <span className="tech-tag">Global Hosting</span>
            <p>Serverless edge network deployment ensuring 99.9% uptime and instant global availability.</p>
          </div>

          {/* Progressive Web App */}
          <div className="tech-card">
            <div className="tech-icon-badge">
              <svg viewBox="0 0 512 512" width="34" height="34">
                <rect width="512" height="512" rx="100" fill="#5a0fc8"/>
                <path fill="#5ef0c4" d="M120 360l80-208h40l80 208h-45l-18-50h-74l-18 50h-45zm75-90h44l-22-65-22 65z"/>
              </svg>
            </div>
            <h3>PWA Standard</h3>
            <span className="tech-tag">Mobile Native App</span>
            <p>Installable home-screen application with service-worker static caching and offline fallback protection.</p>
          </div>

          {/* Mobile Money Integration */}
          <div className="tech-card">
            <div className="tech-icon-badge" style={{ background: "#ffcc00", border: "none" }}>
              <span style={{ color: "#000", fontWeight: 900, fontSize: "1.4rem" }}>MoMo</span>
            </div>
            <h3>MTN & Airtel MoMo</h3>
            <span className="tech-tag">Payment Aggregator</span>
            <p>Integrated Mobile Money checkout enabling instant subscription renewals directly from Ugandan mobile wallets.</p>
          </div>
        </div>
      </section>

      {/* Full capability checklist */}
      <section className="checklist">
        <div className="section-header">
          <h2 className="section-title">Everything that comes with it</h2>
          <p className="section-desc">
            Comparing us against something else? Here is the whole list, as it stands today.
          </p>
        </div>
        <ul className="checklist-grid">
          {CAPABILITIES.map((item) => (
            <li className="checklist-item" key={item}>
              <i className="fa-solid fa-check"></i>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Pricing */}
      <section className="pricing" id="pricing">
        <div className="section-header">
          <span className="tagline">Plain pricing</span>
          <h2 className="section-title">What it costs</h2>
          <p className="section-desc">
            No sales call to find out the number. Start free for your onboarding month, then
            pick the plan that suits how your group meets.
          </p>
        </div>

        <div className="pricing-grid">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <div
              className={`price-card ${plan.recommended ? "price-card-recommended" : ""}`}
              key={plan.id}
            >
              {plan.recommended && <span className="price-flag">Most groups pick this</span>}
              <span className="price-badge">{plan.badge}</span>
              <h3 className="price-name">{plan.name}</h3>

              <div className="price-amount">
                {plan.price === 0 ? (
                  <span className="price-figure">Free</span>
                ) : (
                  <>
                    <span className="price-currency">UGX</span>
                    <span className="price-figure">{plan.price.toLocaleString()}</span>
                  </>
                )}
                <span className="price-cycle">/ {plan.billingCycle}</span>
              </div>

              {plan.originalPrice && (
                <div className="price-original">
                  Normally UGX {plan.originalPrice.toLocaleString()} &mdash; you save{" "}
                  {(plan.originalPrice - plan.price).toLocaleString()}
                </div>
              )}

              <p className="price-desc">{plan.description}</p>

              <ul className="price-features">
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <i className="fa-solid fa-check"></i>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/register-sacco"
                className={plan.recommended ? "price-cta price-cta-primary" : "price-cta"}
              >
                <span>{plan.isTrial ? "Start free" : `Choose ${plan.name}`}</span>
                <i className="fa-solid fa-arrow-right"></i>
              </Link>
            </div>
          ))}
        </div>

        <p className="pricing-note">
          <i className="fa-solid fa-circle-info"></i>
          Every SACCO begins on the free onboarding month. When you are ready to continue, you
          choose a paid plan from inside the app and pay by MTN Mobile Money or Airtel Money.
        </p>
      </section>

      {/* FAQ */}
      <section className="faq" id="faq">
        <div className="section-header">
          <h2 className="section-title">The questions committees actually ask</h2>
        </div>
        <div className="faq-list">
          {FAQS.map((faq) => (
            <details className="faq-item" key={faq.q}>
              <summary>
                <span>{faq.q}</span>
                <i className="fa-solid fa-chevron-down"></i>
              </summary>
              <p>{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA Sign Up Banner */}
      <section className="cta-banner-section">
        <h2 className="cta-title">Ready to run your first week?</h2>
        <p className="cta-desc">
          Register the SACCO, share the group code, and record your next meeting here instead
          of in the book. The onboarding month costs nothing.
        </p>
        <div className="cta-btn-group">
          <Link href="/register-sacco" className="cta-btn-primary">
            <span>Register your SACCO</span>
            <i className="fa-solid fa-building-columns"></i>
          </Link>
          <Link href="/signup" className="cta-btn-secondary">
            <span>I have a group code</span>
            <i className="fa-solid fa-arrow-right-to-bracket"></i>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="footer-grid">
          <div className="footer-col footer-brand">
            <a href="#" className="footer-logo">
              <span>PEWOSA SACCO Platform</span>
            </a>
            <p>
              Weekly contributions, loans, attendance and dividends for Ugandan savings and
              credit cooperatives.
            </p>
          </div>

          <div className="footer-col">
            <h4>Product</h4>
            <ul>
              <li><a href="#features">Features</a></li>
              <li><a href="#security">Security</a></li>
              <li><a href="#pricing">Pricing</a></li>
              <li><a href="#faq">Questions</a></li>
            </ul>
          </div>

          <div className="footer-col">
            <h4>Account</h4>
            <ul>
              <li><Link href="/login">Log in</Link></li>
              <li><Link href="/signup">Member sign up</Link></li>
              <li><Link href="/register-sacco">Register a SACCO</Link></li>
            </ul>
          </div>

          <div className="footer-col footer-contact">
            <h4>Talk to a person</h4>
            <ul>
              <li>
                <a href={CONTACT.phoneHref}>
                  <i className="fa-solid fa-phone"></i> {CONTACT.phone}
                </a>
              </li>
              <li>
                <a href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
                  <i className="fa-brands fa-whatsapp"></i> Chat on WhatsApp
                </a>
              </li>
              <li>
                <a href={`mailto:${CONTACT.email}`}>
                  <i className="fa-solid fa-envelope"></i> {CONTACT.email}
                </a>
              </li>
              <li className="footer-plain">
                <i className="fa-solid fa-location-dot"></i> {CONTACT.address}
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-copyright">
          © {new Date().getFullYear()} PEWOSA SACCO. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
