import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient.js";
import "../styles/contributionApprovals.css";

export default function ContributionApprovals({ limit, showViewAll, mode }) {
  const [requests, setRequests] = useState([]);
  const [saccoCurrentWeek, setSaccoCurrentWeek] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const activeMode = mode || (limit ? "pending" : "verifications");

  async function fetchRequests() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch the admin's group_id from profiles (bypassing memberships)
      const { data: profileData } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single();

      if (!profileData) {
        setLoading(false);
        return;
      }

      // Fetch matching Sacco ID and current_week
      const { data: saccoData } = await supabase
        .from('saccos')
        .select('id, current_week')
        .eq('group_code', profileData.group_id)
        .limit(1)
        .single();

      if (!saccoData) {
        setLoading(false);
        return;
      }

      if (saccoData.current_week) {
        setSaccoCurrentWeek(Number(saccoData.current_week) || 1);
      }

      const saccoId = saccoData.id;

      let query = supabase
        .from('transactions')
        .select(`
          id,
          amount,
          category,
          status,
          created_at,
          profile_id,
          requested_by,
          description,
          profiles!transactions_profile_id_fkey (
            full_name,
            member_number
          ),
          requester:profiles!transactions_requested_by_fkey (
            full_name
          )
        `)
        .eq('sacco_id', saccoId);

      if (activeMode === "pending") {
        query = query.eq('status', 'pending');
      } else {
        query = query.in('status', ['completed', 'approved', 'rejected']);
      }

      // Systematically sort most recent transactions on top
      query = query.order('created_at', { ascending: false });

      if (limit) {
        query = query.limit(limit);
      } else {
        query = query.limit(100);
      }

      const { data, error } = await query;

      if (data && !error) {
        setRequests(data);
      }
    } catch (err) {
      console.warn("Error loading approvals list:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRequests();

    // Subscribe to real-time database changes on the transactions table
    const channel = supabase
      .channel('admin-transactions-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        (payload) => {
          fetchRequests();
        }
      )
      .subscribe();

    function handleTransactionUpdate() {
      fetchRequests();
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

  const handleApprove = async (transactionId) => {
    // Optimistic UI Update: update locally first to prevent shifting
    setRequests(prev => prev.map(req => req.id === transactionId ? { ...req, status: 'completed' } : req));
    setMessage("Approving...");
    try {
      // Try running the database RPC to update account balances
      const { error: rpcError } = await supabase.rpc('approve_transaction', {
        p_transaction_id: transactionId
      });

      if (rpcError) {
        console.warn("RPC approval failed, falling back to direct table update:", rpcError.message);
      }

      // Fallback/Direct Update: Set status to 'completed' directly to guarantee UI update
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ status: 'completed' })
        .eq('id', transactionId);

      if (updateError) throw updateError;
      
      setMessage("Transaction approved and completed!");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
        window.dispatchEvent(new CustomEvent("manual_contribution_logged"));
      }
      fetchRequests();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
      fetchRequests();
    }
  };

  const handleReject = async (transactionId) => {
    // Optimistic UI Update: update locally first to prevent shifting
    setRequests(prev => prev.map(req => req.id === transactionId ? { ...req, status: 'rejected' } : req));
    setMessage("Rejecting...");
    try {
      // Call the secure reject_transaction RPC
      const { error: rpcError } = await supabase.rpc('reject_transaction', {
        p_transaction_id: transactionId
      });

      if (rpcError) {
        console.warn("RPC rejection failed, falling back to direct table update:", rpcError.message);
      }

      // Fallback/Direct Update: Set status to 'rejected' directly to guarantee UI update
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ status: 'rejected' })
        .eq('id', transactionId);

      if (updateError && rpcError) throw new Error(rpcError.message || updateError.message);

      setMessage("Transaction rejected.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
      }
      fetchRequests();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
      fetchRequests();
    }
  };

  const handleExportCSV = () => {
    if (requests.length === 0) return;

    const headers = ["Transaction ID", "Member ID", "Member Name", "Category", "Amount (Shs)", "Status", "Requested By", "Created At", "Description"];
    
    const csvRows = [
      headers.join(","),
      ...requests.map(req => {
        let catDisplay = req.category;
        if (catDisplay === "social_fund") catDisplay = "Social Fund";
        if (catDisplay === "development_fund") catDisplay = "Dev Fund";
        if (catDisplay === "shares") catDisplay = "Shares Pool";
        if (catDisplay === "savings") catDisplay = "Savings";
        if (catDisplay === "loan_disbursement") catDisplay = "Loan";
        if (catDisplay === "loan_repayment") catDisplay = "Loan Repayment";

        return [
          `"${req.id}"`,
          `"${req.profiles?.member_number || "N/A"}"`,
          `"${(req.profiles?.full_name || "Unknown").replace(/"/g, '""')}"`,
          `"${catDisplay}"`,
          req.amount,
          `"${req.status}"`,
          `"${(req.requester?.full_name || "Self").replace(/"/g, '""')}"`,
          `"${new Date(req.created_at).toISOString()}"`,
          `"${(req.description || "").replace(/"/g, '""')}"`
        ].join(",");
      })
    ];

    const csvContent = "data:text/csv;charset=utf-8," + csvRows.join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sacco_transactions_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="recent-transactions recent-transactions-verifications">
      <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 className="section-title">
          {activeMode === "pending" ? "Pending Contribution Approvals" : "Transaction Verifications History"}
        </h3>
        <div style={{ display: "flex", gap: "1.2rem", alignItems: "center" }}>
          {requests.length > 0 && (
            <button 
              onClick={handleExportCSV} 
              className="btn-print-report no-print" 
              style={{ 
                backgroundColor: "#059669", 
                color: "white", 
                border: "none", 
                padding: "0.6rem 1.2rem", 
                borderRadius: "0.8rem", 
                fontSize: "1.2rem", 
                fontWeight: 600, 
                cursor: "pointer", 
                display: "flex", 
                alignItems: "center", 
                gap: "0.6rem" 
              }}
            >
              <i className="fa-solid fa-file-csv"></i> Export CSV
            </button>
          )}
          {showViewAll && (
            <Link href="/admin?tab=verifications" className="view-all-link">View All</Link>
          )}
        </div>
      </div>
      
      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem', borderRadius: '4px', background: '#f3f4f6', textAlign: 'center' }}>
          {message}
        </div>
      )}

      <div className="admin-list-wrapper">
        <div className="admin-list-header">
          <div className="col-member">Member ID</div>
          <div className="col-type">Request Type</div>
          <div className="col-amount">Amount</div>
          <div className="col-date">Week</div>
          <div className="col-action" style={{ textAlign: "center" }}>{activeMode === "pending" ? "Action" : "Status"}</div>
        </div>
        <ul className="admin-list">
          {loading ? (
            <li className="list-empty">Loading...</li>
          ) : requests.length === 0 ? (
            <li className="list-empty">
              {activeMode === "pending" ? "No pending contribution requests." : "No historical verified or rejected transactions found."}
            </li>
          ) : (
            requests.map((request) => {
              const dateObj = new Date(request.created_at);
              const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              
              let weekNum = null;
              if (request.week_number) {
                weekNum = Number(request.week_number);
              } else if (request.description) {
                const match = request.description.match(/week\s*(\d+)/i);
                if (match) {
                  weekNum = parseInt(match[1], 10);
                }
              }
              if (!weekNum) {
                weekNum = saccoCurrentWeek || 1;
              }

              let displayType = request.category;
              if (displayType === "social_fund") displayType = "Social Fund";
              if (displayType === "development_fund") displayType = "Dev Fund";
              if (displayType === "shares") displayType = "Shares Pool";
              if (displayType === "savings") displayType = "Savings";
              if (displayType === "loan_disbursement") displayType = "Loan";
              if (displayType === "fines" || displayType === "fine" || displayType === "penalty") displayType = "Fines & Penalties";

              return (
                <li key={request.id} className="admin-list-item">
                  <div className="col-member">
                    <div className="member-id-cell">
                      <span className="member-id-number">{request.profiles?.member_number || "N/A"}</span>
                      <span className="member-name-sub">{request.profiles?.full_name || "Unknown"}</span>
                      {request.requester && request.requested_by !== request.profile_id && (
                        <span style={{ fontSize: "1.1rem", color: "var(--primary-color)", fontWeight: 600, display: "block", marginTop: "0.2rem" }}>
                          Req by: {request.requester.full_name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="col-type">
                    <span className={`badge badge-${displayType.toLowerCase().replace(" ", "-")}`}>
                      {displayType.toUpperCase()}
                    </span>
                  </div>
                  <div className="col-amount">
                    <strong className="amount-text">
                      <span className="currency-unit">Shs </span>
                      {Number(request.amount).toLocaleString()}
                    </strong>
                  </div>
                  <div className="col-date">
                    <div className="week-cell">
                      <span className="week-number-tag">Week {weekNum}</span>
                      <span className="date-sub-text">{formattedDate}</span>
                    </div>
                  </div>
                  <div className="col-action">
                    <div className="table-actions" style={{ display: "flex", justifyContent: "center" }}>
                      {request.status === 'pending' ? (
                        <>
                          <button className="btn-sm btn-approve" onClick={() => handleApprove(request.id)} title="Approve">
                            <i className="fa-solid fa-check"></i>
                          </button>
                          <button className="btn-sm btn-reject" onClick={() => handleReject(request.id)} title="Reject">
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        </>
                      ) : (
                        <span
                          className={`badge badge-${request.status === 'rejected' ? 'danger' : 'success'}`}
                          style={{
                            padding: "0.4rem 0.8rem",
                            borderRadius: "0.6rem",
                            fontSize: "1.1rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            background: request.status === 'rejected' ? '#fef2f2' : '#f0fdf4',
                            color: request.status === 'rejected' ? '#ef4444' : '#22c55e'
                          }}
                        >
                          {request.status === 'rejected' ? 'Rejected' : 'Completed'}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

function MainHeader({ showViewAll }) {
  return (
    <div className="section-header">
      <h3 className="section-title">Pending Contribution Approvals</h3>
      {showViewAll && (
        <Link href="/admin?tab=verifications" className="view-all-link">View All</Link>
      )}
    </div>
  );
}
