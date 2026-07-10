import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/featureArea.css";

export default function ManualContributionLog({ allMembers }) {
  const [addMember, setAddMember] = useState("");
  const [addFundType, setAddFundType] = useState("savings");
  const [addAmount, setAddAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!addMember || !addFundType || !addAmount) {
      setMessage("Please fill in all fields before submitting.");
      return;
    }
    
    setLoading(true);
    setMessage("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");

      // Get admin's sacco_id
      const { data: membershipData } = await supabase
        .from('sacco_memberships')
        .select('sacco_id')
        .eq('profile_id', user.id)
        .eq('role', 'admin')
        .limit(1)
        .single();
        
      if (!membershipData) throw new Error("Admin membership not found");

      // Create a pending transaction for this member
      // For a real app, you might want to call process_transaction directly if admins don't need approval
      // Here, we just insert a pending transaction which the admin can then approve.
      const { error } = await supabase
        .from('transactions')
        .insert({
          sacco_id: membershipData.sacco_id,
          profile_id: addMember,
          amount: Number(addAmount),
          direction: 'credit',
          category: addFundType,
          status: 'pending',
          description: 'Manual contribution log by admin'
        });

      if (error) throw error;

      setMessage("Contribution logged successfully (Pending Approval).");

      // Reset form fields
      setAddMember("");
      setAddFundType("savings");
      setAddAmount("");
    } catch (err) {
      setMessage(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="quick-actions quick-actions-log" onSubmit={handleSubmit}>
      <div className="section-header section-header-log">
        <h3 className="section-title">
          <i className="fa-solid fa-file-invoice-dollar icon-log"></i>Log
          Contribution
        </h3>
      </div>
      
      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem', borderRadius: '4px', background: message.includes('success') ? '#d1fae5' : '#fee2e2', color: message.includes('success') ? '#065f46' : '#991b1b', textAlign: 'center' }}>
          {message}
        </div>
      )}

      <div className="admin-form-group admin-form-group-member">
        <label className="admin-label-member">Select Member</label>
        <select
          className="admin-select-member"
          value={addMember}
          onChange={(e) => setAddMember(e.target.value)}
        >
          <option value="">-- Select Member --</option>
          {allMembers.map(({ id, name, memberId }) => (
            <option key={id} value={id}>
              {name} ({memberId})
            </option>
          ))}
        </select>
      </div>
      <div className="admin-form-group admin-form-group-fund">
        <label className="admin-label-fund">Fund Pool Type</label>
        <select
          className="admin-select-fund"
          value={addFundType}
          onChange={(e) => setAddFundType(e.target.value)}
        >
          <option value="savings">Savings</option>
          <option value="shares">Shares Pool</option>
          <option value="development_fund">Development Fund</option>
          <option value="social_fund">Social Fund</option>
        </select>
      </div>
      <div className="admin-form-group admin-form-group-amount">
        <label className="admin-label-amount">Amount (Shs)</label>
        <input
          type="number"
          placeholder="Enter amount..."
          className="admin-input-amount"
          value={addAmount}
          onChange={(e) => setAddAmount(Number(e.target.value))}
        />
      </div>
      <button className="admin-btn-primary admin-btn-register-contribution" disabled={loading}>
        {loading ? "Logging..." : "Register Contribution"}
        {!loading && <i
          className="fa-solid fa-check-double"
          style={{ marginLeft: "0.5rem" }}
        ></i>}
      </button>
    </form>
  );
}
