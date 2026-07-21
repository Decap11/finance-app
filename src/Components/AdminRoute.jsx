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

        // Fetch user profile role to verify admin privilege
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        if (error || !profile) {
          console.warn("Could not verify user profile role:", error);
          router.replace("/dashboard");
          return;
        }

        const role = (profile.role || "").trim().toLowerCase();
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
