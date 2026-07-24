"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient.js";
import Loader from "./loader.jsx";

export default function AdminRoute({ children }) {
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function checkAdminAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.replace("/login");
          return;
        }

        setSession(session);

        // 1. Fetch user's SACCO group membership to verify admin privilege
        const { data: membership } = await supabase
          .from("sacco_memberships")
          .select("role, status")
          .eq("profile_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        // 2. Fetch user's global profile role
        const { data: profile } = await supabase
          .from("profiles")
          .select("role, status")
          .eq("id", session.user.id)
          .single();

        const role = (membership?.role || profile?.role || "").trim().toLowerCase();
        if (role === "admin" || role === "super_admin") {
          setIsAdmin(true);
        } else {
          // Regular members who attempt to access /admin are redirected to member dashboard
          router.replace("/dashboard");
        }
      } catch (err) {
        console.warn("Admin authorization check failed:", err);
        router.replace("/dashboard");
      } finally {
        setLoading(false);
      }
    }

    checkAdminAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  if (loading) {
    return <Loader />;
  }

  if (!session || !isAdmin) {
    return <Loader />;
  }

  return children;
}
