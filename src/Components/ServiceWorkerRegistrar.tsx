"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the app installable.
 *
 * Renders nothing. Mounted once from the root layout.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Development is deliberately excluded. A service worker sitting in front of the dev
    // server intercepts HMR and serves yesterday's chunks, which presents as edits that
    // "don't apply" -- an afternoon lost to a caching layer nobody remembered installing.
    if (process.env.NODE_ENV !== "production") {
      // Clean up after anyone who ran a production build locally on this origin. Without
      // this the worker from that build keeps controlling localhost:3001 forever.
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      return;
    }

    // Registration competes with the first render for bandwidth, and on the connections this
    // app is used on that is a real cost. Waiting for load means the shell paints first.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        // Not fatal: without a worker the app is simply a normal website. Never surface this
        // to a member.
        console.warn("Service worker registration failed:", err);
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  // No automatic reload when a new worker takes over. The worker calls skipWaiting(), so the
  // next navigation gets the new code -- but forcing a reload here would discard whatever a
  // member had typed into a contribution or loan form at that moment, to save them one click.
  return null;
}
