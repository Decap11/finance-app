"use client";

import React, { useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "../supabaseClient";
import Loader from "./loader";
import { Session } from "@supabase/supabase-js";

interface ProtectedRouteProps {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isOrphan, setIsOrphan] = useState<boolean>(false);
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

        setSession(session);
        const userId = session.user.id;

        // 1. Fetch user profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, role, group_id, full_name, email")
          .eq("id", userId)
          .maybeSingle();

        const groupId = (profile?.group_id || session.user.user_metadata?.group_id || "").trim();
        const role = profile?.role || session.user.user_metadata?.role || "member";

        // If user has no group_id at all, they are an orphan user
        if (!groupId) {
          console.warn("Access Denied: Orphan user without group_id", userId);
          setIsOrphan(true);
          setLoading(false);
          router.replace("/signup?orphan=1");
          return;
        }

        // 2. Check if the SACCO group exists in public.saccos
        let { data: saccoRow } = await supabase
          .from("saccos")
          .select("id, name, group_code")
          .ilike("group_code", groupId)
          .maybeSingle();

        // Self-healing check for Admin accounts (e.g. Sarah Namuli)
        if (!saccoRow && role === "admin") {
          try {
            const acronym = groupId.split("-")[0] || "SACCO";
            const saccoName = (profile?.full_name || "SACCO Admin") + " SACCO";

            const { data: rpcRes } = await supabase.rpc("register_new_sacco", {
              p_sacco_name: saccoName,
              p_acronym: acronym,
              p_group_code: groupId.toUpperCase(),
              p_admin_profile_id: userId
            });

            if (rpcRes?.sacco_id) {
              saccoRow = { id: rpcRes.sacco_id, name: saccoName, group_code: groupId.toUpperCase() };
            }
          } catch (e) {
            console.warn("Self-healing SACCO creation failed:", e);
          }
        }

        // 3. Verify membership or valid SACCO existence
        if (!saccoRow) {
          // Double-check sacco_memberships table
          const { data: membership } = await supabase
            .from("sacco_memberships")
            .select("sacco_id")
            .eq("profile_id", userId)
            .limit(1)
            .maybeSingle();

          if (!membership) {
            console.warn("Access Denied: Orphan member not found in any active SACCO", userId);
            setIsOrphan(true);
            setLoading(false);
            router.replace("/signup?orphan=1");
            return;
          }
        }

        setIsOrphan(false);
        setLoading(false);
      } catch (err) {
        console.warn("Protected route validation error:", err);
        setLoading(false);
      }
    }

    checkAuthAndSaccoMembership();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        router.replace("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [router, pathname]);

  if (loading || !session || isOrphan) {
    return <Loader />;
  }

  return <>{children}</>;
}
