import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/loans.css";

export default function RecentLoansTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLoanActivity() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch("/api/loans", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.recentTransactions) {
          setTransactions(data.recentTransactions);
        }
      } catch (err) {
        console.warn("Error loading user loan transactions:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLoanActivity();
  }, []);

  const getStatusClass = (status) => {
    switch (status) {
      case "completed":
      case "approved":
        return "status-completed";
      case "pending":
        return "status-pending";
      default:
        return "status-danger";
    }
  };

  const formatAmount = (amount, isPositive) => {
    const sign = isPositive ? "+" : "-";
    return `${sign} Shs ${Number(amount).toLocaleString()}`;
  };

  return (
    <div className="recent-transactions">
      <div className="section-header">
        <h3 className="section-title">Recent Loan Activity</h3>
        <a href="/transactions">See All</a>
      </div>

      <div className="transaction-list">
        {loading ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-light)" }}>
            Loading activity...
          </div>
        ) : transactions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-light)" }}>
            No recent loan activity found.
          </div>
        ) : (
          transactions.map((transaction) => {
            const isPositive = transaction.direction === 'credit';
            const icon = isPositive ? "fa-solid fa-arrow-down" : "fa-solid fa-arrow-up";
            const txType = isPositive ? "deposit" : "withdraw";
            const title = transaction.category === 'loan_disbursement' ? "Loan Disbursement" : "Loan Repayment";
            
            const dateObj = new Date(transaction.created_at);
            const timeString = dateObj.toLocaleDateString() + ", " + dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

            return (
              <div key={transaction.id} className="transaction-item">
                <div className="tx-info">
                  <div className={`tx-icon ${txType}`}>
                    <i className={icon}></i>
                  </div>
                  <div className="tx-details">
                    <h4>{title}</h4>
                    <p>{timeString}</p>
                  </div>
                </div>
                <div className="tx-right">
                  <div
                    className={`tx-amount ${isPositive ? "positive" : "negative"}`}
                  >
                    {formatAmount(transaction.amount, isPositive)}
                  </div>
                  <div
                    className={`tx-status ${getStatusClass(transaction.status)}`}
                  >
                    {transaction.status.charAt(0).toUpperCase() +
                      transaction.status.slice(1)}
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
