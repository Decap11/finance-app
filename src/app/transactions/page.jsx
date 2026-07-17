"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient.js";
import ProtectedRoute from "../../Components/ProtectedRoute";
import MemberLayout from "../../layout/MemberLayout";
import UserHeader from "../../Components/userHeader";
import Link from "next/link";
import "../../styles/UserRecentTransactionsTable.css";

function TransactionTypeBadge({ type }) {
  const typeStyles = {
    "Social Fund": { color: "#ef4444", backgroundColor: "#ef44441a" },
    Development: { color: "#10b981", backgroundColor: "#10b9811a" },
    "Loan Request": { color: "#d97706", backgroundColor: "#fef3c7" },
    Shares: { color: "#253b8e", backgroundColor: "#ebf0fe" },
  };
  const defaultStyle = { color: "#4b5563", backgroundColor: "#f3f4f6" };
  const currentStyle = typeStyles[type] || defaultStyle;

  return (
    <td>
      <span
        className="transaction-badge transfer"
        style={{
          color: currentStyle.color,
          backgroundColor: currentStyle.backgroundColor,
        }}
      >
        {type}
      </span>
    </td>
  );
}

function TransactionsList() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  async function fetchTransactions() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

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
                    <td colSpan="5" style={{ textAlign: "center", padding: "2rem" }}>
                      Loading transactions...
                    </td>
                  </tr>
                ) : transactions.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "2rem" }}>
                      No transactions found.
                    </td>
                  </tr>
                ) : (
                  transactions.map((transaction) => {
                    const dateObj = new Date(transaction.created_at);
                    const day = dateObj.getDate();
                    const month = dateObj.toLocaleDateString('en-US', { month: 'long' });
                    
                    let weekNum = null;
                    const match = transaction.description?.match(/\|\s*Week\s*(\d+)/i);
                    if (match) {
                      weekNum = parseInt(match[1], 10);
                    }
                    if (!weekNum) {
                      const startOfYear = new Date(dateObj.getFullYear(), 0, 1);
                      const diffInMs = dateObj - startOfYear;
                      const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
                      weekNum = Math.floor(diffInDays / 7) + 1;
                    }

                    const getOrdinal = (d) => {
                      if (d > 3 && d < 21) return 'th';
                      switch (d % 10) {
                        case 1:  return "st";
                        case 2:  return "nd";
                        case 3:  return "rd";
                        default: return "th";
                      }
                    };

                    const formattedDate = `${day}${getOrdinal(day)} ${month}, week ${weekNum}`;
                    
                    let displayType = transaction.category;
                    if (displayType === "social_fund") displayType = "Social Fund";
                    if (displayType === "development_fund") displayType = "Development";
                    if (displayType === "shares") displayType = "Shares";
                    if (displayType === "savings") displayType = "Savings";

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
