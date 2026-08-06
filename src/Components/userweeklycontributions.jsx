import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import {
  DEFAULT_SHARE_PRICE,
  SHARE_QTY_MIN,
  SHARE_QTY_MAX,
  wantsShares,
  parseShareQuantity,
  shareContributionAmount,
  formatShs
} from "../utils/sharePricing";
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
  // Carried explicitly rather than inferred from the text. The banner used to turn green on
  // `message.includes("successfully")`, so its colour depended on the wording of a sentence
  // -- and the success message now names the exact figures filed instead.
  const [messageOk, setMessageOk] = useState(false);
  const say = (text, ok = false) => {
    setMessage(text);
    setMessageOk(ok);
  };

  // The cache is for FIRST PAINT ONLY, and it is not trustworthy for money: the key is
  // shared by every group that has ever signed in on this browser (the admin settings
  // screen writes it too), and it has no expiry, so the share price in it may belong to
  // another SACCO or to before the admin last changed it. Submitting is gated on
  // `settingsVerified` below, which only the live read can set -- so a stale price can be
  // shown for a fraction of a second but can never reach a transaction.
  const [groupSettings, setGroupSettings] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("sacco_settings_cache");
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          // A corrupt cache is not an error worth reporting: this is a display-time
          // shortcut, the defaults below are correct, and the authoritative figures arrive
          // from /api/sacco-settings moments later. Falling through is the whole plan.
        }
      }
    }
    return {
      sharePrice: DEFAULT_SHARE_PRICE,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      isLocked: false,
    };
  });
  const [loadingSettings, setLoadingSettings] = useState(true);
  // Has THIS SACCO's share price been confirmed against the server during this mount?
  // Previously `loadingSettings` was tracked and then never read, so the Contribute button
  // was live from first paint -- a member who submitted inside the load window bought
  // shares at whatever price was in the cache while the server charged the real one.
  const [settingsVerified, setSettingsVerified] = useState(false);
  const [settingsError, setSettingsError] = useState("");

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
          setSettingsVerified(true);
          setSettingsError("");
          if (data.devtFund !== undefined && data.devtFund !== null) {
            setDevtFund(data.devtFund);
          }
          if (data.socialFund !== undefined && data.socialFund !== null && !socialTouched.current) {
            setsocialFund(data.socialFund);
          }
          if (typeof window !== "undefined") {
            localStorage.setItem("sacco_settings_cache", JSON.stringify(data));
          }
        } else {
          // Not silent. Whatever is on screen now is the cache or the app defaults, and a
          // member cannot tell the difference by looking -- so say so, and keep Contribute
          // disabled rather than let them buy shares at a price nobody has confirmed.
          setSettingsVerified(false);
          setSettingsError(data?.error || "Could not load this week's amounts.");
        }
      } catch (err) {
        console.warn("Failed to load active group settings:", err);
        setSettingsVerified(false);
        setSettingsError("Could not reach the server to confirm this week's amounts.");
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

  const sharePrice = Number(groupSettings.sharePrice) || DEFAULT_SHARE_PRICE;
  const isLocked = groupSettings.isLocked;
  // Everything that has to be true before money may be submitted. `settingsVerified` is the
  // one that matters for shares: it means this share price came from the server for THIS
  // member's SACCO during this mount, so the total on screen is the total that will be
  // stored. The server checks the same thing again from its own copy.
  const canSubmit = !isLocked && !loading && !loadingSettings && settingsVerified;
  const sharesEntered = wantsShares(shares);
  const shareCheck = sharesEntered ? parseShareQuantity(shares) : null;
  const shareQuantityError = shareCheck && !shareCheck.ok ? shareCheck.error : "";
  const sharesTotal = shareCheck?.ok ? shareContributionAmount(shareCheck.quantity, sharePrice) : 0;
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
      say("Submissions are currently locked for this week.");
      return;
    }

    if (!settingsVerified) {
      say(
        settingsError
          ? `${settingsError} Nothing was submitted — reload the page and try again.`
          : "Still confirming this week's amounts. Give it a moment and try again."
      );
      return;
    }

    if (!shares && !DevtFund && !socialFund) {
      say("Please enter at least one contribution value.");
      return;
    }

    // Shares are a whole number between 1 and 10, checked here and again on the server.
    // The input's own min/max is browser validation and applies to nothing else that can
    // reach the API.
    const numShares = shareCheck?.ok ? shareCheck.quantity : 0;
    if (shareQuantityError) {
      say(shareQuantityError);
      return;
    }

    const numDevt = Number(DevtFund) || 0;
    const numSocial = Number(socialFund) || 0;

    if (numDevt < 0 || numSocial < 0) {
      say("Obligation values cannot be negative.");
      return;
    }

    // Leaving the social fund empty is skipping it this week -- which the arrears figure will
    // report. Putting a number in that is short of the weekly minimum is a different thing:
    // it would be filed as a met obligation when it is not one, so it is rejected outright.
    if (numSocial > 0 && minSocial > 0 && numSocial < minSocial) {
      say(
        `The social fund is at least Shs ${minSocial.toLocaleString()} a week. Enter that amount or more.`
      );
      return;
    }

    setLoading(true);
    say("");

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
          socialFund: numSocial,
          // The price this screen used for the total above. The server does not spend it --
          // it compares it with the real one and refuses the request if they differ, which
          // is what makes "what the member saw" and "what the admin approves" the same
          // number by construction rather than by luck.
          sharePrice
        })
      });

      const data = await res.json();

      // The admin moved the share price while this form was open, so the total on screen
      // was never going to be the total stored. Take the corrected price, redraw, and let
      // the member decide again -- do not resubmit for them at a price they have not seen.
      if (res.status === 409 && data.code === "SHARE_PRICE_CHANGED") {
        if (Number(data.sharePrice) > 0) {
          setGroupSettings((prev) => ({ ...prev, sharePrice: Number(data.sharePrice) }));
        }
        say(data.error);
        return;
      }

      if (!res.ok) throw new Error(data.error || "Failed to submit contributions.");

      // Confirm the figures as FILED, not as typed. If these two ever drift apart again,
      // the member is the first to see it instead of the last.
      const filed = data.recorded || {};
      const parts = [];
      if (filed.shares) {
        parts.push(
          `${filed.shares.quantity} share(s) at Shs ${formatShs(filed.shares.unitPrice)} `
          + `= Shs ${formatShs(filed.shares.amount)}`
        );
      }
      if (filed.devtFund) parts.push(`development fund Shs ${formatShs(filed.devtFund)}`);
      if (filed.socialFund) parts.push(`social fund Shs ${formatShs(filed.socialFund)}`);

      say(
        parts.length > 0
          ? `Submitted for admin approval: ${parts.join(", ")}.`
          : "Contributions submitted successfully (Pending Admin approval).",
        true
      );

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
      say(err.message || "Failed to submit contributions");
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

        {/* The share price is the one figure on this form the member does not choose, and
            the total below is arithmetic on it. Saying out loud that it has not been
            confirmed yet is the difference between a stale number and a wrong one. */}
        {!settingsVerified && (
          <div style={{
            marginBottom: '2rem',
            padding: '1.2rem',
            borderRadius: '0.8rem',
            background: settingsError ? '#fef2f2' : '#f8fafc',
            color: settingsError ? '#b91c1c' : '#475569',
            fontSize: '1.2rem',
            fontWeight: 600,
            textAlign: 'center',
            border: `1px solid ${settingsError ? '#fecaca' : '#e2e8f0'}`
          }}>
            <i
              className={`fa-solid ${settingsError ? 'fa-triangle-exclamation' : 'fa-circle-notch fa-spin'}`}
              style={{ marginRight: '0.8rem' }}
            ></i>
            {settingsError
              ? `${settingsError} The amounts below are not confirmed, so contributing is disabled. Reload the page.`
              : "Confirming this week's share price and fund amounts…"}
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
                Contribute {SHARE_QTY_MIN} to {SHARE_QTY_MAX} whole shares
                (Shs {formatShs(sharePrice)} per share)
              </p>
            </div>
          </div>
          <div className="fund-input-area">
            <input
              type="number"
              id="sharesInput"
              className="number-input"
              min={SHARE_QTY_MIN}
              max={SHARE_QTY_MAX}
              step={1}
              placeholder="No. of Shares"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              disabled={isLocked}
            />
            <div className="calculated-total" id="sharesTotal">
              Shs {formatShs(sharesTotal)}
            </div>
          </div>
        </div>

        {/* Said at the keyboard rather than on submit. A fraction is the input that breaks
            the rule the whole ledger rests on -- shares are bought whole, so the money is
            always a multiple of the share price. */}
        {shareQuantityError && (
          <div style={{
            margin: "-0.5rem 0 1.5rem",
            padding: "0.9rem 1.2rem",
            borderRadius: "0.6rem",
            fontSize: "1.15rem",
            fontWeight: 600,
            background: "#fffbeb",
            color: "#92400e",
            border: "1px solid #fde68a"
          }}>
            <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: "0.6rem" }}></i>
            {shareQuantityError}
          </div>
        )}

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
            background: messageOk ? '#f0fdf4' : '#fef2f2',
            color: messageOk ? '#22c55e' : '#ef4444',
            fontSize: '1.2rem',
            fontWeight: 600,
            textAlign: 'center'
          }}>
            {message}
          </div>
        )}

        <button
          className="btn-pay"
          type="submit"
          disabled={!canSubmit}
          style={{ cursor: canSubmit ? "pointer" : "not-allowed" }}
        >
          {loading
            ? "Submitting..."
            : isLocked
              ? "Submissions Locked"
              : !settingsVerified
                ? (settingsError ? "Amounts Unconfirmed" : "Confirming Amounts…")
                : "Contribute"}
        </button>
      </div>
    </form>
  );
}
