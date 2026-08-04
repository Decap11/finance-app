import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import "../styles/weeklyContributions.css";

export default function WeeklyContributions() {
  const [shares, setShares] = useState("");
  const [DevtFund, setDevtFund] = useState(1000); // Default to 1000
  const [socialFund, setsocialFund] = useState("");
  // The social fund amount the admin set is a FLOOR, not a fixed figure: a member may give
  // more in any week, and often does. So once the member has typed their own amount, the
  // settings load must stop overwriting it -- an admin saving settings, or the realtime
  // subscription firing, would otherwise silently pull a deliberate 10,000 back down to the
  // 2,000 minimum between typing it and pressing Contribute.
  const socialTouched = useRef(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [groupSettings, setGroupSettings] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("sacco_settings_cache");
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {}
      }
    }
    return {
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      isLocked: false,
    };
  });
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
    async function loadGroupSettings() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {};

        let groupCode = "";
        if (session?.user?.id) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("group_id")
            .eq("id", session.user.id)
            .maybeSingle();
          groupCode = prof?.group_id || "";
        }

        const apiUrl = groupCode ? `/api/sacco-settings?group_code=${encodeURIComponent(groupCode)}` : "/api/sacco-settings";
        const res = await fetch(apiUrl, { headers, cache: "no-store" });
        const data = await res.json();
        if (res.ok) {
          setGroupSettings(data);
          if (data.devtFund !== undefined && data.devtFund !== null) {
            setDevtFund(data.devtFund);
          }
          if (data.socialFund !== undefined && data.socialFund !== null && !socialTouched.current) {
            setsocialFund(data.socialFund);
          }
          if (typeof window !== "undefined") {
            localStorage.setItem("sacco_settings_cache", JSON.stringify(data));
          }
        }
      } catch (err) {
        console.warn("Failed to load active group settings:", err);
      } finally {
        setLoadingSettings(false);
      }
    }
    loadGroupSettings();

    // Subscribe to real-time sacco_settings updates
    const channel = supabase
      .channel('weekly-contributions-sacco-settings-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sacco_settings'
        },
        () => {
          loadGroupSettings();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'saccos'
        },
        () => {
          loadGroupSettings();
        }
      )
      .subscribe();

    const handleSettingsUpdated = (e) => {
      if (e.detail) {
        setGroupSettings(e.detail);
        if (e.detail.devtFund !== undefined) setDevtFund(e.detail.devtFund);
        if (e.detail.socialFund !== undefined && !socialTouched.current) setsocialFund(e.detail.socialFund);
      }
    };

    window.addEventListener("sacco_settings_updated", handleSettingsUpdated);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("sacco_settings_updated", handleSettingsUpdated);
    };
  }, []);

  const sharePrice = groupSettings.sharePrice;
  const isLocked = groupSettings.isLocked;
  // The weekly social fund obligation is met by this amount OR ANYTHING ABOVE IT. The admin
  // sets the floor; what a member gives on top of it is their own call, and is credited in
  // full. Below it is not a smaller contribution, it is an unmet weekly obligation, so it is
  // refused here and again on the server.
  const minSocial = Number(groupSettings.socialFund) || 0;
  const socialEntered = Number(socialFund) || 0;
  const socialBelowMinimum = socialFund !== "" && socialEntered > 0 && socialEntered < minSocial;
  const socialAboveMinimum = socialEntered > minSocial ? socialEntered - minSocial : 0;

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

    // Leaving the social fund empty is skipping it this week -- which the arrears figure will
    // report. Putting a number in that is short of the weekly minimum is a different thing:
    // it would be filed as a met obligation when it is not one, so it is rejected outright.
    if (numSocial > 0 && minSocial > 0 && numSocial < minSocial) {
      setMessage(
        `The social fund is at least Shs ${minSocial.toLocaleString()} a week. Enter that amount or more.`
      );
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

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
        window.dispatchEvent(new CustomEvent("manual_contribution_logged"));
      }

      // Reset states
      setShares("");
      setDevtFund(groupSettings.devtFund || 1000); // Reset back to default
      // Back to the minimum rather than blank, so the next week starts from what is owed. The
      // touch flag goes with it -- this is a fresh entry, not the one they typed.
      socialTouched.current = false;
      setsocialFund(groupSettings.socialFund ?? "");
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
              <p className="fund-desc">
                Weekly minimum: Shs {minSocial.toLocaleString()} — give more if you wish
              </p>
            </div>
          </div>
          <div className="fund-input-area">
            <input
              type="number"
              className="number-input"
              placeholder={`Shs ${minSocial.toLocaleString()} or more`}
              min={minSocial}
              value={socialFund}
              onChange={(e) => {
                socialTouched.current = true;
                setsocialFund(e.target.value);
              }}
              disabled={isLocked}
            />
            <div className="calculated-total" style={{ visibility: socialFund ? "visible" : "hidden" }}>
              Shs {socialFund ? Number(socialFund).toLocaleString() : 0}
            </div>
          </div>
        </div>

        {/* Said under the card rather than only on submit: a member who has typed 1,500 against
            a 2,000 minimum should find out before pressing Contribute, not after. The
            above-minimum line is the other half of the same rule -- confirmation that the extra
            was taken as given and not quietly trimmed. */}
        {(socialBelowMinimum || socialAboveMinimum > 0) && (
          <div style={{
            margin: "-0.5rem 0 1.5rem",
            padding: "0.9rem 1.2rem",
            borderRadius: "0.6rem",
            fontSize: "1.15rem",
            fontWeight: 600,
            background: socialBelowMinimum ? "#fffbeb" : "#f0fdf4",
            color: socialBelowMinimum ? "#92400e" : "#15803d",
            border: `1px solid ${socialBelowMinimum ? "#fde68a" : "#bbf7d0"}`
          }}>
            <i
              className={`fa-solid ${socialBelowMinimum ? "fa-triangle-exclamation" : "fa-circle-check"}`}
              style={{ marginRight: "0.6rem" }}
            ></i>
            {socialBelowMinimum
              ? `Below the weekly minimum of Shs ${minSocial.toLocaleString()}. Enter that amount or more.`
              : `Shs ${socialAboveMinimum.toLocaleString()} above the weekly minimum — the full amount is credited.`}
          </div>
        )}

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
