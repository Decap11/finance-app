import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/featureArea.css";

export default function ManualContributionLog({ allMembers }) {
  const [addMember, setAddMember] = useState("");
  const [addFundType, setAddFundType] = useState("shares");
  const [addAmount, setAddAmount] = useState("");
  const [currentWeek, setCurrentWeek] = useState(1);
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [loggingMode, setLoggingMode] = useState("current"); // "current" or "historical"
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Additional fields for loan disbursement
  const [termMonths, setTermMonths] = useState(1);
  const [loanType, setLoanType] = useState("normal");
  const [purpose, setPurpose] = useState("Onboarded historical loan");

  useEffect(() => {
    async function loadSettings() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch("/api/sacco-settings", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();
        if (res.ok && data.settings) {
          const cw = Number(data.settings.currentWeek) || 1;
          setCurrentWeek(cw);
          if (loggingMode === "current") {
            setSelectedWeek(cw);
          }
        }
      } catch (err) {
        console.warn("Failed to load settings in manual contribution:", err);
      }
    }
    loadSettings();
  }, [loggingMode]);

  // Adjust selected week based on logging mode selection
  const handleModeChange = (mode) => {
    setLoggingMode(mode);
    if (mode === "current") {
      setSelectedWeek(currentWeek);
    } else {
      setSelectedWeek(Math.max(1, currentWeek - 1));
    }
    setMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!addMember || !addFundType || !addAmount || !selectedWeek) {
      setMessage("Please fill in all fields before submitting.");
      return;
    }
    
    setLoading(true);
    setMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not logged in");

      // Call the secure manual-contribution API to record the transaction/loan
      const res = await fetch("/api/admin/manual-contribution", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          memberId: addMember,
          amount: Number(addAmount),
          category: addFundType,
          weekNum: Number(selectedWeek),
          termMonths: addFundType === "loan_disbursement" ? Number(termMonths) : undefined,
          purpose: addFundType === "loan_disbursement" ? purpose : undefined,
          loanType: addFundType === "loan_disbursement" ? loanType : undefined
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log contribution");

      setMessage(`${addFundType === "loan_disbursement" ? "Loan record" : "Contribution"} logged successfully for Week ${selectedWeek}!`);

      // Reset form fields
      setAddMember("");
      setAddFundType("shares");
      setAddAmount("");
    } catch (err) {
      setMessage(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="quick-actions quick-actions-log" onSubmit={handleSubmit}>
      <div className="section-header section-header-log" style={{ marginBottom: "1.5rem" }}>
        <h3 className="section-title">
          <i className="fa-solid fa-file-invoice-dollar icon-log"></i>Log
          Contribution / Loan
        </h3>
      </div>

      {/* Logging Mode Toggle Button Bar */}
      <div className="toggle-container">
        <button
          type="button"
          onClick={() => handleModeChange("current")}
          className={`toggle-button ${loggingMode === "current" ? "active" : ""}`}
        >
          Current Week ({currentWeek})
        </button>
        <button
          type="button"
          onClick={() => handleModeChange("historical")}
          className={`toggle-button ${loggingMode === "historical" ? "active" : ""}`}
        >
          Historical Onboarding
        </button>
      </div>

      {loggingMode === "historical" && (
        <div style={{
          padding: "1rem 1.2rem",
          borderRadius: "0.8rem",
          backgroundColor: "#fef3c7",
          color: "#92400e",
          fontSize: "1.2rem",
          fontWeight: 600,
          marginBottom: "1.8rem",
          border: "0.1rem solid #fde68a"
        }}>
          <i className="fa-solid fa-circle-info" style={{ marginRight: "0.6rem" }}></i>
          Backfilling paper records for past weeks.
        </div>
      )}
      
      {message && (
        <div style={{
          marginBottom: '1.2rem',
          padding: '0.8rem',
          borderRadius: '0.8rem',
          background: message.includes('successfully') ? '#d1fae5' : '#fee2e2',
          color: message.includes('successfully') ? '#065f46' : '#991b1b',
          textAlign: 'center',
          fontSize: '1.2rem',
          fontWeight: '600'
        }}>
          {message}
        </div>
      )}

      <div className="admin-form-group admin-form-group-member">
        <label className="admin-label-member">Select Member</label>
        <select
          className="admin-select-member"
          value={addMember}
          onChange={(e) => setAddMember(e.target.value)}
          required
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
        <label className="admin-label-fund">Fund Pool / Transaction Type</label>
        <select
          className="admin-select-fund"
          value={addFundType}
          onChange={(e) => setAddFundType(e.target.value)}
          required
        >
          <option value="shares">Shares Pool</option>
          <option value="development_fund">Development Fund</option>
          <option value="social_fund">Social Fund</option>
          <option value="loan_disbursement">Loan Disbursement (New Loan)</option>
        </select>
      </div>

      {/* Dynamic Loan Fields */}
      {addFundType === "loan_disbursement" && (
        <>
          <div className="admin-form-group">
            <label>Loan Type</label>
            <select
              value={loanType}
              onChange={(e) => setLoanType(e.target.value)}
              required
            >
              <option value="normal">Normal Loan (5% p.m. interest)</option>
              <option value="social_fund">Social Fund Loan (Interest-free, 2 weeks)</option>
            </select>
          </div>

          <div className="admin-form-group">
            <label>Term (Months)</label>
            <input
              type="number"
              min="1"
              value={termMonths}
              onChange={(e) => setTermMonths(Number(e.target.value))}
              required
            />
          </div>

          <div className="admin-form-group">
            <label>Purpose</label>
            <input
              type="text"
              placeholder="e.g. business expansion"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              required
            />
          </div>
        </>
      )}

      {loggingMode === "historical" ? (
        <div className="admin-form-group">
          <label>Target Week</label>
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(Number(e.target.value))}
            style={{
              width: "100%",
              padding: "1rem",
              fontSize: "1.3rem",
              border: "0.1rem solid var(--border-color)",
              borderRadius: "0.8rem",
              backgroundColor: "var(--white)",
              color: "var(--text-dark)",
              outline: "none"
            }}
            required
          >
            {/* Allow selecting any week from Week 1 to currentWeek - 1 for onboarding */}
            {Array.from({ length: currentWeek - 1 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="admin-form-group" style={{ marginBottom: "1.6rem" }}>
          <label>Target Week</label>
          <div style={{
            padding: "1rem",
            fontSize: "1.3rem",
            fontWeight: "700",
            backgroundColor: "var(--bg-light)",
            border: "0.1rem solid var(--border-color)",
            borderRadius: "0.8rem",
            color: "var(--text-dark)"
          }}>
            Week {currentWeek} (Active Current Week)
          </div>
        </div>
      )}

      <div className="admin-form-group admin-form-group-amount">
        <label className="admin-label-amount">Amount (Shs)</label>
        <input
          type="number"
          placeholder="Enter amount..."
          className="admin-input-amount"
          value={addAmount}
          onChange={(e) => setAddAmount(e.target.value)}
          required
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
