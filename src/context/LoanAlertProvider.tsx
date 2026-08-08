"use client";

import React, { useEffect, useState, ReactNode } from "react";
import { supabase } from "../supabaseClient";
import { subscribeToOwnSaccoRows } from "../utils/realtimeScope";
import { summariseLoanReminders } from "../utils/loanSchedule";
import { LoanAlertContext } from "./loanAlertContext";

/** Loan states that are still being repaid, and so can still reach a checkpoint. */
const LIVE_STATUSES = ["disbursed", "issued", "active", "overdue"];

interface LoanAlertProviderProps {
  children: ReactNode;
}

/**
 * Counts the loans an admin should be reminded about today.
 *
 * The rule, from loanSchedule.js: a loan taken on 28 September over three months wants
 * attention on the 28th of each following month, until the term elapses or the balance
 * reaches zero. Nothing is stored -- there is no scheduler in this app, so the schedule is
 * recomputed on every read and a loan repaid early simply stops appearing.
 *
 * This exists to feed the navigation dot rather than a panel, so it fetches only the
 * columns the arithmetic needs. The list itself, with the borrower names and the actions,
 * is the Loan Applications panel on the Verifications tab -- which is where the dot leads.
 */
export function LoanAlertProvider({ children }: LoanAlertProviderProps) {
  const [alerts, setAlerts] = useState({ dueToday: 0, overdue: 0, needingAttention: 0 });

  useEffect(() => {
    let cancelled = false;

    async function loadAlerts() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("group_id")
          .eq("id", user.id)
          .maybeSingle();

        if (!profile?.group_id || cancelled) return;

        const { data: sacco } = await supabase
          .from("saccos")
          .select("id")
          .ilike("group_code", profile.group_id.trim())
          .limit(1)
          .maybeSingle();

        if (!sacco?.id || cancelled) return;

        const { data, error } = await supabase
          .from("loans")
          .select("id, term_months, status, outstanding_balance, due_date, disbursed_at, approved_at, requested_at")
          .eq("sacco_id", sacco.id)
          .in("status", LIVE_STATUSES);

        if (error || cancelled) return;

        const summary = summariseLoanReminders(data || []);
        setAlerts({
          dueToday: summary.dueToday,
          overdue: summary.overdue,
          needingAttention: summary.dueToday + summary.overdue
        });
      } catch {
        // A count that will not load is a dot that does not show. This decorates the
        // navigation and must never be why an admin cannot use the dashboard.
      }
    }

    loadAlerts();

    // Confirming a fee, disbursing, or a repayment landing all change whether a loan is
    // still owed -- and a repayment that clears the balance should take the dot away
    // without the admin reloading.
    // Scoped to this admin's own SACCO. Loan checkpoints are a staff view of the whole
    // group, so every member's loans matter -- but only this group's.
    const unsubscribeLoans = subscribeToOwnSaccoRows(["loans"], loadAlerts, "loan-alerts");

    // A loan sitting exactly on its anniversary today is not on it tomorrow. A dashboard
    // left open overnight -- which is how these are actually used -- would otherwise keep
    // yesterday's answer until somebody reloaded.
    const midnightCheck = setInterval(loadAlerts, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(midnightCheck);
      unsubscribeLoans();
    };
  }, []);

  return (
    <LoanAlertContext.Provider value={alerts}>
      {children}
    </LoanAlertContext.Provider>
  );
}
