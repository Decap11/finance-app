"use client";

import React, { useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "../supabaseClient";
import Loader from "./loader";
import { Session } from "@supabase/supabase-js";
import { tenantState } from "../utils/tenantState";
import { routeRedirect, MEMBER_VIEW_KEY } from "../utils/routeAccess";
import "../styles/membershipRevoked.css";
import "../styles/subscriptionReminder.css";

interface ProtectedRouteProps {
  children: ReactNode;
}

// Defined in routeAccess alongside the rules that read it, and re-exported here because
// the two headers and two sidebars already import it from this module.
export { MEMBER_VIEW_KEY };

// A billing hold is a reminder to the admin, not a lockout, so the modal has to be
// dismissible -- otherwise it would sit on top of the very page they were sent to pay on.
// sessionStorage and not localStorage: closing the app and coming back should ask again.
const BILLING_REMINDER_KEY = "pewosa:billing-reminder-dismissed";

interface SaccoState {
  name: string;
  status: string;
  reason: string;
  /** The derived state -- see src/utils/tenantState.js. */
  state: string;
  stateLabel: string;
  stateDetail: string;
  blocksMembers: boolean;
  needsPayment: boolean;
  subscriptionStatus: string;
  expiresAt: string | null;
  daysOverdue: number;
  graceDaysLeft: number;
  amount: number;
  plan: string;
}

interface MemberState {
  status: string;
  name: string;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isOrphan, setIsOrphan] = useState<boolean>(false);
  const [saccoState, setSaccoState] = useState<SaccoState | null>(null);
  const [memberState, setMemberState] = useState<MemberState | null>(null);
  // Which side of a billing hold this user lands on: the admin is the one who can settle
  // the subscription, so they get the reminder while everyone else is held out.
  const [role, setRole] = useState<string>("member");
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    async function checkAuthAndSaccoMembership() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || !session.user) {
          setLoading(false);
          router.replace("/login");
          return;
        }

        // getSession() only reads the JWT cached in local storage -- it makes no network
        // call, so it keeps returning a "valid" session for the full token lifetime after
        // an admin deletes the account. Everything below then falls back to the claims
        // baked into that stale token (user_metadata.group_id, user_metadata.role), which
        // is enough to pass every check and render the dashboard to someone who no longer
        // exists. getUser() asks the auth server whether the account is still there.
        // Only a definitive rejection ends the session. A network failure surfaces here
        // as an AuthRetryableFetchError with no HTTP status, and must not sign out a
        // legitimate user who is merely offline.
        const { data: { user: liveUser }, error: liveUserErr } = await supabase.auth.getUser();
        const accountRejected = liveUserErr
          ? liveUserErr.status === 401 || liveUserErr.status === 403
          : !liveUser;

        if (accountRejected) {
          await supabase.auth.signOut();
          setSession(null);
          setLoading(false);
          router.replace("/login?removed=1");
          return;
        }

        setSession(session);
        const userId = session.user.id;

        // 1. Fetch user profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, role, group_id, full_name, email, status")
          .eq("id", userId)
          .maybeSingle();

        // Unapprove (set_member_approval) writes profiles.status = 'pending'. It does not
        // touch the auth account, so the session stays valid and getUser() above still
        // succeeds -- the status column is the only signal that access was revoked, and
        // this is the one place that reads it. Deliberately keyed off an explicit
        // non-active value rather than `!== "active"` on a possibly-absent profile: a
        // missing row is the orphan case handled at step 3, not a revocation.
        const memberStatus = (profile?.status || "").trim();
        if (profile && memberStatus && memberStatus !== "active") {
          setMemberState({
            status: memberStatus,
            name: profile.full_name || session.user.user_metadata?.full_name || "your account"
          });
          setLoading(false);
          return;
        }
        setMemberState(null);

        const profileGroupId = (profile?.group_id || "").trim();
        const groupId = (profileGroupId || session.user.user_metadata?.group_id || "").trim();
        const role = profile?.role || session.user.user_metadata?.role || "member";
        setRole(role);

        // The rules themselves live in src/utils/routeAccess.js so they can be tested
        // against the shipped source rather than a copy. Everything that cannot be pure --
        // reading the URL, remembering the choice for the tab, driving the router -- stays
        // here.
        //
        // sessionStorage and not localStorage: reopening the app is exactly when an admin
        // should land on the admin dashboard again. Read from window rather than
        // useSearchParams(): that hook opts every page this component wraps out of static
        // prerendering unless each is given its own Suspense boundary, which failed the
        // build on /loans. This runs inside an effect, so window is there to be asked.
        const askedForMemberView =
          new URLSearchParams(window.location.search).get("view") === "member";
        if (pathname === "/dashboard" && role === "admin" && askedForMemberView) {
          sessionStorage.setItem(MEMBER_VIEW_KEY, "1");
        }

        const redirectTo = routeRedirect({
          pathname,
          role,
          askedForMemberView,
          memberViewRemembered: sessionStorage.getItem(MEMBER_VIEW_KEY) === "1"
        });

        if (redirectTo) {
          setLoading(false);
          router.replace(redirectTo);
          return;
        }

        // If user has a group_id or is an admin, they are associated with a SACCO
        if (groupId || role === "admin") {
          const cleanGroupCode = groupId.toUpperCase();

          // Check if SACCO row exists in public.saccos.
          // select("*") rather than a column list so this still works against a database
          // where migration 0016 (status_reason and friends) has not been applied yet.
          let { data: saccoRow } = await supabase
            .from("saccos")
            .select("*")
            .or(`group_code.ilike.${cleanGroupCode},admin_profile_id.eq.${userId}`)
            .limit(1)
            .maybeSingle();

          // Self-healing check for Admin accounts if SACCO row is still pending.
          // Deliberately keyed off profiles.group_id rather than the JWT metadata copy:
          // erasing a tenant clears that column, and stale metadata must not be able to
          // recreate a SACCO the platform just deleted.
          if (!saccoRow && role === "admin" && cleanGroupCode && profileGroupId) {
            try {
              const acronym = cleanGroupCode.split("-")[0] || "SACCO";
              const saccoName = session.user.user_metadata?.sacco_name || (profile?.full_name || session.user.user_metadata?.full_name || "SACCO Admin") + " SACCO";

              const { data: rpcRes } = await supabase.rpc("register_new_sacco", {
                p_sacco_name: saccoName,
                p_acronym: acronym,
                p_group_code: cleanGroupCode,
                p_admin_profile_id: userId
              });

              if (rpcRes?.sacco_id) {
                saccoRow = { id: rpcRes.sacco_id, name: saccoName, group_code: cleanGroupCode, status: "active" };
              }
            } catch (e) {
              console.warn("Self-healing SACCO registration notice:", e);
            }
          }

          // SACCO access validated successfully
          applySaccoState(saccoRow);
          setIsOrphan(false);
          setLoading(false);
          return;
        }

        // 2. Fallback check for regular members without group_id in metadata: check sacco_memberships
        const { data: membership } = await supabase
          .from("sacco_memberships")
          .select("sacco_id")
          .eq("profile_id", userId)
          .limit(1)
          .maybeSingle();

        if (membership?.sacco_id) {
          const { data: saccoRow } = await supabase
            .from("saccos")
            .select("*")
            .eq("id", membership.sacco_id)
            .maybeSingle();

          applySaccoState(saccoRow);
          setIsOrphan(false);
          setLoading(false);
          return;
        }

        // 3. User has NO group_id in profile/metadata and NO membership -> Orphan User
        console.warn("Access Denied: Orphan user without SACCO group association", userId);
        setIsOrphan(true);
        setLoading(false);
        router.replace("/signup?orphan=1");
      } catch (err) {
        console.warn("Protected route validation error:", err);
        setLoading(false);
      }
    }

    // The platform developer portal controls this: 'suspended'/'closed' lock the SACCO out
    // entirely and permanently, 'on_hold' is the reversible billing measure -- members are
    // held out of the app until the subscription is settled, while the admin gets a payment
    // reminder instead so they can act on it. The matching write block is enforced in the
    // database by trg_sacco_access_state.
    //
    // The subscription columns come along because the reminder has to state what is owed.
    // Every caller reads the row with select("*"), so they are already there.
    function applySaccoState(saccoRow: {
      name?: string;
      status?: string;
      status_reason?: string;
      subscription_status?: string;
      subscription_plan?: string;
      subscription_amount?: number | string;
      subscription_expires_at?: string;
    } | null) {
      if (!saccoRow) {
        setSaccoState(null);
        return;
      }

      // One derivation, shared with the developer portal and /api/platform, so the state
      // this SACCO's admin is told they are in is the same one the operator is looking at.
      const state = tenantState(saccoRow);

      setSaccoState({
        name: saccoRow.name || "Your SACCO",
        status: saccoRow.status || "active",
        reason: saccoRow.status_reason || "",
        state: state.id,
        stateLabel: state.label,
        stateDetail: state.detail,
        blocksMembers: state.blocksMembers,
        needsPayment: state.needsPayment,
        subscriptionStatus: saccoRow.subscription_status || "trial",
        expiresAt: state.expiresAt,
        daysOverdue: state.daysOverdue,
        graceDaysLeft: state.graceDaysLeft,
        amount: Number(saccoRow.subscription_amount) || 0,
        plan: saccoRow.subscription_plan || ""
      });
    }

    // An admin can revoke a member while that member is sitting on the dashboard. The
    // check above only runs on mount and on route change, so a revoked member would keep
    // a working page until they navigated or reloaded. Re-reading the status whenever the
    // tab regains focus closes that window without polling.
    async function revalidateMemberStatus() {
      if (document.visibilityState !== "visible") return;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, status")
        .eq("id", session.user.id)
        .maybeSingle();

      const status = (profile?.status || "").trim();
      if (profile && status && status !== "active") {
        setMemberState({ status, name: profile.full_name || "your account" });
      }
    }

    checkAuthAndSaccoMembership();

    document.addEventListener("visibilitychange", revalidateMemberStatus);
    window.addEventListener("focus", revalidateMemberStatus);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        router.replace("/login");
      }
    });

    return () => {
      document.removeEventListener("visibilitychange", revalidateMemberStatus);
      window.removeEventListener("focus", revalidateMemberStatus);
      subscription.unsubscribe();
    };
  }, [router, pathname]);

  if (loading || !session || isOrphan) {
    return <Loader />;
  }

  // Checked before the SACCO state: a revoked member should see why *they* lost access,
  // not a tenant-wide notice, and neither branch renders any SACCO data.
  if (memberState) {
    return <MembershipRevoked member={memberState} />;
  }

  const state = saccoState?.state;

  if (state === "suspended" || state === "closed") {
    return <SaccoLockout sacco={saccoState as SaccoState} />;
  }

  // A billing hold pauses the tenant rather than ending it. Members are held out of the
  // app entirely -- there is nothing they can do about an unpaid subscription, and letting
  // them browse records they cannot act on reads as the app being broken. The SACCO admin
  // is the one who can settle it, so they keep the app and get the payment reminder.
  if (state === "on_hold" && role !== "admin") {
    return <SaccoBillingHold sacco={saccoState as SaccoState} />;
  }

  // The reminder no longer waits for a developer to click Hold. A subscription that lapsed
  // this morning puts the admin in `grace`, and one past the grace window in `overdue` --
  // both owe money, and both are states the admin can still do something about. Being told
  // while it is still fixable is the entire value of telling them.
  //
  // Members are deliberately not affected by those two: nothing is enforced until a hold,
  // so a tenant that quietly lapsed keeps working while its admin is asked to settle up.
  if (saccoState?.needsPayment) {
    return (
      <>
        {role === "admin" && <SubscriptionReminder sacco={saccoState as SaccoState} />}
        {children}
      </>
    );
  }

  return <>{children}</>;
}

