import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient.js";
import { useToast } from "../context/ToastContext";
import "../styles/UserRecentTransactionsTable.css";

export default function UserRecentTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [saccoCurrentWeek, setSaccoCurrentWeek] = useState(1);
  const [loading, setLoading] = useState(true);
  const { showSuccess, showError } = useToast();

  async function fetchTransactions() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Fetch user's sacco group current_week setting
      const { data: profile } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', session.user.id)
        .single();

      if (profile?.group_id) {
        const { data: saccoData } = await supabase
          .from('saccos')
          .select('current_week')
          .ilike('group_code', profile.group_id.trim())
          .limit(1)
          .single();

        if (saccoData?.current_week) {
          setSaccoCurrentWeek(Number(saccoData.current_week) || 1);
        }
      }

      const res = await fetch("/api/user-transactions?limit=10", {
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

    // Subscribe to real-time database changes on the transactions table for members
    const channel = supabase
      .channel('member-transactions-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        (payload) => {
          fetchTransactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleApprove = async (transactionId) => {
    try {
      const { data, error } = await supabase.rpc("approve_member_transaction", {
        p_transaction_id: transactionId
      });
      if (error) throw error;
      showSuccess("Transaction approved successfully!");
      fetchTransactions();
    } catch (err) {
      showError("Failed to approve transaction: " + err.message);
    }
  };

  const handleReject = async (transactionId) => {
    try {
      const { data, error } = await supabase.rpc("reject_member_transaction", {
        p_transaction_id: transactionId
      });
      if (error) throw error;
      showSuccess("Transaction rejected.");
      fetchTransactions();
    } catch (err) {
      showError("Failed to reject transaction: " + err.message);
    }
  };

  return (
    <section className="recent-transactions-section">
      <div className="quick-actions">
        <div
          className="section-header"
          style={{ marginBottom: "25px", display: "flex" }}
        >
          <h3 className="section-title">Recent Transactions</h3>
          <Link
            href="/transactions"
            style={{
              color: "var(--primary-color)",
              textDecoration: "none",
              fontSize: "1.8rem",
              fontWeight: "600",
            }}
          >
            View All
          </Link>
        </div>
        <div className="recent-transactions-table">
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
                  <td colSpan="5" style={{ textAlign: "center", padding: "1rem" }}>
                    Loading transactions...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: "center", padding: "1rem" }}>
                    No recent transactions.
                  </td>
                </tr>
              ) : (
                transactions.map((transaction) => {
                  const dateObj = new Date(transaction.created_at);
                  const day = dateObj.getDate();
                  const month = dateObj.toLocaleDateString('en-US', { month: 'long' });
                  
                  let weekNum = null;
                  if (transaction.week_number) {
                    weekNum = Number(transaction.week_number);
                  } else if (transaction.description) {
                    const match = transaction.description.match(/week\s*(\d+)/i);
                    if (match) {
                      weekNum = parseInt(match[1], 10);
                    }
                  }
                  if (!weekNum) {
                    weekNum = saccoCurrentWeek || 1;
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
                  
                  // Map category to a friendly display string
                  let displayType = transaction.category;
                  if (displayType === "social_fund") displayType = "Social Fund";
                  if (displayType === "development_fund") displayType = "Development";
                  if (displayType === "shares") displayType = "Shares";
                  if (displayType === "savings") displayType = "Savings";

                  return (
                    <tr key={transaction.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {formattedDate}
                      </td>
                      <TransactionTypeBadge type={displayType} />
                      <td className="amount-cell">{Number(transaction.amount).toLocaleString()}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: "var(--text-dark)" }}>
                          {transaction.requested_by === transaction.profile_id ? "Self" : "Admin"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                          <span
                            className={`status-badge ${
                              transaction.status === "completed" || transaction.status === "approved"
                                ? "success"
                                : transaction.status === "pending" ? "pending" : "danger"
                            }`}
                          >
                            {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
                          </span>
                          {transaction.status === 'pending' && transaction.requested_by && transaction.requested_by !== transaction.profile_id && (
                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <button 
                                onClick={() => handleApprove(transaction.id)}
                                style={{
                                  background: "#22c55e",
                                  color: "white",
                                  border: "none",
                                  padding: "0.4rem 0.8rem",
                                  borderRadius: "0.4rem",
                                  fontSize: "1.1rem",
                                  fontWeight: 600,
                                  cursor: "pointer"
                                }}
                              >
                                Approve
                              </button>
                              <button 
                                onClick={() => handleReject(transaction.id)}
                                style={{
                                  background: "#ef4444",
                                  color: "white",
                                  border: "none",
                                  padding: "0.4rem 0.8rem",
                                  borderRadius: "0.4rem",
                                  fontSize: "1.1rem",
                                  fontWeight: 600,
                                  cursor: "pointer"
                                }}
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
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
  );
}

//Updating the badge component to handle conditional rendering
function TransactionTypeBadge({ type }) {
  const typeStyles = {
    "Social Fund": { color: "#ef4444", backgroundColor: "#ef44441a" },
    Development: { color: "#10b981", backgroundColor: "#10b9811a" },
    "Loan Request": { color: "#d97706", backgroundColor: "#fef3c7" }, // Extrapolated colors for the loan badge
    Shares: { color: "#253b8e", backgroundColor: "#ebf0fe" },
  };
  // Fallback styling just in case a type comes back that isn't in the map above
  const defaultStyle = { color: "#4b5563", backgroundColor: "#f3f4f6" };

  // Select the style based on the type, or use the default
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
