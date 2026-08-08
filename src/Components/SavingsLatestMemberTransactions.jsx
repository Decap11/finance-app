"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient";
import { subscribeToOwnSaccoRows } from "../utils/realtimeScope";
import "../styles/savingsLatestMemberTransactions.css";

export default function SavingsLatestMemberTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadLatestTransactions() {
      try {
        setLoading(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setLoading(false);
          return;
        }

        const res = await fetch("/api/user-transactions?limit=5", {
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
        console.warn("Failed to load latest transactions:", err);
      } finally {
        setLoading(false);
      }
    }

    loadLatestTransactions();

    // A staff list of this SACCO's latest member activity.
    const unsubscribe = subscribeToOwnSaccoRows(
      ['transactions'],
      () => loadLatestTransactions(),
      'latest-member-tx'
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const getCategoryDetails = (cat) => {
    switch (cat) {
      case "shares":
        return {
          label: "Shares Pool",
          icon: "fa-chart-pie",
          bgColor: "#ebf0fe",
          color: "#253b8e"
        };
      case "development_fund":
        return {
          label: "Development Fund",
          icon: "fa-seedling",
          bgColor: "rgba(16, 185, 129, 0.1)",
          color: "#10b981"
        };
      case "social_fund":
        return {
          label: "Social Fund",
          icon: "fa-handshake-angle",
          bgColor: "rgba(239, 68, 68, 0.1)",
          color: "#ef4444"
        };
      default:
        return {
          label: cat ? cat.replace("_", " ") : "Contribution",
          icon: "fa-wallet",
          bgColor: "#f1f5f9",
          color: "#475569"
        };
    }
  };

  return (
    <div className="recent-transactions">
      <div className="section-header">
        <h3 className="section-title">Latest Member Contributions</h3>
        <Link href="/transactions">See All</Link>
      </div>

      <div className="transaction-list">
        {loading ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-light)" }}>
            Loading contributions...
          </div>
        ) : transactions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-light)" }}>
            <i className="fa-solid fa-inbox" style={{ fontSize: "3rem", marginBottom: "1rem", opacity: 0.5 }}></i>
            <p style={{ fontSize: "1.4rem", margin: 0 }}>No recent member contributions recorded yet.</p>
          </div>
        ) : (
          transactions.map((tx) => {
            const catInfo = getCategoryDetails(tx.category);
            const formattedAmount = Number(tx.amount || 0).toLocaleString();
            const statusClass = tx.status === "completed" || tx.status === "approved"
              ? "status-completed"
              : tx.status === "pending"
              ? "status-pending"
              : "status-failed";

            return (
              <div key={tx.id} className="transaction-item">
                <div className="tx-info">
                  <div
                    className="tx-icon"
                    style={{
                      backgroundColor: catInfo.bgColor,
                      color: catInfo.color,
                    }}
                  >
                    <i className={`fa-solid ${catInfo.icon}`}></i>
                  </div>
                  <div className="tx-details">
                    <h4>{tx.requester?.full_name || "SACCO Member"}</h4>
                    <p>{catInfo.label}</p>
                  </div>
                </div>
                <div className="tx-right">
                  <div className="tx-amount positive">+ Shs {formattedAmount}</div>
                  <div className={`tx-status ${statusClass}`}>
                    {tx.status ? tx.status.charAt(0).toUpperCase() + tx.status.slice(1) : "Pending"}
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
