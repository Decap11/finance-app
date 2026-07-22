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
    Savings: { color: "#2563eb", backgroundColor: "#dbeafe" }
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
  const [activeFilter, setActiveFilter] = useState("all");

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

    function handleTransactionUpdate() {
      fetchTransactions();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_transaction_updated", handleTransactionUpdate);
      window.addEventListener("manual_contribution_logged", handleTransactionUpdate);
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_transaction_updated", handleTransactionUpdate);
        window.removeEventListener("manual_contribution_logged", handleTransactionUpdate);
      }
    };
  }, []);

  // Filter category matching function
  const filteredTransactions = transactions.filter((tx) => {
    if (activeFilter === "all") return true;
    const cat = (tx.category || "").toLowerCase();
    if (activeFilter === "shares") return cat === "shares";
    if (activeFilter === "development_fund") return cat === "development_fund" || cat === "devt" || cat === "devt_fund";
    if (activeFilter === "social_fund") return cat === "social_fund" || cat === "social";
    if (activeFilter === "loan_disbursement") return cat === "loan_disbursement" || cat === "loan";
    return true;
  });

  const filterTabs = [
    { id: "all", label: "All Transactions", icon: "fa-solid fa-list-check" },
    { id: "shares", label: "Shares", icon: "fa-solid fa-chart-pie" },
    { id: "development_fund", label: "Development Fund", icon: "fa-solid fa-seedling" },
    { id: "social_fund", label: "Social Fund", icon: "fa-solid fa-handshake-angle" },
    { id: "loan_disbursement", label: "Loans", icon: "fa-solid fa-hand-holding-dollar" },
  ];

  return (
    <div className="dashboard-body">
      <UserHeader />
      
      <section className="recent-transactions-section" style={{ marginTop: "2.5rem" }}>
        <div className="quick-actions">
          <div className="section-header" style={{ marginBottom: "2rem", display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>
            <Link href="/dashboard" style={{
              color: "var(--primary-color)",
              textDecoration: "none",
              fontSize: "1.5rem",
              fontWeight: "600",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.6rem",
              padding: "0.6rem 1.2rem",
              borderRadius: "0.8rem",
              backgroundColor: "#f1f5f9",
              transition: "all 0.2s ease"
            }}>
              <i className="fa-solid fa-arrow-left"></i> Back
            </Link>
            <h3 className="section-title" style={{ margin: 0 }}>All Transactions History</h3>
          </div>

          {/* Interactive Category Filter Pills */}
          <div className="transaction-filters-bar" style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "2.4rem",
            paddingBottom: "1.2rem",
            borderBottom: "1px solid #f1f5f9"
          }}>
            {filterTabs.map((tab) => {
              const count = transactions.filter(tx => {
                if (tab.id === "all") return true;
                const cat = (tx.category || "").toLowerCase();
                if (tab.id === "shares") return cat === "shares";
                if (tab.id === "development_fund") return cat === "development_fund" || cat === "devt" || cat === "devt_fund";
                if (tab.id === "social_fund") return cat === "social_fund" || cat === "social";
                if (tab.id === "loan_disbursement") return cat === "loan_disbursement" || cat === "loan";
                return false;
              }).length;

              const isActive = activeFilter === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  style={{
                    padding: "0.8rem 1.6rem",
                    borderRadius: "1.2rem",
                    border: isActive ? "1px solid #253b8e" : "1px solid #e2e8f0",
                    backgroundColor: isActive ? "#253b8e" : "#ffffff",
                    color: isActive ? "#ffffff" : "#64748b",
                    fontWeight: "700",
                    fontSize: "1.3rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.8rem",
                    transition: "all 0.25s ease",
                    boxShadow: isActive ? "0 4px 12px rgba(37, 59, 142, 0.2)" : "none"
                  }}
                >
                  <i className={tab.icon}></i>
                  <span>{tab.label}</span>
                  <span style={{
                    padding: "0.2rem 0.6rem",
                    borderRadius: "1rem",
                    fontSize: "1.1rem",
                    backgroundColor: isActive ? "rgba(255, 255, 255, 0.2)" : "#f1f5f9",
                    color: isActive ? "#ffffff" : "#475569"
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
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
                ) : filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "2rem" }}>
                      No {activeFilter === "all" ? "" : activeFilter.replace("_", " ")} transactions found.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((transaction) => {
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
                    if (displayType === "social_fund" || displayType === "social") displayType = "Social Fund";
                    if (displayType === "development_fund" || displayType === "devt" || displayType === "devt_fund") displayType = "Development";
                    if (displayType === "shares") displayType = "Shares";
                    if (displayType === "savings") displayType = "Savings";
                    if (displayType === "loan_disbursement" || displayType === "loan") displayType = "Loan Request";

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
