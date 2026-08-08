"use client";

import React, { useCallback, useEffect, useState, ReactNode } from "react";
import { supabase } from "../supabaseClient";
import { GuarantorAlertContext } from "./guarantorAlertContext";
import { subscribeToColumn } from "../utils/realtimeScope";

/**
 * Dispatch this after a member accepts or declines a request and the dot clears at once,
 * without waiting for a round trip.
 *
 * The requirement is that the dot disappears IMMEDIATELY on action. A refetch alone cannot
 * promise that -- it is a network call, and on the connections this app is actually used
 * over that is a visible pause during which the member has answered but is still being
 * told to answer. So the event decrements first and the refetch behind it corrects the
 * number if anything else changed meanwhile.
 */
export const GUARANTOR_RESOLVED_EVENT = "guarantor_request_resolved";

interface GuarantorAlertProviderProps {
  children: ReactNode;
}

export function GuarantorAlertProvider({ children }: GuarantorAlertProviderProps) {
  const [pendingCount, setPendingCount] = useState<number>(0);
  // Bumped to re-read. A counter rather than a hoisted fetch, so the read stays inside the
  // effect -- calling a setState-bearing callback from an effect body is a cascading
  // render, which is the same reason MemberDuesCard carries a refreshKey.
  const [refreshKey, setRefreshKey] = useState<number>(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;

    async function loadCount() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user || cancelled) return;

        const res = await fetch(
          `/api/loans/guarantors?profile_id=${session.user.id}&status=pending`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
            cache: "no-store"
          }
        );
        if (!res.ok || cancelled) return;

        const body = await res.json();
        if (cancelled) return;

        setPendingCount((body.requests || []).length);
      } catch {
        // A count that cannot load is a dot that does not show. This decorates the
        // navigation -- it must never be the reason a member cannot use the app.
      }
    }

    loadCount();
    return () => { cancelled = true; };
  }, [refreshKey]);

  useEffect(() => {
    // Somebody else nominating this member happens in the BORROWER's browser, so no
    // window event will ever reach here. Realtime is the only way the dot appears without
    // a reload -- which matters, because the whole point is that this is urgent.
    // Only rows where THIS member is the one being asked. `loan_guarantors` names the two
    // sides separately, so the filter is guarantor_profile_id -- not profile_id, which the
    // table does not have. Unfiltered, every guarantee request in every SACCO woke this dot.
    let unsubscribe = () => {};
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } = {} }) => {
      if (cancelled || !user?.id) return;
      unsubscribe = subscribeToColumn(
        "loan_guarantors",
        "guarantor_profile_id",
        user.id,
        () => setRefreshKey((k) => k + 1),
        "guarantor-alerts"
      );
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleResolved() {
      // Optimistic, then reconciled by the refetch the key change triggers.
      setPendingCount((c) => Math.max(0, c - 1));
      setRefreshKey((k) => k + 1);
    }

    window.addEventListener(GUARANTOR_RESOLVED_EVENT, handleResolved);
    return () => window.removeEventListener(GUARANTOR_RESOLVED_EVENT, handleResolved);
  }, []);

  return (
    <GuarantorAlertContext.Provider value={{ pendingCount, refresh }}>
      {children}
    </GuarantorAlertContext.Provider>
  );
}
