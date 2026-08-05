"use client";

import React, { useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "../supabaseClient";
import Loader from "./loader";
import { Session } from "@supabase/supabase-js";
import "../styles/membershipRevoked.css";

interface ProtectedRouteProps {
  children: ReactNode;
}

// Set when an admin chooses "Switch to Member View", cleared when they switch back.
// Exported so the two headers and two sidebars agree on the spelling rather than each
// repeating a string literal.
export const MEMBER_VIEW_KEY = "pewosa:admin-viewing-as-member";

interface SaccoState {
  name: string;
  status: string;
  reason: string;
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

        // Non-admins may never reach admin-only routes, regardless of SACCO membership.
        if (pathname.startsWith("/admin") && role !== "admin") {
          setLoading(false);
          router.replace("/dashboard");
          return;
        }

        // SACCO Admins opening the app at /dashboard are routed on to the Admin Dashboard,
        // which is what 22c0b9a wanted: launching the installed PWA should land an admin on
        // their own screen rather than the member one.
        //
        // Unless they asked to be here. "Switch to Member View" navigates to
        // /dashboard?view=member, and without the check below this redirect fired straight
        // afterwards and threw them back to /admin -- so the menu item existed, did nothing
        // visible, and the two views could not be switched between at all.
        //
        // The choice is remembered for the tab rather than read from the URL alone, because
        // a member-view visit to /savings and back would otherwise arrive at a bare
        // /dashboard and bounce again. sessionStorage and not localStorage: reopening the
        // app is exactly when an admin should land on the admin dashboard again.
        // Read from window rather than useSearchParams(): that hook opts every page this
        // component wraps out of static prerendering unless each is given its own Suspense
        // boundary, which failed the build on /loans. This runs inside an effect, so it is
        // client-side already and window is there to be asked.
        if (pathname === "/dashboard" && role === "admin") {
          const askedForMemberView =
            new URLSearchParams(window.location.search).get("view") === "member";
          if (askedForMemberView) {
            sessionStorage.setItem(MEMBER_VIEW_KEY, "1");
          }

          if (!askedForMemberView && sessionStorage.getItem(MEMBER_VIEW_KEY) !== "1") {
            setLoading(false);
            router.replace("/admin");
            return;
          }
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

    // The platform developer portal controls this: 'suspended'/'closed' lock the SACCO
    // out entirely, 'on_hold' is a billing restriction that leaves the app readable.
    // The matching write block is enforced in the database by trg_sacco_access_state.
    function applySaccoState(saccoRow: { name?: string; status?: string; status_reason?: string } | null) {
      if (!saccoRow) {
        setSaccoState(null);
        return;
      }

      setSaccoState({
        name: saccoRow.name || "Your SACCO",
        status: saccoRow.status || "active",
        reason: saccoRow.status_reason || ""
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

  const status = saccoState?.status;

  if (status === "suspended" || status === "closed") {
    return <SaccoLockout sacco={saccoState as SaccoState} />;
  }

  if (status === "on_hold") {
    return (
      <>
        <BillingHoldBanner sacco={saccoState as SaccoState} />
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

function BillingHoldBanner({ sacco }: { sacco: SaccoState }) {
  return (
    <div style={{
      position: "sticky",
      top: 0,
      zIndex: 900,
      display: "flex",
      alignItems: "center",
      gap: "1.2rem",
      padding: "1.2rem 2rem",
      background: "linear-gradient(135deg, #7c2d12, #9a3412)",
      color: "#ffedd5",
      fontSize: "1.35rem",
      lineHeight: 1.5,
      borderBottom: "1px solid rgba(249, 115, 22, 0.4)"
    }}>
      <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: "1.8rem", flexShrink: 0 }}></i>
      <div>
        <strong>{sacco.name} is on a billing hold.</strong>{" "}
        {sacco.reason || "The subscription is unpaid."}{" "}
        Records stay readable, but contributions, loans and approvals are blocked until the
        subscription is settled.
      </div>
    </div>
  );
}
