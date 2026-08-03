import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient";
import { useToast } from "../context/ToastContext";
import { formatTransactionMeetingDate } from "../utils/meetingDateUtils";
import "../styles/UserRecentTransactionsTable.css";

// A fine's label comes from its fine_type, never from the category alone -- 'fines'
// covers absence and everything else, and calling a late-arrival penalty an absence is
// how a member ends up disputing a record that was right about the money.
const FINE_LABELS = {
  absenteeism: "Absence Fine",
  late: "Late Arrival Fine",
  misconduct: "Misconduct Fine",
  loan_default: "Late Repayment Fine",
  other: "Fine"
};

export default function UserRecentTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [saccoCurrentWeek, setSaccoCurrentWeek] = useState(1);
  const [saccoMeetingDay, setSaccoMeetingDay] = useState("Wednesday");
  const [loading, setLoading] = useState(true);
  const { showSuccess, showError } = useToast();

  async function fetchTransactions() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Fetch user's sacco group settings
      const { data: profile } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', session.user.id)
        .single();

      if (profile?.group_id) {
        const activeGroupCode = profile.group_id.trim();
        const [saccoRes, settingsRes] = await Promise.all([
          supabase
            .from('saccos')
            .select('current_week')
            .ilike('group_code', activeGroupCode)
            .limit(1)
            .maybeSingle(),
          supabase
            .from('sacco_settings')
            .select('meeting_day')
            .ilike('group_code', activeGroupCode)
            .limit(1)
            .maybeSingle()
        ]);

        if (saccoRes.data?.current_week) {
          setSaccoCurrentWeek(Number(saccoRes.data.current_week) || 1);
        }
        if (settingsRes.data?.meeting_day) {
          setSaccoMeetingDay(settingsRes.data.meeting_day);
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

    const channel = supabase
      .channel('member-transactions-realtime')
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

    function handleSettingsUpdate(e) {
      if (e.detail?.meetingDay) {
        setSaccoMeetingDay(e.detail.meetingDay);
      } else if (e.detail?.meeting_day) {
        setSaccoMeetingDay(e.detail.meeting_day);
      }
      fetchTransactions();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_transaction_updated", handleTransactionUpdate);
      window.addEventListener("manual_contribution_logged", handleTransactionUpdate);
      window.addEventListener("sacco_settings_updated", handleSettingsUpdate);
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_transaction_updated", handleTransactionUpdate);
        window.removeEventListener("manual_contribution_logged", handleTransactionUpdate);
        window.removeEventListener("sacco_settings_updated", handleSettingsUpdate);
      }
    };
  }, []);

  const handleApprove = async (transactionId) => {
    try {
      const { error } = await supabase.rpc("approve_member_transaction", {
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
      const { error } = await supabase.rpc("reject_member_transaction", {
        p_transaction_id: transactionId
      });
      if (error) throw error;
      showSuccess("Transaction rejected successfully.");
      fetchTransactions();
    } catch (err) {
      showError("Failed to reject transaction: " + err.message);
    }
  };

  return (
    <div className="recent-transactions-card card">
      <div className="card-header">
        <h3 className="card-title">Recent Transactions</h3>
        <Link href="/transactions" className="view-all-link">
          View All Transactions
        </Link>
      </div>

      <div className="table-responsive">
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
                const formattedDate = formatTransactionMeetingDate(transaction, saccoMeetingDay, saccoCurrentWeek);
                
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
                          className={`status-badge ${isApproved ? "success" : isPending ? "pending" : "danger"}`}
                        >
                          {transaction.status ? transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1) : "Completed"}
                        </span>
                        {isPending && transaction.requested_by && transaction.requested_by !== transaction.profile_id && (
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button
                              onClick={() => handleApprove(transaction.id)}
                              style={{
                                padding: "0.3rem 0.6rem",
                                borderRadius: "0.4rem",
                                border: "none",
                                background: "#10b981",
                                color: "white",
                                cursor: "pointer",
                                fontSize: "1.1rem"
                              }}
                              title="Approve Transaction"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleReject(transaction.id)}
                              style={{
                                padding: "0.3rem 0.6rem",
                                borderRadius: "0.4rem",
                                border: "none",
                                background: "#ef4444",
                                color: "white",
                                cursor: "pointer",
                                fontSize: "1.1rem"
                              }}
                              title="Reject Transaction"
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
  );
}

function TransactionTypeBadge({ type }) {
  const typeStyles = {
    "Social Fund": { color: "#ef4444", backgroundColor: "#ef44441a" },
    Development: { color: "#10b981", backgroundColor: "#10b9811a" },
    Loan: { color: "#d97706", backgroundColor: "#fef3c7" },
    "Loan Repayment": { color: "#059669", backgroundColor: "#d1fae5" },
    Savings: { color: "#2563eb", backgroundColor: "rgba(59, 130, 246, 0.1)" },
    Shares: { color: "#253b8e", backgroundColor: "#ebf0fe" },
    // Absence keeps the red it has always had; other fines take the fines-pool violet so
    // the two are distinguishable at a glance in a member's own history.
    "Absence Fine": { color: "#dc2626", backgroundColor: "#fee2e2" },
    "Late Arrival Fine": { color: "#8b5cf6", backgroundColor: "#8b5cf61a" },
    "Misconduct Fine": { color: "#8b5cf6", backgroundColor: "#8b5cf61a" },
    "Late Repayment Fine": { color: "#8b5cf6", backgroundColor: "#8b5cf61a" },
    Fine: { color: "#8b5cf6", backgroundColor: "#8b5cf61a" }
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
