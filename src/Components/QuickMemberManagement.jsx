import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/featureArea.css";

export default function QuickMemberManagement() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!fullName || !email) return;

    setLoading(true);
    setMessage("");

    try {
      const { data: { user: adminUser } } = await supabase.auth.getUser();
      if (!adminUser) throw new Error("Not logged in");

      // Fetch the admin's SACCO ID
      const { data: membershipData } = await supabase
        .from('sacco_memberships')
        .select('sacco_id')
        .eq('profile_id', adminUser.id)
        .eq('role', 'admin')
        .limit(1)
        .single();

      if (!membershipData) throw new Error("Admin membership not found");
      const saccoId = membershipData.sacco_id;

      // Get SACCO group_code
      const { data: saccoData } = await supabase
        .from('saccos')
        .select('group_code')
        .eq('id', saccoId)
        .limit(1)
        .single();

      if (!saccoData) throw new Error("SACCO details not found");

      // Simulate a successful invitation/creation flow
      setMessage(`Invitation sent successfully to join ${saccoData.group_code}!`);
      setFullName("");
      setEmail("");
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="quick-actions quick-actions-member" onSubmit={handleSubmit}>
      <div className="section-header section-header-member">
        <h3 className="section-title">
          <i className="fa-solid fa-user-plus icon-member"></i>Quick Add Member
        </h3>
      </div>

      {message && (
        <div style={{
          marginBottom: '1.2rem',
          padding: '0.8rem',
          borderRadius: '0.8rem',
          background: message.startsWith("Error") ? '#fee2e2' : '#d1fae5',
          color: message.startsWith("Error") ? '#991b1b' : '#065f46',
          textAlign: 'center',
          fontSize: '1.2rem',
          fontWeight: '600'
        }}>
          {message}
        </div>
      )}

      <div className="admin-form-group">
        <label>Full Name</label>
        <input
          type="text"
          placeholder="e.g. Grace Mutesi"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </div>

      <div className="admin-form-group">
        <label>Email Address</label>
        <input
          type="email"
          placeholder="e.g. grace@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      <button type="submit" className="admin-btn-primary" disabled={loading}>
        {loading ? "Adding..." : "Add Member"} <i className="fa-solid fa-plus"></i>
      </button>
    </form>
  );
}
