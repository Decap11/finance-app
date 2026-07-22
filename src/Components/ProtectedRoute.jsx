"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient.js";
import Loader from "./loader.jsx";

export default function ProtectedRoute({ children }) {
  const [session, setSession] = useState(null);
  const [profileStatus, setProfileStatus] = useState("checking");
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  async function checkUserStatus(userSession) {
    if (!userSession?.user) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('status, role')
        .eq('id', userSession.user.id)
        .single();

      const userRole = (profile?.role || '').toLowerCase();
      const rawStatus = profile?.status;
      const userStatus = rawStatus ? String(rawStatus).trim().toLowerCase() : 'active';

      // Admin or Super Admin bypass
      if (userRole === 'admin' || userRole === 'super_admin') {
        setProfileStatus("active");
        setLoading(false);
        return;
      }

      // Member status check: must be active or approved or default null
      if (!rawStatus || userStatus === 'approved' || userStatus === 'active') {
        // Sync own profile row to status='active' (RLS allows users to update their own profile row!)
        if (rawStatus !== 'active') {
          supabase.from('profiles').update({ status: 'active' }).eq('id', userSession.user.id).then(() => {});
        }
        setProfileStatus("active");
      } else {
        setProfileStatus(userStatus);
      }
    } catch (err) {
      console.warn("Error verifying profile status:", err);
      setProfileStatus("active"); // Fallback to avoid blocking on transient errors
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let profileChannel = null;

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (!s) {
        setLoading(false);
        router.replace("/login");
      } else {
        checkUserStatus(s);

        // Realtime listener for member status changes (e.g. instant approval by Admin)
        profileChannel = supabase
          .channel(`profile-status-${s.user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'profiles',
              filter: `id=eq.${s.user.id}`
            },
            () => {
              checkUserStatus(s);
            }
          )
          .subscribe();
      }
    }).catch((err) => {
      console.warn("Auth session recovery failed:", err);
      setLoading(false);
      router.replace("/login");
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        router.replace("/login");
      } else {
        checkUserStatus(s);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (profileChannel) {
        supabase.removeChannel(profileChannel);
      }
    };
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  if (loading) {
    return <Loader />;
  }

  if (!session) {
    return <Loader />;
  }

  // Handle Pending Approval State
  if (profileStatus === "pending") {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
        padding: "2rem",
        fontFamily: "Inter, sans-serif"
      }}>
        <div style={{
          background: "#ffffff",
          borderRadius: "1.6rem",
          padding: "4rem 3rem",
          maxWidth: "500px",
          width: "100%",
          boxShadow: "0 2rem 4rem rgba(15, 23, 42, 0.08)",
          border: "0.1rem solid #e2e8f0",
          textAlign: "center"
        }}>
          <div style={{
            width: "6.4rem",
            height: "6.4rem",
            borderRadius: "50%",
            background: "#fef3c7",
            color: "#d97706",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2.8rem",
            margin: "0 auto 2rem auto"
          }}>
            <i className="fa-solid fa-clock-rotate-left"></i>
          </div>
          
          <h2 style={{ fontSize: "2.2rem", fontWeight: 700, color: "#0f172a", marginBottom: "1rem" }}>
            Account Pending Approval
          </h2>
          
          <p style={{ fontSize: "1.4rem", color: "#64748b", lineHeight: "1.6", marginBottom: "2.5rem" }}>
            Your registration request has been submitted to your SACCO Administrator. You will gain full access to your member dashboard once an admin approves your membership.
          </p>

          <div style={{
            background: "#f1f5f9",
            borderRadius: "1rem",
            padding: "1.2rem 1.6rem",
            marginBottom: "2.5rem",
            fontSize: "1.3rem",
            color: "#475569",
            fontWeight: 500
          }}>
            <i className="fa-solid fa-circle-info" style={{ marginRight: "0.8rem", color: "#3b82f6" }}></i>
            Need urgent access? Contact your SACCO group administrator.
          </div>

          <button 
            onClick={handleLogout}
            style={{
              width: "100%",
              padding: "1.4rem",
              borderRadius: "1rem",
              background: "var(--primary-color, #253b8e)",
              color: "#ffffff",
              border: "none",
              fontSize: "1.4rem",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
          >
            Back to Login / Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Handle Suspended or Rejected State
  if (profileStatus === "suspended" || profileStatus === "rejected") {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
        padding: "2rem",
        fontFamily: "Inter, sans-serif"
      }}>
        <div style={{
          background: "#ffffff",
          borderRadius: "1.6rem",
          padding: "4rem 3rem",
          maxWidth: "500px",
          width: "100%",
          boxShadow: "0 2rem 4rem rgba(239, 68, 68, 0.08)",
          border: "0.1rem solid #fee2e2",
          textAlign: "center"
        }}>
          <div style={{
            width: "6.4rem",
            height: "6.4rem",
            borderRadius: "50%",
            background: "#fef2f2",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2.8rem",
            margin: "0 auto 2rem auto"
          }}>
            <i className="fa-solid fa-user-xmark"></i>
          </div>
          
          <h2 style={{ fontSize: "2.2rem", fontWeight: 700, color: "#991b1b", marginBottom: "1rem" }}>
            Account Access Restricted
          </h2>
          
          <p style={{ fontSize: "1.4rem", color: "#64748b", lineHeight: "1.6", marginBottom: "2.5rem" }}>
            Your member account is currently inactive or suspended by your SACCO Administrator. Dashboard operations have been restricted.
          </p>

          <button 
            onClick={handleLogout}
            style={{
              width: "100%",
              padding: "1.4rem",
              borderRadius: "1rem",
              background: "#ef4444",
              color: "#ffffff",
              border: "none",
              fontSize: "1.4rem",
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return children;
}
