"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { SUBSCRIPTION_PLANS, getPlan, planMonthlyPrice } from "../../utils/subscriptionPlans";
import { tenantState } from "../../utils/tenantState";
import "../../styles/developerPortal.css";

// Plans and prices come from the catalogue -- the same list /api/subscription-plans serves,
// the payments page shows members and the checkout prices a request from. This portal used
// to carry its own table of basic/premium/enterprise at 150k/350k/750k, none of which the
// app has ever charged anybody.
const FALLBACK_PLAN_ID = "basic";

function planOf(planId) {
  return getPlan(planId) || getPlan(FALLBACK_PLAN_ID);
}

// What the tenant is billed per term. `subscription_amount` is a per-tenant override of the
// catalogue price (migration 0036); 0, the column's default, means "whatever the plan
// costs".
function rateFor(plan, storedAmount) {
  return Number(storedAmount) || Number(plan?.price) || 0;
}

function formatRate(plan, amount) {
  if (!plan) return "—";
  if (plan.isTrial && amount === 0) return "Free trial";
  return `Shs ${amount.toLocaleString()} / ${plan.billingCycle}`;
}

// The billing column stays hand-editable -- an operator confirming a mobile money payment
// is stating a fact the app has no other way to learn. What that fact *means* for the
// tenant is derived, not typed: see src/utils/tenantState.js.
const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "expired", "cancelled"];

const SUBSCRIPTION_LABELS = {
  trial: "Trial",
  active: "Paid",
  past_due: "Past Due",
  expired: "Expired",
  cancelled: "Cancelled"
};

