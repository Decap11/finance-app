import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";
import CustomSelect from "./CustomSelect.jsx";
import "../styles/featureArea.css";

const fundTypeOptions = [
  { value: "shares", label: "Shares Contribution" },
  { value: "development_fund", label: "Development Fund" },
  { value: "social_fund", label: "Social Fund" },
  { value: "fines", label: "Fines / Penalties" },
  { value: "loan_disbursement", label: "Loan Disbursement (Issue Loan)" }
];

const loanTypeOptions = [
  { value: "normal", label: "Normal Loan (5% p.m.)" },
  { value: "social_fund", label: "Social Fund Emergency (0%)" }
];

export default function ManualContributionLog({ allMembers }) {
  const [addMember, setAddMember] = useState("");
  const [addFundType, setAddFundType] = useState("shares");
  const [addAmount, setAddAmount] = useState("");
  const [currentWeek, setCurrentWeek] = useState(1);
  const [meetingDay, setMeetingDay] = useState("Wednesday");
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [loggingMode, setLoggingMode] = useState("current"); // "current" or "historical"
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Additional fields for loan disbursement
  const [termMonths, setTermMonths] = useState(1);
  const [loanType, setLoanType] = useState("normal");
  const [purpose, setPurpose] = useState("Onboarded historical loan");

  const memberOptions = (allMembers || []).map((m) => ({
    value: m.id,
    label: `${m.name} (${m.memberId || m.phone || "Member"})`
  }));

  function getMeetingDateLabel(year, meetingDayName, weekNum) {
    const DAY_INDICES = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const targetDayIndex = DAY_INDICES[meetingDayName] !== undefined ? DAY_INDICES[meetingDayName] : 3;

    let meetingCount = 0;
    const isLeap = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
    const daysInYear = isLeap ? 366 : 365;

    let targetDate = new Date(year, 0, 1);

    for (let d = 1; d <= daysInYear; d++) {
      const current = new Date(year, 0, d);
      if (current.getDay() === targetDayIndex) {
        meetingCount++;
        if (meetingCount === weekNum) {
          targetDate = current;
          break;
        }
      }
    }

    return targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  const currentYear = new Date().getFullYear();
  const targetWeekOptions = Array.from({ length: 52 }, (_, i) => {
    const weekNum = i + 1;
    const dateLabel = getMeetingDateLabel(currentYear, meetingDay, weekNum);
    return {
      value: weekNum,
      label: `Week ${weekNum} (${dateLabel})${weekNum === currentWeek ? " [Active]" : ""}`
    };
  });

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
        if (res.ok) {
          const settingsObj = data.settings || data;
          const cw = Number(settingsObj.currentWeek) || 1;
          setCurrentWeek(cw);
          if (settingsObj.meetingDay) {
            setMeetingDay(settingsObj.meetingDay);
          }
          if (loggingMode === "current") {
            setSelectedWeek(cw);
          }
        }
      } catch (err) {
        console.warn("Failed to load settings in manual contribution:", err);
      }
    }
    loadSettings();

    // Subscribe to real-time saccos settings updates over WebSockets
    const channel = supabase
      .channel('manual-log-sacco-settings-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'saccos'
        },
        () => {
          loadSettings();
        }
      )
      .subscribe();

    function handleSettingsUpdate(e) {
      if (e.detail) {
        if (e.detail.meetingDay) {
          setMeetingDay(e.detail.meetingDay);
        }
        if (e.detail.currentWeek) {
          setCurrentWeek(Number(e.detail.currentWeek));
        }
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_settings_updated", handleSettingsUpdate);
    }
    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_settings_updated", handleSettingsUpdate);
      }
    };
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
        <CustomSelect
          value={addMember}
          options={memberOptions}
          onChange={(val) => setAddMember(val)}
          placeholder="-- Select Member --"
        />
      </div>

      <div className="admin-form-group admin-form-group-fund">
        <label className="admin-label-fund">Fund Pool / Transaction Type</label>
        <CustomSelect
          value={addFundType}
          options={fundTypeOptions}
          onChange={(val) => setAddFundType(val)}
        />
      </div>

      {/* Dynamic Loan Fields */}
      {addFundType === "loan_disbursement" && (
        <>
          <div className="admin-form-group">
            <label>Loan Type</label>
            <CustomSelect
              value={loanType}
              options={loanTypeOptions}
              onChange={(val) => setLoanType(val)}
            />
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
          <CustomSelect
            value={selectedWeek}
            options={targetWeekOptions}
            onChange={(val) => setSelectedWeek(Number(val))}
          />
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
