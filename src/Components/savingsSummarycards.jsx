import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeToOwnSaccoRows } from "../utils/realtimeScope";
import "../styles/summary-cards-row.css";

export default function SavingsSummaryCards() {
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState({
    shares: 0,
    development_fund: 0,
    social_fund: 0,
    fines: 0,
  });
  // Null until the first successful fetch, and null forever on a database that has not
  // had migration 0027 applied -- see the fallback in /api/sacco-balances.
  const [trend, setTrend] = useState(null);

  useEffect(() => {
    // Defined inside the effect that owns it. Sitting outside, it was a function the effect
    // called synchronously, which the compiler cannot see past -- it reports a cascading
    // render whether or not the first statement is an await. Nothing else calls it: the
    // initial load, both realtime handlers and the refresh listener are all in here.
    async function fetchBalances() {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;

          const res = await fetch("/api/sacco-balances", {
            headers: {
              "Authorization": `Bearer ${session.access_token}`
            }
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);

          if (data.accounts) {
            const newBalances = {
              shares: 0,
              development_fund: 0,
              social_fund: 0,
              fines: 0,
            };
            data.accounts.forEach((acc) => {
              if (newBalances[acc.account_type] !== undefined) {
                newBalances[acc.account_type] = Number(acc.balance) || 0;
              }
            });
            setBalances(newBalances);
          }

          setTrend(data.trend ?? null);
        } catch (err) {
          console.warn("Error loading SACCO group balances:", err);
        } finally {
          setLoading(false);
        }
      }

    // Defined inside the effect that owns it. Sitting outside, it was a function the effect
    // called synchronously, which the compiler cannot see past -- it reports a cascading
    // render whether or not the first statement is an await. Nothing else calls it: the
    // initial load, both realtime handlers and the refresh listener are all in here.
      fetchBalances();

    // Subscribe to WebSockets and custom events
    // Group totals, so every member of THIS SACCO -- and nobody outside it.
    const unsubscribe = subscribeToOwnSaccoRows(
      ['transactions', 'accounts'],
      fetchBalances,
      'admin-sacco-summary'
    );

    function handleTransactionUpdate() {
      fetchBalances();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_transaction_updated", handleTransactionUpdate);
      window.addEventListener("manual_contribution_logged", handleTransactionUpdate);
    }

    return () => {
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_transaction_updated", handleTransactionUpdate);
        window.removeEventListener("manual_contribution_logged", handleTransactionUpdate);
      }
    };
  }, []);

  // Fines are in the SACCO's asset total because the group genuinely holds that cash.
  // The member-facing equivalent deliberately leaves them out -- see userSummaryCards.
  const totalCapital =
    balances.shares + balances.development_fund + balances.social_fund + balances.fines;

  // How the pot moved this week against what it was worth on Monday. Everything visible
  // -- arrow, colour and sign -- is decided from the *rounded* figure, so a week that
  // came in at -0.04% can never paint a red downward arrow beside the text "0.0%".
  function renderCapitalTrend() {
    // Hold the line's height while the figures load, so the card doesn't resize under
    // the reader once they arrive.
    if (loading) {
      return (
        <div className="card-change">
          <span>&nbsp;</span>
        </div>
      );
    }

    // The trend RPC is missing or errored. The rest of the card is still correct, so it
    // stays -- silently, rather than asserting a change nobody measured.
    if (!trend) return null;

    // A SACCO in its first week has no opening balance to grow from, so the API sends
    // null. Checked as "not a usable number" rather than "=== null" because this value
    // came off the network and the next line calls .toFixed() on it.
    if (!Number.isFinite(trend.percentChange)) {
      return (
        <div className="card-change">
          <span>No prior week to compare</span>
        </div>
      );
    }

    const pct = Number(trend.percentChange.toFixed(1));
    const tone = pct > 0 ? "positive" : pct < 0 ? "negative" : "neutral";
    const icon =
      pct > 0
        ? "fa-arrow-trend-up"
        : pct < 0
          ? "fa-arrow-trend-down"
          : "fa-minus";
    const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";

    return (
      <div className="card-change">
        <i className={`fa-solid ${icon} change-${tone}`}></i>
        <span className={`change-${tone}`}>
          {sign}
          {Math.abs(pct).toFixed(1)}%
        </span>
        <span>this week</span>
      </div>
    );
  }

  return (
    <section className="summary-cards">
      <div className="card">
        <div className="card-header">
          <span className="card-title">My Total SACCO Assets</span>
          <div
            className="card-icon"
            style={{ color: "#ff9800", backgroundColor: "#ff98001a" }}
          >
            <i className="fa-solid fa-building-columns"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> {loading ? "..." : totalCapital.toLocaleString()}
        </div>
        {renderCapitalTrend()}
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Total SACCO Shares</span>
          <div
            className="card-icon"
            style={{
              color: "#253b8e",
              backgroundColor: "#ebf0fe",
            }}
          >
            <i className="fa-solid fa-chart-pie"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> {loading ? "..." : balances.shares.toLocaleString()}
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>
            Total Shares Value
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Total SACCO Development Fund</span>
          <div
            className="card-icon"
            style={{
              color: "#10b981",
              backgroundColor: "rgba(16, 185, 129, 0.1)",
            }}
          >
            <i className="fa-solid fa-seedling"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> {loading ? "..." : balances.development_fund.toLocaleString()}
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>Steady weekly growth</span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Total SACCO Social Fund</span>
          <div
            className="card-icon"
            style={{
              color: "#ef4444",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
            }}
          >
            <i className="fa-solid fa-handshake-angle"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> {loading ? "..." : balances.social_fund.toLocaleString()}
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>Available for member support</span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Fines Collected</span>
          <div
            className="card-icon"
            style={{
              color: "#8b5cf6",
              backgroundColor: "rgba(139, 92, 246, 0.1)",
            }}
          >
            <i className="fa-solid fa-gavel"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> {loading ? "..." : balances.fines.toLocaleString()}
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>Absence and other penalties</span>
        </div>
      </div>
    </section>
  );
}
