"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../supabaseClient";
import LandingPage from "../views/LandingPage";
import Loader from "../Components/loader";

/**
 * Root page controller (/)
 *
 * If a user already has an active session, automatically routes them to their respective
 * dashboard (/admin for SACCO Admins, /dashboard for SACCO Members) so opening the app
 * icon never forces a logged-in member to view the marketing page.
 */
export default function Page() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function checkExistingSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && session.user) {
          const { data: { user: liveUser } } = await supabase.auth.getUser();
          if (liveUser) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("role")
              .eq("id", liveUser.id)
              .maybeSingle();

            const role = profile?.role || liveUser.user_metadata?.role || "member";
            if (role === "admin") {
              router.replace("/admin");
              return;
            } else {
              router.replace("/dashboard");
              return;
            }
          }
        }
      } catch (e) {
        console.warn("Session check notice on root page:", e);
      } finally {
        setCheckingAuth(false);
      }
    }

    checkExistingSession();
  }, [router]);

  if (checkingAuth) {
    return <Loader />;
  }

  return <LandingPage />;
}
