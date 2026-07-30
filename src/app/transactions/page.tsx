"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import ProtectedRoute from "../../Components/ProtectedRoute";
import MemberLayout from "../../layout/MemberLayout";
import UserHeader from "../../Components/userHeader";
import Link from "next/link";
import "../../styles/UserRecentTransactionsTable.css";
import { formatTransactionMeetingDate } from "@/utils/meetingDateUtils";

interface Transaction {
  id: string;
  amount: number;
  category: string;
  status: string;
  created_at: string;
  completed_at?: string;
  approved_at?: string;
  profile_id: string;
  requested_by?: string;
  description?: string;
  week_number?: number;
}

function TransactionTypeBadge({ type }: { type: string }) {
  let badgeClass = "badge-savings";
  let iconClass = "fa-vault";

  if (type === "Shares") {
    badgeClass = "badge-shares";
    iconClass = "fa-chart-pie";
  } else if (type === "Development") {
    badgeClass = "badge-dev";
    iconClass = "fa-building-shield";
  } else if (type === "Social Fund") {
    badgeClass = "badge-social";
    iconClass = "fa-hand-holding-heart";
  }

  return (
    <td className="type-cell">
      <span className={`transaction-badge ${badgeClass}`}>
        <i className={`fa-solid ${iconClass}`}></i>
        {type}
      </span>
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

      const res = await fetch("/api/user-transactions", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.transactions) {
        setTransactions(data.transactions);
      }
    } catch (err) {
      console.warn("Error loading user transactions:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTransactions();

    const channel = supabase
      .channel('member-all-transactions-realtime')
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

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="dashboard-body">
      <UserHeader />
      
      <section className="recent-transactions-section" style={{ marginTop: "2.5rem" }}>
        <div className="quick-actions">
          <div className="section-header" style={{ marginBottom: "25px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="section-title">All Transactions History</h3>
            <Link href="/dashboard" style={{
              color: "var(--primary-color)",
              textDecoration: "none",
              fontSize: "1.8rem",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem"
            }}>
              <i className="fa-solid fa-arrow-left"></i> Back to Dashboard
            </Link>
          </div>
          <div className="recent-transactions-table">
            <table className="transactions-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Requested By</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "2rem" }}>
                      Loading transactions...
                    </td>
                  </tr>
                ) : transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "2rem" }}>
                      No transactions found.
                    </td>
                  </tr>
                ) : (
                  transactions.map((transaction) => {
                    const formattedDate = formatTransactionMeetingDate(transaction, saccoMeetingDay);
                    
                    let displayType: string = transaction.category;
                    if (displayType === "social_fund") displayType = "Social Fund";
                    if (displayType === "development_fund") displayType = "Development";
                    if (displayType === "shares") displayType = "Shares";
                    if (displayType === "savings") displayType = "Savings";
                    if (displayType === "fines" || displayType === "fine" || displayType === "penalty" || displayType === "absenteeism") displayType = "Absenteeism Fine";

                    return (
                      <tr key={transaction.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{formattedDate}</td>
                        <TransactionTypeBadge type={displayType} />
                        <td className="amount-cell">{Number(transaction.amount).toLocaleString()}</td>
                        <td>
                          <span style={{ fontWeight: 600, color: "var(--text-dark)" }}>
                            {transaction.requested_by === transaction.profile_id ? "Self" : "Admin"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`status-badge ${
                              transaction.status === "completed" || transaction.status === "approved"
                                ? "success"
                                : transaction.status === "pending" ? "pending" : "danger"
                            }`}
                          >
                            {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
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
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <ProtectedRoute>
      <MemberLayout>
        <TransactionsList />
      </MemberLayout>
    </ProtectedRoute>
  );
}