// Shown when profiles.status is anything other than 'active'. 'pending' is what the
// admin Members tab writes via set_member_approval when it unapproves someone; the other
// values come from the status CHECK constraint on profiles and are covered here so an
// unexpected one still produces a lockout rather than silently granting access.
function MembershipRevoked({ member }: { member: MemberState }) {
  const isSuspended = member.status === "suspended" || member.status === "closed";
  const variant = isSuspended ? "is-suspended" : "is-pending";

  return (
    <div className="membership-lock">
      <div className="membership-lock-card">
        <img
          src="/images/sacco logo.png"
          alt="SACCO Logo"
          className="membership-lock-logo"
          onError={(e) => {
            (e.target as HTMLImageElement).onerror = null;
            (e.target as HTMLImageElement).src =
              "https://placehold.co/100x100/253b8e/ffffff?text=Logo";
          }}
        />

        <div className={`membership-lock-icon ${variant}`}>
          <i className={isSuspended ? "fa-solid fa-ban" : "fa-solid fa-user-clock"}></i>
        </div>

        <span className={`membership-lock-badge ${variant}`}>
          {isSuspended ? "Suspended" : "Pending approval"}
        </span>

        <h1 className="membership-lock-title">
          {isSuspended ? "Your membership is suspended" : "Your account is awaiting approval"}
        </h1>

        <p className="membership-lock-text">
          {isSuspended ? (
            <>
              <strong>{member.name}</strong> can no longer access this SACCO&apos;s dashboard.
            </>
          ) : (
            <>
              Your SACCO administrator has paused dashboard access for{" "}
              <strong>{member.name}</strong>.
            </>
          )}
        </p>

        <div className="membership-lock-note">
          <i className="fa-solid fa-shield-halved"></i>
          <span>
            Your savings, contributions and loan records are safe and unchanged. Contact
            your SACCO administrator to have your access restored.
          </span>
        </div>

        <div className="membership-lock-actions">
          {/* The status check only re-runs on mount, so once access is restored a reload is
              what brings the dashboard back. Without this the panel is a dead end whose
              only exit is signing out. */}
          <button
            className="membership-lock-btn is-primary"
            onClick={() => window.location.reload()}
          >
            <i className="fa-solid fa-rotate-right"></i>
            Check again
          </button>
          <button
            className="membership-lock-btn is-secondary"
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function SaccoLockout({ sacco }: { sacco: SaccoState }) {
  const isClosed = sacco.status === "closed";

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "2.4rem",
      background: "#0b0f19"
    }}>
      <div style={{
        maxWidth: "56rem",
        width: "100%",
        background: "rgba(15, 23, 42, 0.9)",
        border: "1px solid rgba(239, 68, 68, 0.25)",
        borderRadius: "1.6rem",
        padding: "4rem 3.2rem",
        textAlign: "center",
        color: "#e2e8f0"
      }}>
        <i
          className={isClosed ? "fa-solid fa-circle-xmark" : "fa-solid fa-ban"}
          style={{ fontSize: "5rem", color: "#ef4444", marginBottom: "2rem" }}
        ></i>
        <h1 style={{ fontSize: "2.4rem", fontWeight: 800, marginBottom: "1.2rem" }}>
          {isClosed ? "This SACCO account is closed" : "This SACCO has been suspended"}
        </h1>
        <p style={{ fontSize: "1.5rem", lineHeight: 1.6, color: "#94a3b8", marginBottom: "1.6rem" }}>
          <strong style={{ color: "#e2e8f0" }}>{sacco.name}</strong> is not currently able to use PEWOSA.
          Member records are safe and unchanged.
        </p>
        {sacco.reason && (
          <p style={{
            fontSize: "1.4rem",
            lineHeight: 1.6,
            color: "#cbd5e1",
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            borderRadius: "0.8rem",
            padding: "1.6rem",
            marginBottom: "2.4rem"
          }}>
            {sacco.reason}
          </p>
        )}
        <p style={{ fontSize: "1.35rem", color: "#64748b", marginBottom: "2.4rem" }}>
          Your SACCO administrator should contact platform support to restore access.
        </p>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            padding: "1.2rem 2.4rem",
            borderRadius: "0.8rem",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            background: "rgba(15, 23, 42, 0.6)",
            color: "#e2e8f0",
            fontSize: "1.4rem",
            fontWeight: 700,
            cursor: "pointer"
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

// What a member sees while the SACCO is on a billing hold. Deliberately a pause and not a
// lockout in tone: nothing has been lost, and the person reading it cannot fix it -- the
// only useful thing it can tell them is who can.
function SaccoBillingHold({ sacco }: { sacco: SaccoState }) {
  return (
    <div className="membership-lock">
      <div className="membership-lock-card">
        <img
          src="/images/sacco logo.png"
          alt="SACCO Logo"
          className="membership-lock-logo"
          onError={(e) => {
            (e.target as HTMLImageElement).onerror = null;
            (e.target as HTMLImageElement).src =
              "https://placehold.co/100x100/253b8e/ffffff?text=Logo";
          }}
        />

        <div className="membership-lock-icon is-billing">
          <i className="fa-solid fa-hourglass-half"></i>
        </div>

        <span className="membership-lock-badge is-billing">Temporarily paused</span>

        <h1 className="membership-lock-title">{sacco.name} is temporarily paused</h1>

        <p className="membership-lock-text">
          This SACCO&apos;s PEWOSA subscription is due, so access has been paused until it is
          settled. This is temporary — everything comes back the moment payment goes through.
        </p>

        <div className="membership-lock-note">
          <i className="fa-solid fa-shield-halved"></i>
          <span>
            Your savings, contributions and loan records are safe and unchanged. Your SACCO
            administrator has been notified and can settle the subscription to restore access.
          </span>
        </div>

        <div className="membership-lock-actions">
          {/* The status is only read on mount, so a reload is what brings the dashboard
              back once the hold is released. */}
          <button
            className="membership-lock-btn is-primary"
            onClick={() => window.location.reload()}
          >
            <i className="fa-solid fa-rotate-right"></i>
            Check again
          </button>
          <button
            className="membership-lock-btn is-secondary"
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// What the SACCO admin gets instead of the lockout: the app, plus a reminder of what is
// owed and a way to pay it. Dismissible on purpose -- "Settle subscription" leads to
// /payments, and a modal that could not be closed would cover that page too.
function SubscriptionReminder({ sacco }: { sacco: SaccoState }) {
  const router = useRouter();
  const [open, setOpen] = useState<boolean>(false);

  // Read in an effect rather than during render: sessionStorage does not exist while this
  // page is being prerendered, and seeding state from it would desync hydration.
  useEffect(() => {
    setOpen(sessionStorage.getItem(BILLING_REMINDER_KEY) !== "1");
  }, []);

  const close = () => {
    sessionStorage.setItem(BILLING_REMINDER_KEY, "1");
    setOpen(false);
  };

  const goToPayments = () => {
    close();
    router.push("/payments");
  };

  const dueDate = sacco.expiresAt
    ? new Date(sacco.expiresAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric"
      })
    : null;

  // Three different situations reach this component, and telling an admin their members
  // are locked out when they are not would be a lie they would act on.
  const held = sacco.state === "on_hold";
  const inGrace = sacco.state === "grace";

  const headline = held
    ? `${sacco.name} is on a billing hold.`
    : inGrace
      ? `${sacco.name}'s subscription has lapsed.`
      : `${sacco.name}'s subscription is overdue.`;

  const consequence = held
    ? "Your members cannot sign in and no contributions, loans or approvals can be recorded until the subscription is settled."
    : inGrace
      ? `Everything still works for now — ${sacco.graceDaysLeft === 0
          ? "the grace period ends today"
          : `you have ${sacco.graceDaysLeft} day${sacco.graceDaysLeft === 1 ? "" : "s"} of grace left`}. Settle it to avoid your members being locked out.`
      : "The grace period has passed. Your SACCO is still running, but it can be put on hold at any time, which locks your members out.";

  return (
    <>
      {/* Stays after the modal is dismissed, so this never becomes invisible. */}
      <div className={`billrem-banner ${held ? "" : "is-warning"}`}>
        <i className="fa-solid fa-triangle-exclamation"></i>
        <div className="billrem-banner-text">
          <strong>{headline}</strong> {consequence}
        </div>
        <button className="billrem-banner-btn" onClick={goToPayments}>
          Settle now
        </button>
      </div>

      {open && (
        <div className="billrem-overlay" onClick={close}>
          <div
            className="billrem-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="billrem-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="billrem-body">
              <div className="billrem-icon">
                <i className="fa-solid fa-file-invoice-dollar"></i>
              </div>

              <span className="billrem-badge">{sacco.stateLabel}</span>

              <h2 className="billrem-title" id="billrem-title">
                {held
                  ? "Your SACCO is on a billing hold"
                  : inGrace
                    ? "Your subscription has lapsed"
                    : "Your subscription payment is overdue"}
              </h2>

              <p className="billrem-message">
                {held ? (
                  <>
                    <strong>{sacco.name}</strong> has been placed on a temporary billing
                    hold. Your members cannot sign in, and nothing can be recorded, until
                    the subscription is paid.
                  </>
                ) : (
                  <>
                    <strong>{sacco.name}</strong> — {sacco.stateDetail} Your members are
                    still working normally, and settling now keeps it that way.
                  </>
                )}
              </p>

              <dl className="billrem-details">
                {sacco.amount > 0 && (
                  <div className="billrem-detail-row">
                    <dt>Amount due</dt>
                    <dd className="billrem-amount">Shs {sacco.amount.toLocaleString()}</dd>
                  </div>
                )}
                {sacco.plan && (
                  <div className="billrem-detail-row">
                    <dt>Plan</dt>
                    <dd style={{ textTransform: "capitalize" }}>{sacco.plan}</dd>
                  </div>
                )}
                {dueDate && (
                  <div className="billrem-detail-row">
                    <dt>{sacco.daysOverdue > 0 ? "Was due" : "Due"}</dt>
                    <dd>{dueDate}</dd>
                  </div>
                )}
                {sacco.daysOverdue > 0 && (
                  <div className="billrem-detail-row">
                    <dt>Overdue by</dt>
                    <dd className="billrem-overdue">
                      {sacco.daysOverdue} day{sacco.daysOverdue === 1 ? "" : "s"}
                    </dd>
                  </div>
                )}
              </dl>

              {sacco.reason && <p className="billrem-reason">{sacco.reason}</p>}
            </div>

            <div className="billrem-footer">
              <button className="billrem-btn billrem-btn-ghost" onClick={close}>
                Remind me later
              </button>
              <button className="billrem-btn billrem-btn-solid" onClick={goToPayments}>
                <i className="fa-solid fa-credit-card"></i>
                Settle subscription
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
