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

        // If user has a group_id or is an admin, they are associated with a SACCO
        if (groupId || role === "admin") {
          const cleanGroupCode = groupId.toUpperCase();

          // Check if SACCO row exists in public.saccos
          let { data: saccoRow } = await supabase
            .from("saccos")
            .select("id, name, group_code")
            .or(`group_code.ilike.${cleanGroupCode},admin_profile_id.eq.${userId}`)
            .limit(1)
            .maybeSingle();

          // Self-healing check for Admin accounts if SACCO row is still pending
          if (!saccoRow && role === "admin" && cleanGroupCode) {
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
                saccoRow = { id: rpcRes.sacco_id, name: saccoName, group_code: cleanGroupCode };
              }
            } catch (e) {
              console.warn("Self-healing SACCO registration notice:", e);
            }
          }

          // SACCO access validated successfully
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
