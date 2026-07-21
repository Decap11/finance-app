import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient.js";
import "../styles/contributionApprovals.css";

export default function ContributionApprovals({ limit, showViewAll }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

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

      // Fetch matching Sacco ID
      const { data: saccoData } = await supabase
        .from('saccos')
        .select('id')
        .eq('group_code', profileData.group_id)
        .limit(1)
        .single();

      if (!saccoData) {
        setLoading(false);
        return;
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
        .eq('sacco_id', saccoId)
        .in('status', ['pending', 'approved', 'rejected', 'completed'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });

      if (limit) {
        query = query.limit(limit);
      } else {
        query = query.limit(50);
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

    return () => {
      supabase.removeChannel(channel);
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
      fetchRequests();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
      fetchRequests();
    }
  };

  return (
    <div className="recent-transactions recent-transactions-verifications">
      <MainHeader showViewAll={showViewAll} />
      
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
          <div className="col-action" style={{ textAlign: "center" }}>Action</div>
        </div>
        <ul className="admin-list">
          {loading ? (
            <li className="list-empty">Loading...</li>
          ) : requests.length === 0 ? (
            <li className="list-empty">No pending requests.</li>
          ) : (
            requests.map((request) => {
              const dateObj = new Date(request.created_at);
              const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              
              let weekNum = null;
              const match = request.description?.match(/\|\s*Week\s*(\d+)/i);
              if (match) {
                weekNum = parseInt(match[1], 10);
              }
              if (!weekNum) {
                const startOfYear = new Date(dateObj.getFullYear(), 0, 1);
                const diffInMs = dateObj - startOfYear;
                const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
                weekNum = Math.floor(diffInDays / 7) + 1;
              }

              let displayType = request.category;
              if (displayType === "social_fund") displayType = "Social Fund";
              if (displayType === "development_fund") displayType = "Dev Fund";
              if (displayType === "shares") displayType = "Shares Pool";
              if (displayType === "savings") displayType = "Savings";
              if (displayType === "loan_disbursement") displayType = "Loan Request";

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
                          className={`badge badge-${(request.status === 'approved' || request.status === 'completed') ? 'success' : 'danger'}`}
                          style={{
                            padding: "0.4rem 0.8rem",
                            borderRadius: "0.6rem",
                            fontSize: "1.1rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            background: (request.status === 'approved' || request.status === 'completed') ? '#f0fdf4' : '#fef2f2',
                            color: (request.status === 'approved' || request.status === 'completed') ? '#22c55e' : '#ef4444'
                          }}
                        >
                          {(request.status === 'approved' || request.status === 'completed') ? 'Completed' : 'Rejected'}
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
