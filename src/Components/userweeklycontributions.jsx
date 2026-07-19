import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/weeklyContributions.css";

export default function WeeklyContributions() {
  const [shares, setShares] = useState("");
  const [DevtFund, setDevtFund] = useState(1000); // Default to 1000
  const [socialFund, setsocialFund] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [groupSettings, setGroupSettings] = useState({
    sharePrice: 25000,
    devtFund: 1000,
    socialFund: 2000,
    currentWeek: 1,
    isLocked: false,
  });
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
    async function loadGroupSettings() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {};

        const res = await fetch("/api/sacco-settings", { headers });
        const data = await res.json();
        if (res.ok) {
          setGroupSettings(data);
          if (data.devtFund !== undefined && data.devtFund !== null) {
            setDevtFund(data.devtFund);
          }
          if (data.socialFund !== undefined && data.socialFund !== null) {
            setsocialFund(data.socialFund);
          }
        }
      } catch (err) {
        console.warn("Failed to load active group settings:", err);
      } finally {
        setLoadingSettings(false);
      }
    }
    loadGroupSettings();
  }, []);

  const sharePrice = groupSettings.sharePrice;
  const isLocked = groupSettings.isLocked;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLocked) {
      setMessage("Submissions are currently locked for this week.");
      return;
    }

    if (!shares && !DevtFund && !socialFund) {
      setMessage("Please enter at least one contribution value.");
      return;
    }

    const numShares = Number(shares) || 0;
    const numDevt = Number(DevtFund) || 0;
    const numSocial = Number(socialFund) || 0;

    if (numShares < 0 || numDevt < 0 || numSocial < 0) {
      setMessage("Obligation values cannot be negative.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be logged in to contribute.");

      const res = await fetch("/api/user-transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          shares: numShares,
          devtFund: numDevt,
          socialFund: numSocial
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit contributions.");

      setMessage("Contributions submitted successfully (Pending Admin approval).");
      // Reset states
      setShares("");
      setDevtFund(groupSettings.devtFund || 1000); // Reset back to default
      setsocialFund("");
    } catch (err) {
      setMessage(err.message || "Failed to submit contributions");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="contributions-section" onSubmit={handleSubmit}>
      <div className="quick-actions" style={{ padding: "30px" }}>
        <div
          className="section-header"
          style={{
            marginBottom: "25px",
            display: "flex",
            justifyContent: "space-around",
            width: "100%",
          }}
        >
          <h3 className="section-title">Week {groupSettings.currentWeek} Contributions</h3>
          <span
            className={`badge badge-${isLocked ? 'danger' : 'pending'}`}
            style={{
              backgroundColor: isLocked ? "rgba(239, 68, 68, 0.1)" : "rgba(245, 158, 11, 0.1)",
              color: isLocked ? "#ef4444" : "#f59e0b",
              padding: "0.6rem 1.2rem",
              borderRadius: "2rem",
              fontWeight: 700,
              fontSize: "1.2rem",
            }}
          >
            {isLocked ? "LOCKED" : "DUE THIS WEEK"}
          </span>
        </div>

        {isLocked && (
          <div style={{
            marginBottom: '2rem',
            padding: '1.2rem',
            borderRadius: '0.8rem',
            background: '#fef2f2',
            color: '#ef4444',
            fontSize: '1.3rem',
            fontWeight: 700,
            textAlign: 'center',
            border: '1px solid #fee2e2'
          }}>
            <i className="fa-solid fa-lock" style={{ marginRight: '0.8rem' }}></i>
            Transactions for Week {groupSettings.currentWeek} are currently locked by the Admin.
          </div>
        )}

        {/* 1. Shares Pool */}
        <div className="contribution-card" style={{ opacity: isLocked ? 0.6 : 1 }}>
          <div className="fund-info">
            <div
              className="fund-icon"
              style={{
                backgroundColor: "#ebf0fe",
                color: "#253b8e",
              }}
            >
              <i className="fa-solid fa-chart-pie"></i>
            </div>
            <div>
              <h4 className="fund-title">Shares Pool</h4>
              <p className="fund-desc">
                Contribute 1 to 10 shares (Shs {sharePrice.toLocaleString()} per share)
              </p>
            </div>
          </div>
          <div className="fund-input-area">
            <input
              type="number"
              id="sharesInput"
              className="number-input"
              min={1}
              max={10}
              placeholder="No. of Shares"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              disabled={isLocked}
            />
            <div className="calculated-total" id="sharesTotal">
              Shs {shares ? (Number(shares) * sharePrice).toLocaleString() : 0}
            </div>
          </div>
        </div>

        {/* 2. Development Fund */}
        <div className="contribution-card" style={{ opacity: isLocked ? 0.6 : 1 }}>
          <div className="fund-info">
            <div
              className="fund-icon"
              style={{
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                color: "#10b981",
              }}
            >
              <i className="fa-solid fa-seedling"></i>
            </div>
            <div>
              <h4 className="fund-title">Development Fund</h4>
              <p className="fund-desc">Fixed weekly: Shs {groupSettings.devtFund.toLocaleString()}</p>
            </div>
          </div>
          <div className="fund-input-area">
            <input
              type="number"
              className="number-input"
              value={DevtFund}
              onChange={(e) => setDevtFund(e.target.value)}
              disabled={isLocked}
              style={{
                textAlign: "center",
              }}
            />
            <div className="calculated-total">Shs {DevtFund ? Number(DevtFund).toLocaleString() : 0}</div>
          </div>
        </div>

        {/* 3. Social Fund */}
        <div className="contribution-card" style={{ opacity: isLocked ? 0.6 : 1 }}>
          <div className="fund-info">
            <div
              className="fund-icon"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
              }}
            >
              <i className="fa-solid fa-handshake-angle"></i>
            </div>
            <div>
              <h4 className="fund-title">Social Fund</h4>
              <p className="fund-desc">Weekly obligation: Shs {groupSettings.socialFund.toLocaleString()}</p>
            </div>
          </div>
          <div className="fund-input-area">
            <input
              type="number"
              className="number-input"
              placeholder="Amount (Shs)"
              min={0}
              value={socialFund}
              onChange={(e) => setsocialFund(e.target.value)}
              disabled={isLocked}
            />
            <div className="calculated-total" style={{ visibility: socialFund ? "visible" : "hidden" }}>
              Shs {socialFund ? Number(socialFund).toLocaleString() : 0}
            </div>
          </div>
        </div>

        {message && (
          <div style={{
            margin: '1.5rem 0',
            padding: '1rem',
            borderRadius: '0.6rem',
            background: message.includes("successfully") ? '#f0fdf4' : '#fef2f2',
            color: message.includes("successfully") ? '#22c55e' : '#ef4444',
            fontSize: '1.2rem',
            fontWeight: 600,
            textAlign: 'center'
          }}>
            {message}
          </div>
        )}

        <button className="btn-pay" type="submit" disabled={loading || isLocked} style={{ cursor: isLocked ? "not-allowed" : "pointer" }}>
          {loading ? "Submitting..." : isLocked ? "Submissions Locked" : "Contribute"}
        </button>
      </div>
    </form>
  );
}
