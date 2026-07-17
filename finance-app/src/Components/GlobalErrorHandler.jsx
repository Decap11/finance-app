"use client";

import { useEffect } from "react";

export default function GlobalErrorHandler() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      const handleUnhandledRejection = (event) => {
        // Suppress background network "Failed to fetch" rejections (like Supabase token refreshes when offline/reconnecting)
        // to prevent Next.js dev server red error screen takeovers.
        const isFetchError = 
          event.reason && 
          (event.reason.message === "Failed to fetch" || 
           (event.reason.message && event.reason.message.includes("Failed to fetch")) ||
           (event.reason.status === 0) ||
           event.reason.name === "TypeError" && event.reason.message === "Failed to fetch");

        if (isFetchError) {
          event.preventDefault();
          console.warn("Suppressed background Supabase network fetch error:", event.reason);
        }
      };

      const handleGlobalError = (event) => {
        if (event.error && event.error.message && event.error.message.includes("Failed to fetch")) {
          event.preventDefault();
          console.warn("Suppressed global network fetch error:", event.error);
        }
      };

      window.addEventListener("unhandledrejection", handleUnhandledRejection);
      window.addEventListener("error", handleGlobalError);
      
      return () => {
        window.removeEventListener("unhandledrejection", handleUnhandledRejection);
        window.removeEventListener("error", handleGlobalError);
      };
    }
  }, []);

  return null;
}
