"use client";

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/savingsLatestMemberTransactions.css";

export default function SavingsLatestMemberTransactions() {
  const [currentWeek, setCurrentWeek] = useState(1);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadWeeklyTransactions() {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        return;
      }

      const res = await fetch("/api/sacco-transactions", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch transactions");

      setCurrentWeek(data.currentWeek || 1);
      setTransactions(data.transactions || []);
    } catch (err) {
      console.warn("Error loading weekly transactions:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWeeklyTransactions();

    // Realtime listener for transaction approvals / updates
    const channel = supabase
      .channel('savings-latest-transactions-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        () => {
          loadWeeklyTransactions();
        }
      )
      .subscribe();

    function handleTransactionUpdate() {
      loadWeeklyTransactions();
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

  const getCategoryMeta = (category) => {
    switch (category) {
      case "shares":
        return {
          label: "Shares Pool",
          icon: "fa-solid fa-chart-pie",
          bgColor: "#ebf0fe",
          color: "#253b8e"
        };
      case "development_fund":
        return {
          label: "Development Fund",
          icon: "fa-solid fa-seedling",
          bgColor: "rgba(16, 185, 129, 0.1)",
          color: "#10b981"
        };
      case "social_fund":
        return {
          label: "Social Fund",
          icon: "fa-solid fa-handshake-angle",
          bgColor: "rgba(239, 68, 68, 0.1)",
          color: "#ef4444"
        };
      case "savings":
        return {
          label: "Savings Pool",
          icon: "fa-solid fa-piggy-bank",
          bgColor: "rgba(59, 130, 246, 0.1)",
          color: "#2563eb"
        };
      case "loan_disbursement":
        return {
          label: "Loan",
          icon: "fa-solid fa-hand-holding-dollar",
          bgColor: "#fef3c7",
          color: "#d97706"
        };
      case "loan_repayment":
        return {
          label: "Loan Repayment",
          icon: "fa-solid fa-money-bill-transfer",
          bgColor: "#d1fae5",
          color: "#059669"
        };
      default:
        return {
          label: category?.toUpperCase() || "Contribution",
          icon: "fa-solid fa-wallet",
          bgColor: "#f1f5f9",
          color: "#64748b"
        };
    }
  };

  return (
    <div className="recent-transactions">
      <div className="section-header">
        <h3 className="section-title">
          Latest Member Contributions (Week {currentWeek})
        </h3>
        <a href="/transactions" className="view-all-link">See All</a>
      </div>

      <div className="transaction-list">
        {loading ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "#64748b", fontSize: "1.3rem" }}>
            Loading Week {currentWeek} contributions...
          </div>
        ) : error ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "#ef4444", fontSize: "1.3rem" }}>
            {error}
          </div>
        ) : transactions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1.5rem", color: "#64748b", fontSize: "1.3rem" }}>
            <i className="fa-solid fa-folder-open" style={{ fontSize: "2.5rem", marginBottom: "1rem", display: "block", color: "#94a3b8" }}></i>
            No approved contributions recorded for Week {currentWeek} yet.
          </div>
        ) : (
          transactions.map((tx) => {
            const meta = getCategoryMeta(tx.category);
            const memberName = tx.profiles?.full_name || "Member";

            return (
              <div key={tx.id} className="transaction-item">
                <div className="tx-info">
                  <div
                    className="tx-icon"
                    style={{
                      backgroundColor: meta.bgColor,
                      color: meta.color,
                    }}
                  >
                    <i className={meta.icon}></i>
                  </div>
                  <div className="tx-details">
                    <h4>{memberName}</h4>
                    <p>{meta.label}</p>
                  </div>
                </div>
                <div className="tx-right">
                  <div className={`tx-amount ${tx.direction === "debit" ? "negative" : "positive"}`}>
                    {tx.direction === "debit" ? "- " : "+ "}Shs {Number(tx.amount).toLocaleString()}
                  </div>
                  <div className="tx-status status-completed">
                    {tx.status === "completed" ? "Completed" : "Approved"}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
