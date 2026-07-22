import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";

export default function FundDistributionMix() {
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState({
    shares: 0,
    development_fund: 0,
    social_fund: 0,
  });

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
      if (res.ok && data.accounts) {
        const newBalances = {
          shares: 0,
          development_fund: 0,
          social_fund: 0,
        };
        data.accounts.forEach((acc) => {
          if (newBalances[acc.account_type] !== undefined) {
            newBalances[acc.account_type] = Number(acc.balance) || 0;
          }
        });
        setBalances(newBalances);
      }
    } catch (err) {
      console.warn("Error loading distribution mix balances:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBalances();

    // Subscribe to WebSockets and custom events for instant chart updates
    const channel = supabase
      .channel('fund-distribution-mix-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, fetchBalances)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, fetchBalances)
      .subscribe();

    function handleTransactionUpdate() {
      fetchBalances();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_transaction_updated", handleTransactionUpdate);
      window.addEventListener("manual_contribution_logged", handleTransactionUpdate);
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_transaction_updated", handleTransactionUpdate);
        window.removeEventListener("manual_contribution_logged", handleTransactionUpdate);
      }
    };
  }, []);

  const totalCapital = balances.shares + balances.development_fund + balances.social_fund;

  // Chart configuration
  const segments = [
    { label: "Shares", value: balances.shares, color: "#253b8e", desc: "Core capital pool" },
    { label: "Dev Fund", value: balances.development_fund, color: "#10b981", desc: "Projects and operations" },
    { label: "Social Fund", value: balances.social_fund, color: "#ef4444", desc: "Member welfare cover" }
  ];

  // SVG Circle Geometry Math
  const radius = 55;
  const strokeWidth = 16;
  const circumference = 2 * Math.PI * radius; // ~345.57

  // Calculate percentages and stroke offsets
  let accumulatedLength = 0;
  const segmentsWithMath = segments.map((seg) => {
    const percentage = totalCapital > 0 ? (seg.value / totalCapital) * 100 : 33.33; // Equal split fallback if 0
    const strokeLength = (percentage / 100) * circumference;
    const strokeOffset = circumference - accumulatedLength;
    accumulatedLength += strokeLength;

    return {
      ...seg,
      percentage,
      strokeDasharray: `${strokeLength} ${circumference - strokeLength}`,
      strokeDashoffset: strokeOffset
    };
  });

  return (
    <div className="features-area">
      <div className="quick-actions" style={{ padding: "2.4rem" }}>
        <div className="section-header" style={{ marginBottom: "2rem" }}>
          <h3 className="section-title">Capital Asset Distribution</h3>
        </div>

        <div style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-around",
          gap: "2rem",
          marginTop: "1.5rem"
        }}>
          {/* Doughnut Chart SVG */}
          <div style={{ position: "relative", width: "180px", height: "180px" }}>
            <svg width="100%" height="100%" viewBox="0 0 160 160" style={{ transform: "rotate(-90deg)" }}>
              {/* Underlay track */}
              <circle
                cx="80"
                cy="80"
                r={radius}
                fill="transparent"
                stroke="#f1f5f9"
                strokeWidth={strokeWidth}
              />
              {/* Segments */}
              {segmentsWithMath.map((seg, idx) => (
                <circle
                  key={idx}
                  cx="80"
                  cy="80"
                  r={radius}
                  fill="transparent"
                  stroke={seg.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={seg.strokeDasharray}
                  strokeDashoffset={seg.strokeDashoffset}
                  strokeLinecap="round"
                  style={{
                    transition: "stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease",
                    cursor: "pointer"
                  }}
                  title={`${seg.label}: ${Math.round(seg.percentage)}%`}
                />
              ))}
            </svg>

            {/* Central Info Overlay */}
            <div style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              width: "100px",
              pointerEvents: "none"
            }}>
              <span style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                color: "var(--text-light)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                display: "block",
                marginBottom: "0.2rem"
              }}>
                TOTAL
              </span>
              <span style={{
                fontSize: "1.5rem",
                fontWeight: 800,
                color: "var(--text-dark)",
                whiteSpace: "nowrap"
              }}>
                {loading ? "..." : `Shs ${totalCapital.toLocaleString()}`}
              </span>
            </div>
          </div>

          {/* Interactive Legend Grid */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "1.4rem",
            flex: "1",
            minWidth: "220px"
          }}>
            {segmentsWithMath.map((seg, idx) => (
              <div key={idx} style={{
                display: "flex",
                alignItems: "center",
                gap: "1.2rem",
                padding: "0.8rem 1.2rem",
                borderRadius: "1rem",
                background: "var(--bg-light)",
                border: "0.1rem solid rgba(226, 232, 240, 0.4)",
                transition: "transform 0.2s ease"
              }}>
                {/* Legend Indicator Dot */}
                <div style={{
                  width: "1.2rem",
                  height: "1.2rem",
                  borderRadius: "50%",
                  backgroundColor: seg.color,
                  flexShrink: 0
                }} />
                
                {/* Label and Value */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-dark)" }}>
                      {seg.label}
                    </span>
                    <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-dark)" }}>
                      {totalCapital > 0 ? `${Math.round(seg.percentage)}%` : "0%"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.2rem" }}>
                    <span style={{ fontSize: "1.1rem", color: "var(--text-light)" }}>
                      {seg.desc}
                    </span>
                    <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 600 }}>
                      Shs {seg.value.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