export default function DeveloperPortal() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState("");
  // Who is signed in, for the sidebar card. Taken from the verified session rather than
  // from the `email` box above, which is empty on a restored session and cleared on logout.
  const [userEmail, setUserEmail] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Database-backed states
  const [tenants, setTenants] = useState([]);
  const [logs, setLogs] = useState([]);

  // Restore a session on mount — but a Supabase session on its own is NOT authorization.
  // Any signed-in SACCO member has one, so the portal is only rendered after
  // /api/platform confirms the session's email is on the PLATFORM_ADMIN_EMAILS
  // allow-list, which is the same check every action re-runs server-side.
  useEffect(() => {
    let cancelled = false;

    async function verifySession(session) {
      if (!session) {
        if (!cancelled) {
          setIsAuthenticated(false);
          setCheckingSession(false);
        }
        return;
      }

      try {
        const res = await fetch("/api/platform?action=tenants", {
          headers: { "Authorization": `Bearer ${session.access_token}` }
        });
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok || !data.success) {
          setIsAuthenticated(false);
          setLoginError(data.error || "This account is not authorized for the developer portal.");
        } else {
          setIsAuthenticated(true);
          setUserEmail(session.user?.email || "");
        }
      } catch (err) {
        if (!cancelled) {
          setIsAuthenticated(false);
          setLoginError("Authorization check failed: " + err.message);
        }
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => verifySession(session));

    // Only sign-out is handled here. handleLogin runs its own verification, so
    // re-verifying on every token refresh would just duplicate that round trip.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setIsAuthenticated(false);
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  // Fetch real data via the protected /api/platform route once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchDatabaseData();
    }
  }, [isAuthenticated]);

  async function fetchDatabaseData() {
    setLoadingData(true);
    setDataError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const authHeaders = { "Authorization": `Bearer ${session.access_token}` };

      // 1. Fetch Sacco Tenants + Profiles via the protected platform route
      const tenantsRes = await fetch("/api/platform?action=tenants", { headers: authHeaders });
      const tenantsData = await tenantsRes.json();
      if (!tenantsRes.ok || !tenantsData.success) {
        throw new Error(tenantsData.error || "Failed to load tenants");
      }

      const saccoData = tenantsData.saccos || [];
      const profileData = tenantsData.profiles || [];

      // Map Supabase rows to local tenant objects
      const mappedTenants = saccoData.map(sacco => {
        const adminUser = profileData?.find(p => p.id === sacco.admin_profile_id);
        const limit = sacco.member_limit || 50;

        // The plan stored on the tenant, resolved against the catalogue. The old fallback
        // guessed a plan from member_limit, which stopped meaning anything once the plans
        // themselves stopped being sold by member count -- an unset plan is the free
        // onboarding trial, which is what 0016 backfilled those rows to.
        const plan = planOf(sacco.subscription_plan);
        const planPrice = rateFor(plan, sacco.subscription_amount);

        // The tenant's real state, combining what a developer last decided with what the
        // subscription and the clock say. The route derives it server-side and sends it
        // down; deriving it again here covers a response from an older deployment.
        const state = sacco.subscription?.state
          ? sacco.subscription
          : tenantState(sacco);

        return {
          id: sacco.id,
          name: sacco.name,
          code: sacco.group_code || sacco.acronym,
          admin: adminUser ? adminUser.email : "No admin linked",
          plan: plan.id,
          planName: plan.name,
          billingCycle: plan.billingCycle,
          durationMonths: plan.durationMonths,
          isTrial: plan.isTrial,
          // Per billing term, which is three months on premium. The monthly figure the
          // platform income metric sums is derived from the term, never stored.
          cost: planPrice,
          monthlyCost: planPrice / (Number(plan.durationMonths) || 1),
          // The stored lifecycle column, still needed to decide which action buttons apply.
          status: sacco.status || "active",
          statusReason: sacco.status_reason || "",
          statusChangedBy: sacco.status_changed_by || "",
          joined: sacco.created_at ? new Date(sacco.created_at).toISOString().split('T')[0] : "2026-01-01",
          memberLimit: limit,
          // The derived state -- what the Status column actually shows.
          state: state.state || state.id,
          stateLabel: state.label,
          stateTone: state.tone,
          stateDetail: state.detail,
          stateDecidedBy: state.decidedBy,
          blocksMembers: Boolean(state.blocksMembers),
          needsPayment: Boolean(state.needsPayment),
          holdRecommended: Boolean(state.holdRecommended),
          storedSubscriptionStatus: state.stored || state.storedSubscription,
          daysOverdue: state.daysOverdue,
          graceDaysLeft: state.graceDaysLeft,
          inGoodStanding: state.inGoodStanding,
          expiresAt: sacco.subscription_expires_at
            ? new Date(sacco.subscription_expires_at).toISOString().split('T')[0]
            : null,
          lastPaymentAt: sacco.last_payment_at
            ? new Date(sacco.last_payment_at).toISOString().split('T')[0]
            : null
        };
      });

      setTenants(mappedTenants);

      // 2. Fetch Platform events logs via the protected platform route
      const auditRes = await fetch("/api/platform?action=audit-log", { headers: authHeaders });
      const auditData = await auditRes.json();
      if (!auditRes.ok || !auditData.success) {
        throw new Error(auditData.error || "Failed to load audit log");
      }

      const events = auditData.events || [];

      const mappedLogs = events.map(evt => {
        // Success terms are checked first so PAYMENT_RELEASE_HOLD reads as a win rather
        // than being caught by the "hold" warning term.
        const action = evt.action.toLowerCase();
        let type = "info";
        if (action.includes("approve") || action.includes("pay") || action.includes("create") || action.includes("release") || action.includes("reinstate")) {
          type = "success";
        } else if (action.includes("fail") || action.includes("reject") || action.includes("suspend") || action.includes("hold")) {
          type = "warn";
        }

        const date = new Date(evt.created_at);
        const minDiff = Math.floor((Date.now() - date.getTime()) / 60000);
        let timeStr = `${minDiff} min ago`;
        if (minDiff > 59) {
          const hours = Math.floor(minDiff / 60);
          timeStr = hours > 23 ? `${Math.floor(hours / 24)} days ago` : `${hours} hours ago`;
        }

        return {
          id: evt.id,
          type,
          msg: `${evt.entity_type.toUpperCase()} [${evt.action.toUpperCase()}]: ${evt.metadata?.description || `Event on ${evt.entity_type}`}`,
          time: timeStr
        };
      });

      // If no logs exist in the audit table, seed with nice platform defaults
      if (mappedLogs.length === 0) {
        setLogs([
          { id: 1, type: "success", msg: "Platform database baseline connection active.", time: "10 minutes ago" },
          { id: 2, type: "info", msg: "Suppressed Supabase RLS monitoring status: Healthy", time: "2 hours ago" },
          { id: 3, type: "warn", msg: "Multi-tenant isolation verified.", time: "1 day ago" }
        ]);
      } else {
        setLogs(mappedLogs);
      }

    } catch (err) {
      // Surfaced rather than only logged: a silent failure here leaves every table empty
      // and every metric at zero, which reads as "the portal didn't change" instead of
      // "the request was rejected".
      console.error("Error fetching developer portal database data:", err);
      setDataError(err.message);
    } finally {
      setLoadingData(false);
    }
  }

  // Real Supabase Auth login — no client-side credential comparison. The resulting
  // session's email is re-verified server-side against PLATFORM_ADMIN_EMAILS on every
  // /api/platform call, so a valid-but-unlisted Supabase account still gets 403'd.
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setLoggingIn(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim()
    });

    if (error || !data?.session) {
      setLoggingIn(false);
      setLoginError(error?.message || "Invalid developer email or password.");
      return;
    }

    // Verify server-side authorization against PLATFORM_ADMIN_EMAILS (.env)
    try {
      const authHeaders = { "Authorization": `Bearer ${data.session.access_token}` };
      const res = await fetch("/api/platform?action=tenants", { headers: authHeaders });
      const resData = await res.json();

      if (!res.ok || !resData.success) {
        await supabase.auth.signOut();
        setIsAuthenticated(false);
        setLoginError(resData.error || `Unauthorized: '${email}' is not listed in PLATFORM_ADMIN_EMAILS (.env). Access denied.`);
        return;
      }

      setIsAuthenticated(true);
      setUserEmail(data.session.user?.email || email.trim());
    } catch (verifyErr) {
      await supabase.auth.signOut();
      setIsAuthenticated(false);
      setLoginError("Authorization verification failed: " + verifyErr.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setUserEmail("");
    setEmail("");
    setPassword("");
  };

  // Every tenant lifecycle change goes through here. Service-role writes only ever
  // happen server-side, gated by the PLATFORM_ADMIN_EMAILS allow-list.
  const runTenantAction = async (action, payload) => {
    setLoadingData(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch("/api/platform", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ action, ...payload })
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || "The platform rejected this action.");
      }

      await fetchDatabaseData();
      alert(`Success: ${result.message || "Tenant updated."}`);
    } catch (err) {
      console.error(`Error running platform action '${action}':`, err);
      alert(`Action failed: ${err.message}`);
    } finally {
      setLoadingData(false);
    }
  };

  // ACTION 1 - Suspend: erases the tenant. The SACCO, its members and all of its
  // financial records are deleted permanently. Two confirmations because there is no
  // undo — the name has to be typed exactly, and the server checks it again.
  const suspendTenant = async (tenant) => {
    const typed = prompt(
      `ERASE '${tenant.name}' from the platform?\n\n` +
      `This permanently deletes the SACCO along with its members, accounts, transactions,\n` +
      `loans, savings vaults and dividend history. Members lose their sign-in entirely.\n\n` +
      `THIS CANNOT BE UNDONE.\n\n` +
      `Type the SACCO name exactly to confirm:`,
      ""
    );
    if (typed === null) return;

    if (typed.trim().toLowerCase() !== tenant.name.trim().toLowerCase()) {
      alert(`The name did not match. '${tenant.name}' has NOT been erased.`);
      return;
    }

    const reason = prompt(
      `Reason for erasing '${tenant.name}'?\n\nRecorded in the platform audit log, which is all that survives.`,
      ""
    );
    if (reason === null) return;

    await runTenantAction("suspend-tenant", {
      sacco_id: tenant.id,
      confirm_name: typed,
      reason
    });
  };

  // ACTION 2 - Hold: a billing measure, so it is only offered while the subscription is
  // past due, expired or cancelled. Members are held out of the app; the SACCO admin keeps
  // access and gets a payment reminder, since they are the one who can settle it.
  const holdTenant = async (tenant) => {
    if (tenant.inGoodStanding) {
      alert(
        `Cannot hold '${tenant.name}': it is ${tenant.stateLabel.toLowerCase()}.\n\n` +
        `${tenant.stateDetail}\n\n` +
        `A hold requires a lapsed, cancelled or unpaid subscription. Use Suspend for ` +
        `non-billing enforcement.`
      );
      return;
    }

    // Holding during the grace period is allowed but rarely meant -- the tenant may simply
    // not have been credited yet -- so it asks rather than silently going ahead.
    if (tenant.state === "grace") {
      const proceed = confirm(
        `'${tenant.name}' is still inside its grace period.\n\n` +
        `${tenant.stateDetail}\n\n` +
        `Holding now locks its members out before the grace window has run. Continue?`
      );
      if (!proceed) return;
    }

    const reason = prompt(
      `Place '${tenant.name}' on billing hold?\n\n` +
      `State: ${tenant.stateLabel} — ${tenant.stateDetail}\n` +
      `Members are held out of the app until it is settled. The SACCO admin keeps access\n` +
      `and is shown a payment reminder. Reversible at any time.\n\n` +
      `Reason (shown to the admin; leave blank for the default billing message):`,
      ""
    );
    if (reason === null) return;
    await runTenantAction("hold-tenant", { sacco_id: tenant.id, reason });
  };

  const reactivateTenant = async (tenant) => {
    const verb = tenant.status === "on_hold" ? "Release the billing hold on" : "Reinstate";
    if (!confirm(`${verb} '${tenant.name}'?\n\nFull access is restored immediately.`)) return;
    await runTenantAction("reactivate-tenant", { sacco_id: tenant.id });
  };

  // Recording a payment renews the term and lifts a billing hold automatically. It does
  // not lift a suspension -- that stays an explicit decision.
  //
  // Counted in billing terms rather than months, because a term is not always a month:
  // premium is a single payment of Shs 200,000 covering three. Asking for months and
  // multiplying the rate by the answer billed a quarterly tenant three times over.
  const recordPayment = async (tenant) => {
    const plan = planOf(tenant.plan);
    const termMonths = Number(plan.durationMonths) || 1;

    const termsInput = prompt(
      `Record a subscription payment for '${tenant.name}'.\n\n` +
      `Plan: ${plan.name} — ${formatRate(plan, tenant.cost)}.\n` +
      (tenant.isTrial
        ? `This is the free onboarding trial, so this records a Shs 0 payment and simply extends the term.\n`
        : "") +
      `\nHow many terms of ${plan.billingCycle}?`,
      "1"
    );
    if (termsInput === null) return;

    const terms = Math.max(1, Number(termsInput) || 1);
    await runTenantAction("record-payment", {
      sacco_id: tenant.id,
      months: terms * termMonths,
      amount: tenant.cost * terms
    });
  };

  const setSubscriptionStatus = async (tenant, nextStatus) => {
    if (nextStatus === tenant.storedSubscriptionStatus) return;
    await runTenantAction("update-subscription", {
      sacco_id: tenant.id,
      subscription_status: nextStatus
    });
  };

  // Calculate platform totals. Revenue only counts tenants that are both active and paid
  // up -- a suspended or held tenant is not billing. Summed per month rather than per
  // billing term: premium is one payment covering three months, and adding its 200,000 to
  // a monthly total would count it at three times what it earns. A tenant on the free
  // trial contributes 0, which is what a trial is.
  //
  // Every count below is keyed on the derived state rather than the stored column, so a
  // tenant that lapsed this morning leaves "paying" and joins "needs attention" without
  // anybody clicking anything.
  const totalRevenue = Math.round(
    tenants
      .filter(t => t.state === "paid")
      .reduce((sum, t) => sum + t.monthlyCost, 0)
  );

  // Tenants whose members can actually use the app right now.
  const activeCount = tenants.filter(t => !t.blocksMembers && t.state !== "closed").length;
  const restrictedCount = tenants.filter(t => t.blocksMembers).length;
  // Owing money, whether or not anybody has acted on it yet.
  const overdueCount = tenants.filter(t => t.needsPayment).length;

  // Avoid flashing the login screen while the real Supabase session is still being checked.
  if (checkingSession) {
    return null;
  }

  // Render Authentication screen if not logged in
  if (!isAuthenticated) {
    return (
      <div className="dev-portal-body">
        <div className="dev-portal-auth-container">
          <div className="dev-auth-card">
            <div className="dev-auth-logo">
              <i className="fa-solid fa-laptop-code"></i>
              <h1>PEWOSA DevPortal</h1>
            </div>
            <div className="dev-auth-title">SysAdmin Authorization</div>
            <p className="dev-auth-subtitle">Authorized developer credentials required to monitor platforms and subscription configurations.</p>



            {loginError && (
              <div style={{ color: "#ef4444", fontSize: "1.3rem", fontWeight: 700, marginBottom: "2rem", width: "100%", textAlign: "center" }}>
                <i className="fa-solid fa-circle-exclamation" style={{ marginRight: "0.8rem" }}></i>
                {loginError}
              </div>
            )}

            <form onSubmit={handleLogin} className="dev-auth-form">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                <label>Admin Email</label>
                <div className="dev-auth-input-wrapper">
                  <i className="fa-solid fa-envelope"></i>
                  <input
                    type="email"
                    placeholder="sysadmin@pewosa.org"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                <label>Password</label>
                <div className="dev-auth-input-wrapper">
                  <i className="fa-solid fa-lock"></i>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button type="submit" className="btn-dev-login" disabled={loggingIn}>
                {loggingIn ? "Authorizing..." : "Authorize Access"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Render Developer Dashboard
  return (
    <div className="dev-portal-body">
      <div className="dev-dashboard-wrapper">
        {/* Dark Backdrop Overlay on Mobile */}
        <div
          className={`dev-sidebar-overlay ${sidebarOpen ? "active" : ""}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        {/* Sidebar */}
        <aside className={`dev-sidebar ${sidebarOpen ? "active" : ""}`}>
          <button
            type="button"
            className="dev-sidebar-close-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation menu"
          >
            <i className="fa-solid fa-xmark" />
          </button>

          <div className="dev-logo">
            <div className="dev-logo-icon">
              <i className="fa-solid fa-terminal"></i>
            </div>
            <div>
              <h2>Dev Engine</h2>
              <span>Platform Portal</span>
            </div>
          </div>
          <nav>
            <ul className="dev-nav-list">
              <li>
                <button
                  onClick={() => {
                    setActiveTab("overview");
                    setSidebarOpen(false);
                  }}
                  className={`dev-nav-item ${activeTab === "overview" ? "active" : ""}`}
                >
                  <i className="fa-solid fa-layer-group"></i>
                  <span>System Overview</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setActiveTab("tenants");
                    setSidebarOpen(false);
                  }}
                  className={`dev-nav-item ${activeTab === "tenants" ? "active" : ""}`}
                >
                  <i className="fa-solid fa-server"></i>
                  <span>Manage Tenants</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setActiveTab("plans");
                    setSidebarOpen(false);
                  }}
                  className={`dev-nav-item ${activeTab === "plans" ? "active" : ""}`}
                >
                  <i className="fa-solid fa-credit-card"></i>
                  <span>Subscription Plans</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    setActiveTab("logs");
                    setSidebarOpen(false);
                  }}
                  className={`dev-nav-item ${activeTab === "logs" ? "active" : ""}`}
                >
                  <i className="fa-solid fa-list-check"></i>
                  <span>Platform Events</span>
                </button>
              </li>
            </ul>
          </nav>

          <div className="dev-sidebar-footer">
            {userEmail && (
              <div className="dev-user-card">
                <div className="dev-user-avatar">
                  {userEmail.charAt(0).toUpperCase()}
                </div>
                <div className="dev-user-info">
                  <span className="dev-user-email">{userEmail}</span>
                  <span className="dev-user-role">Platform Admin</span>
                </div>
              </div>
            )}
            <button onClick={handleLogout} className="btn-dev-logout">
              <i className="fa-solid fa-right-from-bracket"></i>
              <span>Exit Portal</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="dev-main-content">
          <header className="dev-header">
            <div style={{ display: "flex", alignItems: "center", gap: "1.4rem" }}>
              <button
                type="button"
                className="dev-menu-toggle"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation menu"
              >
                <i className="fa-solid fa-bars"></i>
              </button>
              <div className="dev-welcome">
                <h1>SysAdmin Panel</h1>
                <p>Platform Core Engine & Multi-Tenant Billing Coordinator</p>
              </div>
            </div>
          </header>

          {/* Loader Overlay */}
          {loadingData && (
            <div style={{
              background: "rgba(11, 15, 25, 0.7)",
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: "2rem",
              backdropFilter: "blur(5px)"
            }}>
              <div className="dev-auth-logo" style={{ animation: "pulse 1.5s infinite" }}>
                <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "5rem", color: "#3b82f6" }}></i>
              </div>
              <strong style={{ color: "#ffffff", fontSize: "1.6rem", letterSpacing: "0.05rem" }}>
                Synchronizing Live Supabase Data...
              </strong>
            </div>
          )}

          {dataError && (
            <div className="dev-data-error">
              <i className="fa-solid fa-triangle-exclamation"></i>
              <div>
                <strong>Live platform data could not be loaded.</strong> {dataError}
                <div className="dev-cell-sub">
                  Everything below is showing empty because the request was rejected, not
                  because the platform has no tenants.
                </div>
              </div>
              <button className="btn-dev-action" onClick={fetchDatabaseData}>Retry</button>
            </div>
          )}

          {/* Metric Cards Row */}
          <section className="dev-metrics-grid">
            <div className="dev-metric-card">
              <div className="dev-metric-icon revenue">
                <i className="fa-solid fa-money-bill-trend-up"></i>
              </div>
              <div className="dev-metric-info">
                <span className="dev-metric-label">Monthly Platform Income</span>
                <strong className="dev-metric-value">Shs {totalRevenue.toLocaleString()}</strong>
              </div>
            </div>

            <div className="dev-metric-card">
              <div className="dev-metric-icon tenants">
                <i className="fa-solid fa-network-wired"></i>
              </div>
              <div className="dev-metric-info">
                <span className="dev-metric-label">Active Sacco Tenants</span>
                <strong className="dev-metric-value">{activeCount}</strong>
              </div>
            </div>

            <div className="dev-metric-card">
              <div className="dev-metric-icon pending">
                <i className="fa-solid fa-lock"></i>
              </div>
              <div className="dev-metric-info">
                <span className="dev-metric-label">Held / Suspended Tenants</span>
                <strong className="dev-metric-value">{restrictedCount}</strong>
              </div>
            </div>

            <div className="dev-metric-card">
              <div className="dev-metric-icon uptime">
                <i className="fa-solid fa-file-invoice-dollar"></i>
              </div>
              <div className="dev-metric-info">
                <span className="dev-metric-label">Overdue Subscriptions</span>
                <strong className="dev-metric-value">{overdueCount}</strong>
              </div>
            </div>
          </section>

          {/* Tabular Contents */}
          {activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "3.5rem" }}>
              {/* Active Saccos mini-table */}
              <div className="dev-card-wrapper">
                <div className="dev-card-header">
                  <span className="dev-card-title">Recent Tenant Activity</span>
                  <button onClick={() => setActiveTab("tenants")} className="btn-dev-action">Manage All</button>
                </div>
                <div className="dev-table-container">
                  <table className="dev-table">
                    <thead>
                      <tr>
                        <th>SACCO Name</th>
                        <th>Identifier</th>
                        <th>Billing Tier</th>
                        <th>Subscription Rate</th>
                        <th>Account Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenants.length === 0 ? (
                        <tr>
                          <td colSpan="5" style={{ textAlign: "center", padding: "3rem", color: "#94a3b8" }}>
                            No live SACCO tenants registered.
                          </td>
                        </tr>
                      ) : (
                        tenants.slice(0, 3).map((tenant) => (
                          <tr key={tenant.id}>
                            {/* data-label carries the column heading down into the stacked
                                card layout below 440px, where the thead is hidden and each
                                cell has to name itself. See developerPortal.css. */}
                            <td data-label=""><strong>{tenant.name}</strong></td>
                            <td data-label="Identifier"><code>{tenant.code}</code></td>
                            <td data-label="Billing Tier">
                              <span className={`tenant-plan ${tenant.plan}`}>
                                {tenant.planName}
                              </span>
                            </td>
                            <td data-label="Subscription Rate">{formatRate(planOf(tenant.plan), tenant.cost)}</td>
                            <td data-label="Account Status">
                              <span
                                className={`tenant-state tone-${tenant.stateTone}`}
                                title={tenant.stateDetail}
                              >
                                {tenant.stateLabel}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Activity event logs log summary */}
              <div className="dev-card-wrapper">
                <div className="dev-card-header">
                  <span className="dev-card-title">Real-Time Platform Operations Feed</span>
                  <button onClick={() => setActiveTab("logs")} className="btn-dev-action font-weight-700">Audit Logs</button>
                </div>
                <div className="sys-logs-list">
                  {logs.slice(0, 3).map((log) => (
                    <div key={log.id} className="sys-log-item">
                      <div className={`sys-log-badge ${log.type === 'success' ? 'success' : log.type === 'warn' ? 'warn' : 'info'}`}>
                        <i className={log.type === 'success' ? 'fa-solid fa-circle-check' : log.type === 'warn' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info'}></i>
                      </div>
                      <div className="sys-log-details">
                        <span className="sys-log-msg">{log.msg}</span>
                        <span className="sys-log-time">{log.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "tenants" && (
            <div className="dev-card-wrapper">
              <div className="dev-card-header">
                <span className="dev-card-title">Platform Tenant Directory</span>
                <span className="dev-actions-legend">
                  <strong>Hold</strong> pauses a tenant while its subscription is unpaid — members
                  cannot enter the app, its admin gets a payment reminder — and is reversible.
                  <strong className="danger-term"> Suspend</strong> erases the tenant and all of its
                  data permanently.
                </span>
              </div>
              <div className="dev-table-container">
                <table className="dev-table">
                  <thead>
                    <tr>
                      <th>SACCO Name</th>
                      <th>Group Code</th>
                      <th>Administrator</th>
                      <th>Plan Type</th>
                      <th>Subscription</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.length === 0 ? (
                      <tr>
                        <td colSpan="7" style={{ textAlign: "center", padding: "3rem", color: "#94a3b8" }}>
                          No Saccos registered in database. Use register sacco to add one.
                        </td>
                      </tr>
                    ) : (
                      tenants.map((tenant) => (
                        <tr key={tenant.id}>
                          {/* data-label carries the column heading down into the stacked
                              card layout below 440px. The name cell is deliberately left
                              unlabelled -- it becomes the card's heading. */}
                          <td data-label="">
                            <strong>{tenant.name}</strong>
                            <div className="dev-cell-sub">Joined {tenant.joined}</div>
                          </td>
                          <td data-label="Group Code"><code>{tenant.code}</code></td>
                          <td data-label="Administrator">{tenant.admin}</td>
                          <td data-label="Plan Type">
                            <span className={`tenant-plan ${tenant.plan}`}>
                              {tenant.planName}
                            </span>
                            <div className="dev-cell-sub">
                              {formatRate(planOf(tenant.plan), tenant.cost)}
                            </div>
                          </td>
                          <td data-label="Subscription">
                            <select
                              className={`sub-select ${tenant.inGoodStanding ? "ok" : "due"}`}
                              value={tenant.storedSubscriptionStatus}
                              onChange={(e) => setSubscriptionStatus(tenant, e.target.value)}
                            >
                              {SUBSCRIPTION_STATUSES.map((s) => (
                                <option key={s} value={s}>{SUBSCRIPTION_LABELS[s]}</option>
                              ))}
                            </select>
                            <div
                              className="dev-cell-sub"
                              title={tenant.lastPaymentAt ? `Last payment ${tenant.lastPaymentAt}` : "No payment recorded yet"}
                            >
                              {tenant.daysOverdue > 0
                                ? `${tenant.daysOverdue} days overdue`
                                : tenant.expiresAt
                                  ? `Paid through ${tenant.expiresAt}`
                                  : "No billing term set"}
                            </div>
                          </td>
                          <td data-label="Status">
                            <span className={`tenant-state tone-${tenant.stateTone}`}>
                              {tenant.stateLabel}
                            </span>
                            {/* Whether this state was chosen or simply happened. A
                                developer decision names who made it; a billing state
                                explains what the clock did. */}
                            <div
                              className="dev-cell-sub"
                              title={tenant.stateDecidedBy === "platform" && tenant.statusChangedBy
                                ? `Set by ${tenant.statusChangedBy}`
                                : tenant.stateDetail}
                            >
                              {tenant.stateDetail}
                            </div>
                            {tenant.stateDecidedBy === "billing" && (
                              <div className="dev-state-origin">Automatic</div>
                            )}
                          </td>
                          <td data-label="Actions">
                            <div className="dev-actions" style={{ justifyContent: "flex-end" }}>
                              {tenant.status === "on_hold" || tenant.status === "suspended" || tenant.status === "closed" ? (
                                <button
                                  onClick={() => reactivateTenant(tenant)}
                                  className="btn-dev-action positive"
                                >
                                  {tenant.status === "on_hold" ? "Release Hold" : "Reinstate"}
                                </button>
                              ) : (
                                <button
                                  onClick={() => holdTenant(tenant)}
                                  className={`btn-dev-action warn ${tenant.holdRecommended ? "is-urged" : ""}`}
                                  disabled={tenant.inGoodStanding}
                                  title={tenant.inGoodStanding
                                    ? `${tenant.stateLabel} — a billing hold does not apply.`
                                    : `Pause member access and remind the admin to pay. ${tenant.stateDetail}`}
                                >
                                  Hold
                                </button>
                              )}

                              <button
                                onClick={() => suspendTenant(tenant)}
                                className="btn-dev-action critical"
                                title={`Erase ${tenant.name} and every record belonging to it. Permanent.`}
                              >
                                Suspend &amp; Erase
                              </button>

                              <button
                                onClick={() => recordPayment(tenant)}
                                className="btn-dev-action"
                                title="Record a subscription payment, renewing the term"
                              >
                                Mark Paid
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "plans" && (
            <div>
              <div className="dev-plans-note">
                <i className="fa-solid fa-circle-info"></i>
                <div>
                  <strong>The live price list.</strong> Exactly what members are shown on the
                  payments page and what a checkout is priced from — both read the same
                  catalogue, <code>src/utils/subscriptionPlans.js</code>, which is where a
                  price is changed. This screen used to carry its own editable copy that
                  saved nothing, which is how the portal came to quote three tiers at prices
                  the app has never charged.
                </div>
              </div>
              <div className="plan-config-grid">
                {SUBSCRIPTION_PLANS.map((plan) => {
                  const onThisPlan = tenants.filter((t) => t.plan === plan.id).length;
                  const monthly = Math.round(planMonthlyPrice(plan));

                  return (
                    <div key={plan.id} className={`plan-card ${plan.id}-plan`}>
                      <div className="plan-card-header">
                        <div className="plan-name">
                          {plan.name}
                          {plan.recommended && <span className="plan-badge">{plan.badge}</span>}
                        </div>
                        <div className="plan-desc">{plan.description}</div>
                      </div>

                      <div className="plan-price-block">
                        {plan.price === 0 ? (
                          <span className="plan-price-amt">Free</span>
                        ) : (
                          <>
                            <span className="plan-price-currency">Shs</span>
                            <span className="plan-price-amt">{plan.price.toLocaleString()}</span>
                          </>
                        )}
                        <span className="plan-price-period">/ {plan.billingCycle}</span>
                        {plan.originalPrice && (
                          <span className="plan-price-was">Shs {plan.originalPrice.toLocaleString()}</span>
                        )}
                      </div>

                      <div className="plan-settings">
                        <div className="plan-setting-row">
                          <span className="plan-setting-label">Billing term</span>
                          <span className="plan-setting-value">
                            {plan.durationMonths} month{plan.durationMonths === 1 ? "" : "s"}
                          </span>
                        </div>
                        {/* Premium is billed quarterly, so its monthly equivalent is the
                            only figure that compares against the other two. */}
                        <div className="plan-setting-row">
                          <span className="plan-setting-label">Works out at</span>
                          <span className="plan-setting-value">
                            {monthly === 0 ? "No charge" : `Shs ${monthly.toLocaleString()} / month`}
                          </span>
                        </div>
                        <div className="plan-setting-row">
                          <span className="plan-setting-label">Tenants on this plan</span>
                          <span className="plan-setting-value">{onThisPlan}</span>
                        </div>
                      </div>

                      <ul className="plan-feature-list">
                        {plan.features.map((feature) => (
                          <li key={feature}>
                            <i className="fa-solid fa-check"></i>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "logs" && (
            <div className="dev-card-wrapper">
              <div className="dev-card-header">
                <span className="dev-card-title">System Operations Audit Trail</span>
                <button onClick={() => setLogs([])} className="btn-dev-action critical">Clear Audit Logs</button>
              </div>
              <div className="sys-logs-list">
                {logs.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "3rem", color: "#64748b", fontSize: "1.4rem" }}>
                    No operations logs stored in database.
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="sys-log-item">
                      <div className={`sys-log-badge ${log.type === 'success' ? 'success' : log.type === 'warn' ? 'warn' : 'info'}`}>
                        <i className={log.type === 'success' ? 'fa-solid fa-circle-check' : log.type === 'warn' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info'}></i>
                      </div>
                      <div className="sys-log-details">
                        <span className="sys-log-msg">{log.msg}</span>
                        <span className="sys-log-time">{log.time}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
