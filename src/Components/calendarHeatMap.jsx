import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/calendarHeatMap.css";
import "../styles/UserProgressTracker.css";

export default function CalendarHeatMap() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sharesConsistency, setSharesConsistency] = useState(100);
  const [devFundConsistency, setDevFundConsistency] = useState(100);
  const [socialFundConsistency, setSocialFundConsistency] = useState(100);
  const [weekContributions, setWeekContributions] = useState({});
  const [weekShares, setWeekShares] = useState({});
  const [weekFinancialData, setWeekFinancialData] = useState({});
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(1);

  // Balanced mapping of weeks to months (total 52 weeks)
  const monthWeeks = [
    { name: "Jan", weeks: [1, 2, 3, 4, 5] },
    { name: "Feb", weeks: [6, 7, 8, 9] },
    { name: "Mar", weeks: [10, 11, 12, 13] },
    { name: "Apr", weeks: [14, 15, 16, 17] },
    { name: "May", weeks: [18, 19, 20, 21, 22] },
    { name: "Jun", weeks: [23, 24, 25, 26] },
    { name: "Jul", weeks: [27, 28, 29, 30] },
    { name: "Aug", weeks: [31, 32, 33, 34, 35] },
    { name: "Sep", weeks: [36, 37, 38, 39] },
    { name: "Oct", weeks: [40, 41, 42, 43, 44] },
    { name: "Nov", weeks: [45, 46, 47, 48] },
    { name: "Dec", weeks: [49, 50, 51, 52] }
  ];

  // Helper to get week number of the year (1-52)
  const getWeekOfYear = (dateStr) => {
    const date = new Date(dateStr);
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const diffInMs = date - startOfYear;
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    return Math.floor(diffInDays / 7) + 1;
  };

  useEffect(() => {
    function handleClickOutside() {
      setActiveTooltip(null);
    }
    window.addEventListener("click", handleClickOutside);
    window.addEventListener("scroll", handleClickOutside);
    return () => {
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("scroll", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    async function loadContributionHabits() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setLoading(false);
          return;
        }

        const res = await fetch("/api/contribution-habits", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch contribution habits");

        const transactions = data.transactions || [];
        const settings = data.settings || {};

        // Calculate weeks elapsed
        const weeksElapsed = settings.currentWeek || getWeekOfYear(new Date());
        setCurrentWeek(weeksElapsed);

        // Group transaction types and shares count by week number
        const tempWeekContributions = {};
        const tempWeekShares = {};
        const tempWeekFinancialData = {};
        for (let w = 1; w <= 52; w++) {
          tempWeekContributions[w] = new Set();
          tempWeekShares[w] = 0;
          tempWeekFinancialData[w] = {
            sharesAmount: 0,
            sharesCount: 0,
            devtAmount: 0,
            socialAmount: 0,
            txDates: [],
            totalAmount: 0
          };
        }

        transactions.forEach(tx => {
          let weekNum = null;
          const match = tx.description?.match(/\|\s*Week\s*(\d+)/i);
          if (match) {
            weekNum = parseInt(match[1], 10);
          }
          if (!weekNum) {
            weekNum = getWeekOfYear(tx.created_at);
          }

          if (weekNum >= 1 && weekNum <= 52) {
            tempWeekContributions[weekNum].add(tx.category);
            const amt = Number(tx.amount) || 0;
            const wData = tempWeekFinancialData[weekNum];
            wData.totalAmount += amt;

            if (tx.created_at) {
              const d = new Date(tx.created_at);
              const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              if (!wData.txDates.includes(dateStr)) {
                wData.txDates.push(dateStr);
              }
            }

            if (tx.category === 'shares') {
              const numShares = Math.floor(amt / (settings.sharePrice || 25000));
              tempWeekShares[weekNum] += numShares;
              wData.sharesAmount += amt;
              wData.sharesCount += numShares;
            } else if (tx.category === 'development_fund') {
              wData.devtAmount += amt;
            } else if (tx.category === 'social_fund') {
              wData.socialAmount += amt;
            }
          }
        });

        setWeekContributions(tempWeekContributions);
        setWeekShares(tempWeekShares);
        setWeekFinancialData(tempWeekFinancialData);

        // Helper to calculate consistency percentage
        const calcConsistency = (weeksContributed) => {
          const ratio = weeksContributed / (weeksElapsed || 1);
          return ratio * 100;
        };

        // Extract contributed week counts per pool type
        const shareWeeksCount = Object.keys(tempWeekContributions).filter(w => tempWeekContributions[w].has('shares')).length;
        const devFundWeeksCount = Object.keys(tempWeekContributions).filter(w => tempWeekContributions[w].has('development_fund')).length;
        const socialFundWeeksCount = Object.keys(tempWeekContributions).filter(w => tempWeekContributions[w].has('social_fund')).length;

        setSharesConsistency(calcConsistency(shareWeeksCount));
        setDevFundConsistency(calcConsistency(devFundWeeksCount));
        setSocialFundConsistency(calcConsistency(socialFundWeeksCount));
      } catch (err) {
        console.error("Error loading contribution habits:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadContributionHabits();
  }, []);

  return (
    <div className="quick-actions">
      <div className="section-header">
        <h3 className="section-title">Contribution Habits</h3>
      </div>
      <div style={{ marginTop: "15px", paddingBottom: "5px" }}>
        <h4
          style={{
            fontSize: "1.8rem",
            color: "var(--text-dark)",
            marginBottom: "1.2rem",
          }}
        >
          Shares Pool Consistency
          <span style={{ float: "right", color: "#253b8e" }}>
            {loading ? "..." : `${Math.round(sharesConsistency)}%`}
          </span>
        </h4>
        <div
          style={{
            width: "100%",
            height: "8px",
            backgroundColor: "#f1f5f9",
            borderRadius: "4px",
            overflow: "hidden",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              width: loading ? "0%" : `${Math.min(100, Math.round(sharesConsistency))}%`,
              height: "100%",
              backgroundColor: "#253b8e",
              transition: "width 0.5s ease-in-out",
            }}
          ></div>
        </div>

        <h4
          style={{
            fontSize: "1.8rem",
            color: "var(--text-dark)",
            marginBottom: "1.2rem",
          }}
        >
          Dev Fund Obligations
          <span style={{ float: "right", color: "var(--success)" }}>
            {loading ? "..." : `${Math.round(devFundConsistency)}%`}
          </span>
        </h4>
        <div
          style={{
            width: "100%",
            height: "8px",
            backgroundColor: "#f1f5f9",
            borderRadius: "4px",
            overflow: "hidden",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              width: loading ? "0%" : `${Math.min(100, Math.round(devFundConsistency))}%`,
              height: "100%",
              backgroundColor: "var(--success)",
              transition: "width 0.5s ease-in-out",
            }}
          ></div>
        </div>

        <h4
          style={{
            fontSize: "1.8rem",
            color: "var(--text-dark)",
            marginBottom: "1.2rem",
          }}
        >
          Social Fund Activity
          <span style={{ float: "right", color: "#ef4444" }}>
            {loading ? "..." : `${Math.round(socialFundConsistency)}%`}
          </span>
        </h4>
        <div
          style={{
            width: "100%",
            height: "8px",
            backgroundColor: "#f1f5f9",
            borderRadius: "4px",
            overflow: "hidden",
            marginBottom: "20px",
          }}
        >
          <div
            style={{
              width: loading ? "0%" : `${Math.min(100, Math.round(socialFundConsistency))}%`,
              height: "100%",
              backgroundColor: "#ef4444",
              transition: "width 0.5s ease-in-out",
            }}
          ></div>
        </div>

        {/* Calendar Heatmap */}
        <div className="calendar-heatmap">
          <div className="heatmap-header">
            <div>
              <h4>Contribution Habit Tracker</h4>
              <p>Visualize your shares consistency over the year.</p>
            </div>
            <span>Green = contributed, Red = missed</span>
          </div>
          
          <div className="heatmap-months">
            {monthWeeks.map((month) => (
              <div key={month.name} className="heatmap-month">
                <span>{month.name}</span>
                <div className="heatmap-weekdays">
                  {month.weeks.map((weekNum) => {
                    const contributions = weekContributions[weekNum] || new Set();
                    const sharesCount = weekShares[weekNum] || 0;
                    
                    let levelClass = "";
                    let inlineStyle = {};
                    let tooltipText = `${month.name} Week ${weekNum - month.weeks[0] + 1}`;

                    if (weekNum > currentWeek) {
                      // Future upcoming weeks are colored light grey
                      inlineStyle = { backgroundColor: "#e2e8f0", border: "0.1rem solid #cbd5e1" };
                      tooltipText += " (Upcoming)";
                    } else {
                      // Past/active weeks colored based on shares count bucket
                      if (sharesCount === 0) {
                        levelClass = "level-0";
                        tooltipText += ": Missed shares contribution";
                      } else {
                        // 1-2 shares: level-1
                        // 3-4 shares: level-2
                        // 5-7 shares: level-3
                        // 8-10 shares: level-4
                        if (sharesCount <= 2) {
                          levelClass = "level-1";
                        } else if (sharesCount <= 4) {
                          levelClass = "level-2";
                        } else if (sharesCount <= 7) {
                          levelClass = "level-3";
                        } else {
                          levelClass = "level-4";
                        }
                        tooltipText += `: Contributed ${sharesCount} share(s)`;
                      }

                      // Append Dev and Social details if contributed
                      const otherTypes = [];
                      if (contributions.has('development_fund')) otherTypes.push('Dev Fund');
                      if (contributions.has('social_fund')) otherTypes.push('Social Fund');
                      if (otherTypes.length > 0) {
                        tooltipText += ` (plus ${otherTypes.join(', ')})`;
                      }
                    }

                    return (
                      <div
                        key={weekNum}
                        className={`heatmap-day ${levelClass}`}
                        style={inlineStyle}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const finData = weekFinancialData[weekNum] || { sharesAmount: 0, devtAmount: 0, socialAmount: 0, totalAmount: 0, txDates: [] };
                          
                          let dateLabel = "";
                          if (finData.txDates && finData.txDates.length > 0) {
                            dateLabel = finData.txDates.join(", ");
                          } else {
                            const year = new Date().getFullYear();
                            const jan1 = new Date(year, 0, 1);
                            const startDay = new Date(jan1);
                            startDay.setDate(jan1.getDate() + (weekNum - 1) * 7);
                            const endDay = new Date(startDay);
                            endDay.setDate(startDay.getDate() + 6);
                            
                            const startStr = startDay.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                            const endStr = endDay.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                            dateLabel = `${month.name} Week ${weekNum - month.weeks[0] + 1} (${startStr} – ${endStr})`;
                          }

                          setActiveTooltip({
                            x: rect.left + rect.width / 2,
                            y: rect.top,
                            dateLabel,
                            finData,
                            isUpcoming: weekNum > currentWeek,
                            isMissed: weekNum <= currentWeek && finData.totalAmount === 0
                          });
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const finData = weekFinancialData[weekNum] || { sharesAmount: 0, devtAmount: 0, socialAmount: 0, totalAmount: 0, txDates: [] };
                          
                          let dateLabel = "";
                          if (finData.txDates && finData.txDates.length > 0) {
                            dateLabel = finData.txDates.join(", ");
                          } else {
                            const year = new Date().getFullYear();
                            const jan1 = new Date(year, 0, 1);
                            const startDay = new Date(jan1);
                            startDay.setDate(jan1.getDate() + (weekNum - 1) * 7);
                            const endDay = new Date(startDay);
                            endDay.setDate(startDay.getDate() + 6);
                            
                            const startStr = startDay.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                            const endStr = endDay.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                            dateLabel = `${month.name} Week ${weekNum - month.weeks[0] + 1} (${startStr} – ${endStr})`;
                          }

                          setActiveTooltip({
                            x: rect.left + rect.width / 2,
                            y: rect.top,
                            dateLabel,
                            finData,
                            isUpcoming: weekNum > currentWeek,
                            isMissed: weekNum <= currentWeek && finData.totalAmount === 0
                          });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="heatmap-legend">
            <div className="heatmap-key">
              <span
                className="heatmap-key-dot level-0"
                title="Missed (0 shares)"
              ></span>
              <span className="heatmap-key-label">Missed</span>
              <span className="heatmap-key-label">Less</span>
              <span className="heatmap-key-dot level-1" title="1-2 shares (Underperformance)"></span>
              <span className="heatmap-key-dot level-2" title="3-4 shares (Fair)"></span>
              <span className="heatmap-key-dot level-3" title="5-7 shares (Good)"></span>
              <span className="heatmap-key-dot level-4" title="8-10 shares (Excellent)"></span>
              <span className="heatmap-key-label">More</span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Interactive Tooltip Popover */}
      {activeTooltip && (
        <div
          className="heatmap-popover-tooltip"
          style={{
            position: "fixed",
            left: `${activeTooltip.x}px`,
            top: `${activeTooltip.y - 12}px`,
            transform: "translate(-50%, -100%)",
            zIndex: 100000
          }}
        >
          <div className="tooltip-header">
            <i className="fa-solid fa-calendar-day tooltip-icon"></i>
            <span className="tooltip-date-highlight">{activeTooltip.dateLabel}</span>
          </div>

          <div className="tooltip-body">
            {activeTooltip.isUpcoming ? (
              <div className="tooltip-status-badge upcoming">
                <i className="fa-solid fa-clock"></i> Upcoming Period
              </div>
            ) : activeTooltip.isMissed ? (
              <div className="tooltip-status-badge missed">
                <i className="fa-solid fa-triangle-exclamation"></i> No transactions on this date (Missed)
              </div>
            ) : (
              <div className="tooltip-financial-list">
                {activeTooltip.finData.sharesAmount > 0 && (
                  <div className="tooltip-fin-row">
                    <span className="tooltip-fin-label">Shares Contribution:</span>
                    <span className="tooltip-fin-value">Shs {activeTooltip.finData.sharesAmount.toLocaleString()} ({activeTooltip.finData.sharesCount} shares)</span>
                  </div>
                )}
                {activeTooltip.finData.devtAmount > 0 && (
                  <div className="tooltip-fin-row">
                    <span className="tooltip-fin-label">Development Fund:</span>
                    <span className="tooltip-fin-value">Shs {activeTooltip.finData.devtAmount.toLocaleString()}</span>
                  </div>
                )}
                {activeTooltip.finData.socialAmount > 0 && (
                  <div className="tooltip-fin-row">
                    <span className="tooltip-fin-label">Social Fund:</span>
                    <span className="tooltip-fin-value">Shs {activeTooltip.finData.socialAmount.toLocaleString()}</span>
                  </div>
                )}
                <div className="tooltip-fin-total">
                  <span>Total Contributed:</span>
                  <span>Shs {activeTooltip.finData.totalAmount.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
