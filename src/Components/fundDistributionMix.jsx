import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { lendingNetOf, capitalOnHandOf, outOnLoanOf, formatSignedShs } from "../utils/saccoCapital";

export default function FundDistributionMix() {
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState({
    shares: 0,
    development_fund: 0,
    social_fund: 0,
    fines: 0,
  });
  // Null until /api/sacco-balances answers, and null for good on a database without
  // migration 0034. The card then reads exactly as it did before: the pools, and their
  // sum. Every use of it below is guarded on that.
  const [capital, setCapital] = useState(null);

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
          fines: 0,
        };
        data.accounts.forEach((acc) => {
          if (newBalances[acc.account_type] !== undefined) {
            newBalances[acc.account_type] = Number(acc.balance) || 0;
          }
        });
        setBalances(newBalances);
      }
      if (res.ok) {
        setCapital(data.capital || null);
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

  // What the pools add up to: money contributed, by category. The ring divides this, and
  // it only ever grows -- collecting a contribution adds to it and nothing takes it away.
  const totalCapital =
    balances.shares + balances.development_fund + balances.social_fund + balances.fines;

  // What lending has done to it. Negative while money is out with borrowers, positive
  // once a book has been repaid with its interest.
  const lendingNet = lendingNetOf(capital);

  // The headline. This is the number that has to fall when an admin approves a loan --
  // the whole point of the exercise. Without 0034 there is nothing better to show than
  // the contributed total, which is what this card has always shown.
  //
  // Recomputed from the position rather than read straight off capital.onHand so the
  // three lines in the strip below are guaranteed to add up on screen: the pools are
  // clamped at zero per account on their way through the API, and a headline taken from
  // one source with its parts taken from another is how a card ends up printing an
  // addition that does not work.
  const headlineAmount = capital ? capitalOnHandOf(capital) : totalCapital;
  const contributedTotal = capital ? Number(capital.contributed) || 0 : totalCapital;
  const headlineLabel = capital ? "ON HAND" : "TOTAL";

  // Chart configuration
  const segments = [
    { label: "Shares", value: balances.shares, color: "#253b8e", desc: "Core capital pool" },
    { label: "Dev Fund", value: balances.development_fund, color: "#10b981", desc: "Projects and operations" },
    { label: "Social Fund", value: balances.social_fund, color: "#ef4444", desc: "Member welfare cover" },
    { label: "Fines", value: balances.fines, color: "#8b5cf6", desc: "Penalties collected" }
  ];

  // SVG Circle Geometry Math
  const radius = 55;
  const strokeWidth = 16;
  const circumference = 2 * Math.PI * radius; // ~345.57

  // The centre label lives inside the SVG rather than in an overlaid div, so it is measured
  // in the ring's own viewBox units. An HTML overlay was sized in rem while the ring was
  // sized in px, which made the two scale independently: the ring held at 180px on a phone
  // while the number kept its desktop size, and "Shs 1,048,000" spilled out over the ring.
  //
  // Inside the viewBox the hole is a fixed 94 units across (2 x (radius - strokeWidth / 2))
  // no matter what the root font-size or the viewport is, so fitting the text is arithmetic
  // rather than a media query.
  const holeWidth = 2 * (radius - strokeWidth / 2); // 94
  const amountText = loading ? "..." : formatSignedShs(headlineAmount);

  // 0.6em is a serviceable average advance width for bold digits in a sans-serif face, and
  // 0.88 keeps the string off the curve of the hole rather than touching it. Clamped at 15
  // so a short total is not blown up, and at 7.5 so a SACCO in the hundreds of millions
  // still renders something readable instead of vanishing.
  const amountFontSize = Math.max(
    7.5,
    Math.min(15, (holeWidth * 0.88) / (amountText.length * 0.6))
  );

  // Calculate percentages and stroke offsets
  let accumulatedLength = 0;
  const segmentsWithMath = segments.map((seg) => {
    // Equal split fallback while every pool is still empty, so the ring renders as a
    // neutral wheel rather than collapsing to nothing.
    const percentage = totalCapital > 0 ? (seg.value / totalCapital) * 100 : 100 / segments.length;
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
          <div style={{ width: "180px", maxWidth: "100%", aspectRatio: "1" }}>
            <svg
              width="100%"
              height="100%"
              viewBox="0 0 160 160"
              role="img"
              aria-label={
                capital
                  ? `Capital asset distribution. Shs ${contributedTotal.toLocaleString()} contributed, `
                    + `Shs ${outOnLoanOf(capital).toLocaleString()} out on loan, `
                    + `${amountText} on hand.`
                  : `Capital asset distribution. Total ${amountText}.`
              }
            >
              {/* The quarter turn that starts the first segment at twelve o'clock belongs to
                  the ring alone -- applying it to the whole <svg>, as this once did, would
                  lay the centre label on its side. */}
              <g transform="rotate(-90 80 80)">
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
              </g>

              {/* Central Info */}
              <text
                x="80"
                y="70"
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontSize: "8px",
                  fontWeight: 700,
                  fill: "var(--text-light)",
                  letterSpacing: "0.5px"
                }}
              >
                {headlineLabel}
              </text>
              <text
                x="80"
                y="88"
                textAnchor="middle"
                dominantBaseline="central"
                style={{
                  fontSize: `${amountFontSize}px`,
                  fontWeight: 800,
                  fill: "var(--text-dark)"
                }}
              >
                {amountText}
              </text>
            </svg>
          </div>

          {/* Interactive Legend Grid */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "1.4rem",
            flex: "1",
            // A flat 220px floor is wider than the card's content box on a small phone, and
            // a flex item cannot shrink below its min-width -- so the legend pushed the page
            // into a horizontal scroll. min() keeps the intent (don't crowd the labels when
            // there is room) while still allowing it to fit when there is not.
            minWidth: "min(220px, 100%)"
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
                
                {/* Label and Value. minWidth: 0 on the flex child because the default of
                    `auto` refuses to shrink below the widest word, which is what turns a long
                    description into overflow instead of a wrap. The figures opposite carry
                    flexShrink: 0 -- when space runs out the prose gives way, never the money. */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.8rem" }}>
                    <span style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-dark)" }}>
                      {seg.label}
                    </span>
                    <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-dark)", flexShrink: 0 }}>
                      {totalCapital > 0 ? `${Math.round(seg.percentage)}%` : "0%"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.2rem", gap: "0.8rem" }}>
                    <span style={{ fontSize: "1.1rem", color: "var(--text-light)" }}>
                      {seg.desc}
                    </span>
                    <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
                      Shs {seg.value.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Where the money actually is.
         *
         * The ring above divides what was contributed, and that figure only ever climbs.
         * It cannot answer the question this strip exists for -- a member looking at a
         * loan that was just approved should be able to see the pot it came out of. The
         * three lines always reconcile: contributed + lendingNet = on hand, by
         * construction in get_sacco_capital_position, including the case where a book has
         * been repaid with interest and the SACCO now holds more than it collected. */}
        {capital && (
          <div style={{
            marginTop: "2rem",
            paddingTop: "1.6rem",
            borderTop: "0.1rem solid rgba(226, 232, 240, 0.8)",
            display: "flex",
            flexDirection: "column",
            gap: "0.8rem"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1.2rem" }}>
              <span style={{ fontSize: "1.25rem", color: "var(--text-light)" }}>
                Contributed by members
              </span>
              <span style={{
                fontSize: "1.3rem", fontWeight: 700, color: "var(--text-dark)",
                flexShrink: 0, whiteSpace: "nowrap"
              }}>
                Shs {contributedTotal.toLocaleString()}
              </span>
            </div>

            {lendingNet !== 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1.2rem" }}>
                <span style={{ fontSize: "1.25rem", color: "var(--text-light)" }}>
                  {lendingNet < 0 ? "Out on loan with members" : "Returned with interest"}
                </span>
                <span style={{
                  fontSize: "1.3rem",
                  fontWeight: 700,
                  // Red is not a warning here. Money out with borrowers is the SACCO
                  // working exactly as intended; the colour only marks the direction so
                  // the three lines read as arithmetic at a glance.
                  color: lendingNet < 0 ? "#ef4444" : "#10b981",
                  flexShrink: 0,
                  whiteSpace: "nowrap"
                }}>
                  {lendingNet < 0 ? "−" : "+"}Shs {Math.abs(lendingNet).toLocaleString()}
                </span>
              </div>
            )}

            <div style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1.2rem",
              paddingTop: "0.8rem",
              borderTop: "0.1rem dashed rgba(226, 232, 240, 0.9)"
            }}>
              <span style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-dark)" }}>
                Available to lend
              </span>
              <span style={{
                fontSize: "1.4rem",
                fontWeight: 800,
                // A negative pot means the SACCO has lent more than it ever collected.
                // It is shown rather than floored at zero, because flooring it is how it
                // goes unnoticed.
                color: headlineAmount < 0 ? "#ef4444" : "var(--primary-color)",
                flexShrink: 0,
                whiteSpace: "nowrap"
              }}>
                {formatSignedShs(headlineAmount)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
