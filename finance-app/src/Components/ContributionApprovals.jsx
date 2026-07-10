import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/contributionApprovals.css";

export default function ContributionApprovals() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function fetchRequests() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch the admin's SACCO ID first
      const { data: membershipData } = await supabase
        .from('sacco_memberships')
        .select('sacco_id')
        .eq('profile_id', user.id)
        .eq('role', 'admin')
        .limit(1)
        .single();

      if (!membershipData) {
        setLoading(false);
        return;
      }

      // Fetch pending transactions for this SACCO, joining with profiles for member info
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          id,
          amount,
          category,
          created_at,
          profiles (
            full_name,
            member_number
          )
        `)
        .eq('sacco_id', membershipData.sacco_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (data && !error) {
        setRequests(data);
      }
      setLoading(false);
    }

    fetchRequests();
  }, []);

  const handleApprove = async (transactionId) => {
    setMessage("Approving...");
    try {
      const { error } = await supabase.rpc('approve_transaction', {
        p_transaction_id: transactionId
      });

      if (error) throw error;
      
      setMessage("Transaction approved!");
      // Remove it from the list
      setRequests(requests.filter((r) => r.id !== transactionId));
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handleReject = async (transactionId) => {
    setMessage("Rejecting...");
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ status: 'rejected' })
        .eq('id', transactionId);

      if (error) throw error;

      setMessage("Transaction rejected.");
      setRequests(requests.filter((r) => r.id !== transactionId));
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  return (
    <div className="recent-transactions recent-transactions-verifications">
      <MainHeader />
      
      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem', borderRadius: '4px', background: '#f3f4f6', textAlign: 'center' }}>
          {message}
        </div>
      )}

      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <TableColumnHeader />
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{textAlign: "center", padding: "1rem"}}>Loading...</td></tr>
            ) : requests.length === 0 ? (
              <tr><td colSpan="6" style={{textAlign: "center", padding: "1rem"}}>No pending requests.</td></tr>
            ) : (
              requests.map((request) => {
                const dateObj = new Date(request.created_at);
                const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                const day = dateObj.getDate();
                const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
                const year = dateObj.getFullYear();
                const weekNum = Math.ceil(day / 7);

                const getOrdinal = (d) => {
                  if (d > 3 && d < 21) return 'th';
                  switch (d % 10) {
                    case 1:  return "st";
                    case 2:  return "nd";
                    case 3:  return "rd";
                    default: return "th";
                  }
                };

                const formattedDate = `Week ${weekNum} • ${weekday} ${day}${getOrdinal(day)} ${month} ${year}`;
                
                let displayType = request.category;
                if (displayType === "social_fund") displayType = "Social Fund";
                if (displayType === "development_fund") displayType = "Dev Fund";
                if (displayType === "shares") displayType = "Shares Pool";
                if (displayType === "savings") displayType = "Savings";

                return (
                  <tr key={request.id}>
                    <td>
                      <div className="member-id-cell">
                        <span className="member-id-number">{request.profiles?.member_number || "N/A"}</span>
                        <span className="member-name-sub">{request.profiles?.full_name || "Unknown"}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge badge-${displayType.toLowerCase().replace(" ", "-")}`}
                      >
                        {displayType.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <strong className="amount-text">Shs {Number(request.amount).toLocaleString()}</strong>
                    </td>
                    <td className="date-text">{formattedDate}</td>
                    <td>
                      <div className="table-actions">
                        <button className="btn-sm btn-approve" onClick={() => handleApprove(request.id)} title="Approve">
                          <i className="fa-solid fa-check"></i>
                        </button>
                        <button className="btn-sm btn-reject" onClick={() => handleReject(request.id)} title="Reject">
                          <i className="fa-solid fa-xmark"></i>
                        </button>
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

function MainHeader() {
  return (
    <div className="section-header">
      <h3 className="section-title">Pending Contribution Approvals</h3>
      <a href="/transactions" className="view-all-link">View All</a>
    </div>
  );
}

function TableColumnHeader() {
  return (
    <tr>
      <th>Member ID</th>
      <th>Request Type</th>
      <th>Amount</th>
      <th>Date</th>
      <th style={{ textAlign: "center" }}>Action</th>
    </tr>
  );
}
