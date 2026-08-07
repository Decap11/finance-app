"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import ProtectedRoute from "../../Components/ProtectedRoute";
import MemberLayout from "../../layout/MemberLayout";
import UserHeader from "../../Components/userHeader";
import Link from "next/link";
import "../../styles/UserRecentTransactionsTable.css";
import { formatTransactionMeetingDate } from "@/utils/meetingDateUtils";

// A fine's label comes from its fine_type, never from the category alone -- 'fines'
// covers absence and everything else, and calling a late-arrival penalty an absence is
// how a member ends up disputing a record that was right about the money.
const FINE_LABELS: Record<string, string> = {
  absenteeism: "Absence Fine",
  late: "Late Arrival Fine",
  misconduct: "Misconduct Fine",
  loan_default: "Late Repayment Fine",
  other: "Fine"
};

interface Transaction {
  id: string;
  amount: number;
  category: string;
  fine_type?: string | null;
  status: string;
  created_at: string;
  completed_at?: string;
  approved_at?: string;
  profile_id: string;
  requested_by?: string;
  description?: string;
  week_number?: number;
}

/**
 * Colour per transaction type, keyed on the raw category rather than the display label.
 *
 * Keyed that way because the label is not stable: a fine renders as whatever FINE_LABELS
 * calls its reason, so matching on text would leave every fine but the absence one
 * uncoloured. The legacy 'devt' and 'social' spellings are folded in here for the same
 * reason they are folded in everywhere else -- an old row must not lose its colour.
 *
 * These are the same six pairs contributionApprovals.css uses, so a member and an admin
 * looking at the same contribution see the same colour.
 */
const TYPE_CLASS: Record<string, string> = {
  shares: "type-shares",
  development_fund: "type-development",
  devt: "type-development",
  social_fund: "type-social",
  social: "type-social",
  savings: "type-savings",
  loan_disbursement: "type-loan",
  loan_repayment: "type-repayment",
  fines: "type-fine",
  fine: "type-fine",
  penalty: "type-fine",
  absenteeism: "type-fine"
};

function TransactionTypeBadge({
  category,
  fineType,
  label
}: { category: string; fineType?: string | null; label: string }) {
  let modifier = TYPE_CLASS[String(category || "").trim().toLowerCase()] || "type-default";

  // An absence fine is red and every other fine is violet, matching the card. Split here
  // rather than in the map because both come through as the same category.
  if (modifier === "type-fine" && String(fineType || "absenteeism").trim().toLowerCase() === "absenteeism") {
    modifier = "type-fine-absence";
  }

  return (
    <td className="type-cell">
      <span className={`transaction-badge ${modifier}`}>{label}</span>
    </td>
  );
}

function TransactionsList() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [saccoMeetingDay, setSaccoMeetingDay] = useState<string>("Wednesday");
  const [loading, setLoading] = useState<boolean>(true);

  async function fetchTransactions() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', session.user.id)
        .single();

      if (profile?.group_id) {
        const { data: settings } = await supabase
          .from('sacco_settings')
          .select('meeting_day')
          .ilike('group_code', profile.group_id.trim())
          .limit(1)
          .maybeSingle();

        if (settings?.meeting_day) {
          setSaccoMeetingDay(settings.meeting_day);
        }
      }

      const res = await fetch("/api/user-transactions?limit=50", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`
        }
      });
      const data = await res.json();
      if (res.ok && data.transactions) {
        setTransactions(data.transactions);
      }
    } catch (err) {
      console.warn("Failed to fetch transactions:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTransactions();

    const channel = supabase
      .channel('member-transactions-page-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        () => {
          fetchTransactions();
        }
      )
      .subscribe();

    function handleSettingsUpdate(e: any) {
      if (e.detail?.meetingDay) {
        setSaccoMeetingDay(e.detail.meetingDay);
      } else if (e.detail?.meeting_day) {
        setSaccoMeetingDay(e.detail.meeting_day);
      }
      fetchTransactions();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_settings_updated", handleSettingsUpdate);
      window.addEventListener("sacco_transaction_updated", fetchTransactions);
      window.addEventListener("manual_contribution_logged", fetchTransactions);
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_settings_updated", handleSettingsUpdate);
        window.removeEventListener("sacco_transaction_updated", fetchTransactions);
        window.removeEventListener("manual_contribution_logged", fetchTransactions);
      }
    };
  }, []);

  return (
    <div className="recent-transactions-card card" style={{ marginTop: "2rem" }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 className="card-title">All Account Transactions</h3>
          <p style={{ margin: "0.2rem 0 0", fontSize: "1.2rem", color: "#64748b" }}>
            Complete audit trail of all contribution requests and payments.
          </p>
        </div>
        <Link href="/dashboard" className="view-all-link">
          Back to Dashboard
        </Link>
      </div>

      <div className="table-responsive" style={{ marginTop: "1rem" }}>
        <table className="transactions-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount </th>
              <th>Requested By</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                  Loading transactions...
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                  No transactions found.
                </td>
              </tr>
            ) : (
              transactions.map((transaction) => {
                const formattedDate = formatTransactionMeetingDate(transaction, saccoMeetingDay);
                
                let displayType = transaction.category;
                if (displayType === "social_fund") displayType = "Social Fund";
                if (displayType === "development_fund") displayType = "Development";
                if (displayType === "shares") displayType = "Shares";
                if (displayType === "savings") displayType = "Savings";
                if (displayType === "loan_disbursement") displayType = "Loan";
                if (displayType === "loan_repayment") displayType = "Loan Repayment";
                // Not every fine is an absence one. Read the reason off the row rather
                // than telling a member they missed a meeting they in fact attended.
                if (displayType === "fines" || displayType === "fine" || displayType === "penalty" || displayType === "absenteeism") {
                  displayType = FINE_LABELS[transaction.fine_type || "absenteeism"] || "Fine";
                }

                const isApproved = transaction.status === "completed" || transaction.status === "approved";
                const isPending = transaction.status === "pending";

                return (
                  <tr key={transaction.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {formattedDate}
                    </td>
                    <TransactionTypeBadge
                      category={transaction.category}
                      fineType={transaction.fine_type}
                      label={displayType}
                    />
                    <td className="amount-cell">{Number(transaction.amount).toLocaleString()}</td>
                    <td>
                      <span style={{ fontWeight: 600, color: "var(--text-dark)" }}>
                        {transaction.requested_by === transaction.profile_id ? "Self" : "Admin"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${isApproved ? "success" : isPending ? "pending" : "danger"}`}
                      >
                        {transaction.status ? transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1) : "Completed"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <ProtectedRoute>
      <MemberLayout>
        <UserHeader />
        <TransactionsList />
      </MemberLayout>
    </ProtectedRoute>
  );
}
