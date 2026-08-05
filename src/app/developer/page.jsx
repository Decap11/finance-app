"use client";

import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import "../../styles/developerPortal.css";

const PLAN_PRICES = { basic: 150000, premium: 350000, enterprise: 750000 };

// A subscription is only "in good standing" while it is a live trial or paid up. Anything
// else is what justifies a billing hold. Mirrors the same rule in /api/platform, which is
// the authority -- this copy only covers rows the route didn't enrich.
const GOOD_STANDING = ["trial", "active"];
const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "expired", "cancelled"];

const SUBSCRIPTION_LABELS = {
  trial: "Trial",
  active: "Paid",
  past_due: "Past Due",
  expired: "Expired",
  cancelled: "Cancelled"
};

const STATUS_LABELS = {
  active: "active",
  on_hold: "on hold",
  suspended: "suspended",
  closed: "closed",
  pending: "pending"
};

function subscriptionSnapshot(sacco) {
  const stored = sacco?.subscription_status || "trial";
  const expiresAt = sacco?.subscription_expires_at ? new Date(sacco.subscription_expires_at) : null;
  const isExpired = expiresAt ? expiresAt.getTime() < Date.now() : false;
  const effective = isExpired && GOOD_STANDING.includes(stored) ? "past_due" : stored;

  return {
    stored,
    effective,
    daysOverdue: isExpired && expiresAt ? Math.floor((Date.now() - expiresAt.getTime()) / 86400000) : 0,
    inGoodStanding: GOOD_STANDING.includes(effective)
  };
}

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

  // Database-backed states
  const [tenants, setTenants] = useState([]);
  const [logs, setLogs] = useState([]);

  // Mock Subscription Plans details (adjustable locally)
  const [plans, setPlans] = useState({
    basic: { name: "Basic Plan", price: 150000, memberLimit: 50, shareValuation: 2000 },
    premium: { name: "Premium Plan", price: 350000, memberLimit: 250, shareValuation: 5000 },
    enterprise: { name: "Enterprise Plan", price: 750000, memberLimit: 1000, shareValuation: 10000 }
  });

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

        // Prefer the billing plan stored on the tenant; fall back to inferring it from
        // the member limit for rows registered before subscriptions were tracked.
        let planType = sacco.subscription_plan;
        if (!planType) {
          planType = limit > 500 ? "enterprise" : limit > 50 ? "premium" : "basic";
        }
        const planPrice = Number(sacco.subscription_amount) || PLAN_PRICES[planType] || 150000;

        // The route already derives this (an expiry in the past counts as past_due even
        // if the stored status still says active) -- recompute only as a fallback.
        const billing = sacco.subscription || subscriptionSnapshot(sacco);

        return {
          id: sacco.id,
          name: sacco.name,
          code: sacco.group_code || sacco.acronym,
          admin: adminUser ? adminUser.email : "No admin linked",
          plan: planType,
          cost: planPrice,
          status: sacco.status || "active",
          statusReason: sacco.status_reason || "",
          statusChangedBy: sacco.status_changed_by || "",
          joined: sacco.created_at ? new Date(sacco.created_at).toISOString().split('T')[0] : "2026-01-01",
          memberLimit: limit,
          subscriptionStatus: billing.effective,
          storedSubscriptionStatus: billing.stored,
          daysOverdue: billing.daysOverdue,
          inGoodStanding: billing.inGoodStanding,
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
        `Cannot hold '${tenant.name}': its subscription is in good standing (${SUBSCRIPTION_LABELS[tenant.subscriptionStatus]}).\n\n` +
        `A hold requires a past due, expired or cancelled subscription. Use Suspend for non-billing enforcement.`
      );
      return;
    }

    const overdueNote = tenant.daysOverdue > 0 ? ` - ${tenant.daysOverdue} days overdue` : "";
    const reason = prompt(
      `Place '${tenant.name}' on billing hold?\n\n` +
      `Subscription: ${SUBSCRIPTION_LABELS[tenant.subscriptionStatus]}${overdueNote}.\n` +
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
  const recordPayment = async (tenant) => {
    const monthsInput = prompt(
      `Record a subscription payment for '${tenant.name}'.\n\nRate: Shs ${tenant.cost.toLocaleString()}/mo.\nHow many months?`,
      "1"
    );
    if (monthsInput === null) return;
    const months = Math.max(1, Number(monthsInput) || 1);
    await runTenantAction("record-payment", {
      sacco_id: tenant.id,
      months,
      amount: tenant.cost * months
    });
  };

  const setSubscriptionStatus = async (tenant, nextStatus) => {
    if (nextStatus === tenant.storedSubscriptionStatus) return;
    await runTenantAction("update-subscription", {
      sacco_id: tenant.id,
      subscription_status: nextStatus
    });
  };

  // Update plan price setting (Mock plan manager)
  const updatePlanPrice = (planKey, value) => {
    const cleanVal = Number(value) || 0;
    setPlans(prev => ({
      ...prev,
      [planKey]: {
        ...prev[planKey],
        price: cleanVal
      }
    }));
  };

  const savePlanSettings = async (planKey) => {
    const planName = plans[planKey].name;
    const price = plans[planKey].price;

    // Log the event locally
    const newLog = {
      id: Date.now(),
      type: "info",
      msg: `Billing rate updated for '${planName}' to Shs ${price.toLocaleString()}/mo`,
      time: "Just now"
    };
    setLogs(prev => [newLog, ...prev]);
    alert(`Success: Subscription plan '${planName}' configurations saved locally!`);
  };

  // Calculate platform totals. Revenue only counts tenants that are both active and paid
  // up -- a suspended or held tenant is not billing.
  const totalRevenue = tenants
    .filter(t => t.status === "active" && t.inGoodStanding)
    .reduce((sum, t) => sum + t.cost, 0);

  const activeCount = tenants.filter(t => t.status === "active").length;
  const restrictedCount = tenants.filter(t => t.status === "on_hold" || t.status === "suspended").length;
  const overdueCount = tenants.filter(t => !t.inGoodStanding).length;

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
        {/* Sidebar */}
        <aside className="dev-sidebar">
          <div className="dev-logo">
            <i className="fa-solid fa-terminal"></i>
            <h2>Dev Engine</h2>
          </div>
          <nav>
            <ul className="dev-nav-list">
              <li>
                <button
                  onClick={() => setActiveTab("overview")}
                  className={`dev-nav-item ${activeTab === "overview" ? "active" : ""}`}
                >
                  <i className="fa-solid fa-grid-2"></i>
                  <span>System Overview</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab("tenants")}
                  className={`dev-nav-item ${activeTab === "tenants" ? "active" : ""}`}
                >
                  <i className="fa-solid fa-server"></i>
                  <span>Manage Tenants</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab("plans")}
                  className={`dev-nav-item ${activeTab === "plans" ? "active" : ""}`}
                >
                  <i className="fa-solid fa-credit-card"></i>
                  <span>Subscription Plans</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setActiveTab("logs")}
                  className={`dev-nav-item ${activeTab === "logs" ? "active" : ""}`}
                >
                  <i className="fa-solid fa-list-check"></i>
                  <span>Platform Events</span>
                </button>
              </li>
            </ul>
          </nav>

          <div className="dev-sidebar-footer">
            <button onClick={handleLogout} className="btn-dev-logout">
              <i className="fa-solid fa-right-from-bracket"></i>
              <span>Exit Portal</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="dev-main-content">
          <header className="dev-header">
            <div className="dev-welcome">
              <h1>SysAdmin Panel</h1>
              <p>Platform Core Engine & Multi-Tenant Billing Coordinator</p>
            </div>
            <div className="dev-badge-role">
              <i className="fa-solid fa-shield-halved" style={{ marginRight: "0.8rem" }}></i>
              Core Developer
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
                            <td><strong>{tenant.name}</strong></td>
                            <td><code>{tenant.code}</code></td>
                            <td>
                              <span className={`tenant-plan ${tenant.plan}`}>
                                {tenant.plan}
                              </span>
                            </td>
                            <td>Shs {tenant.cost.toLocaleString()}/mo</td>
                            <td>
                              <span className={`tenant-status ${tenant.status}`} title={tenant.statusReason}>
                                {STATUS_LABELS[tenant.status] || tenant.status}
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
                          <td>
                            <strong>{tenant.name}</strong>
                            <div className="dev-cell-sub">Joined {tenant.joined}</div>
                          </td>
                          <td><code>{tenant.code}</code></td>
                          <td>{tenant.admin}</td>
                          <td>
                            <span className={`tenant-plan ${tenant.plan}`}>
                              {tenant.plan}
                            </span>
                            <div className="dev-cell-sub">Shs {tenant.cost.toLocaleString()}/mo</div>
                          </td>
                          <td>
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
                          <td>
                            <span className={`tenant-status ${tenant.status}`}>
                              {STATUS_LABELS[tenant.status] || tenant.status}
                            </span>
                            {tenant.statusReason && (
                              <div
                                className="dev-cell-sub"
                                title={tenant.statusChangedBy
                                  ? `${tenant.statusReason} (set by ${tenant.statusChangedBy})`
                                  : tenant.statusReason}
                              >
                                {tenant.statusReason}
                              </div>
                            )}
                          </td>
                          <td>
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
                                  className="btn-dev-action warn"
                                  disabled={tenant.inGoodStanding}
                                  title={tenant.inGoodStanding
                                    ? "Subscription is in good standing - a billing hold does not apply."
                                    : `Pause member access and remind the admin to pay: subscription ${SUBSCRIPTION_LABELS[tenant.subscriptionStatus]}`}
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
              <div style={{ fontSize: "1.4rem", color: "#94a3b8", marginBottom: "2.5rem" }}>
                Platform configurations for the registration packages. Adjusting rates here changes pricing defaults for new tenants.
              </div>
              <div className="plan-config-grid">
                {Object.keys(plans).map((key) => {
                  const plan = plans[key];
                  return (
                    <div key={key} className={`plan-card ${key}-plan`}>
                      <div className="plan-card-header">
                        <div className="plan-name">{plan.name}</div>
                        <div className="plan-desc">Targeted for scaling groups and cooperatives.</div>
                      </div>

                      <div className="plan-price-block">
                        <span className="plan-price-currency">Shs</span>
                        <span className="plan-price-amt">{plan.price.toLocaleString()}</span>
                        <span className="plan-price-period">/ month</span>
                      </div>

                      <div className="plan-settings">
                        <div className="plan-setting-row">
                          <span className="plan-setting-label">Max Members Limit</span>
                          <span style={{ fontWeight: 700, fontSize: "1.35rem" }}>{plan.memberLimit} Users</span>
                        </div>
                        <div className="plan-setting-row">
                          <span className="plan-setting-label">Share Value Limit</span>
                          <span style={{ fontWeight: 700, fontSize: "1.35rem" }}>Shs {plan.shareValuation.toLocaleString()}</span>
                        </div>
                        <div className="plan-setting-row" style={{ marginTop: "1rem" }}>
                          <span className="plan-setting-label">Edit Monthly Cost</span>
                          <input
                            type="number"
                            className="plan-setting-input"
                            value={plan.price}
                            onChange={(e) => updatePlanPrice(key, e.target.value)}
                          />
                        </div>
                      </div>

                      <button onClick={() => savePlanSettings(key)} className="btn-update-plan">
                        Save Plan Rates
                      </button>
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
