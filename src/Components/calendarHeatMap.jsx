import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/calendarHeatMap.css";
import "../styles/UserProgressTracker.css";

const DAY_INDICES = {
  "Sunday": 0,
  "Monday": 1,
  "Tuesday": 2,
  "Wednesday": 3,
  "Thursday": 4,
  "Friday": 5,
  "Saturday": 6
};

// Generate exact meeting dates for every month of the specified year based on meetingDay
function getMonthlyMeetingDates(year, meetingDayName) {
  const targetDayIndex = DAY_INDICES[meetingDayName] !== undefined ? DAY_INDICES[meetingDayName] : 3;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  const monthlyData = [];
  let globalMeetingCounter = 0;

  monthNames.forEach((name, monthIdx) => {
    const meetingsInMonth = [];
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, monthIdx, d);
      if (dateObj.getDay() === targetDayIndex) {
        globalMeetingCounter++;
        meetingsInMonth.push({
          globalMeetingIndex: globalMeetingCounter,
          monthMeetingIndex: meetingsInMonth.length + 1,
          date: dateObj,
          monthName: name,
          fullDateString: dateObj.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" }),
          shortDateString: dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        });
      }
    }

    monthlyData.push({
      name,
      monthIdx,
      meetings: meetingsInMonth
    });
  });

  return { monthlyData, totalMeetings: globalMeetingCounter };
}

export default function CalendarHeatMap() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sharesConsistency, setSharesConsistency] = useState(100);
  const [devFundConsistency, setDevFundConsistency] = useState(100);
  const [socialFundConsistency, setSocialFundConsistency] = useState(100);
  const [meetingFinancialData, setMeetingFinancialData] = useState({});
  const [meetingContributions, setMeetingContributions] = useState({});
  const [meetingShares, setMeetingShares] = useState({});
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [meetingDay, setMeetingDay] = useState("Wednesday");
  const [monthlyMeetingsStructure, setMonthlyMeetingsStructure] = useState([]);
  const [saccoCreatedAtDate, setSaccoCreatedAtDate] = useState(null);
  const [startMeetingIndex, setStartMeetingIndex] = useState(1);

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
          },
          cache: "no-store"
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch contribution habits");

        const transactions = data.transactions || [];
        const settings = data.settings || {};
        const configuredDay = settings.meetingDay || "Wednesday";
        setMeetingDay(configuredDay);

        const currentYear = new Date().getFullYear();
        const { monthlyData, totalMeetings } = getMonthlyMeetingDates(currentYear, configuredDay);
        setMonthlyMeetingsStructure(monthlyData);

        const weeksElapsed = settings.currentWeek || 1;
        setCurrentWeek(weeksElapsed);

        // Determine SACCO Onboarding Start Meeting Index from saccoCreatedAt
        let onboardMeetingIdx = 1;
        let onboardDateObj = null;

        if (data.saccoCreatedAt) {
          onboardDateObj = new Date(data.saccoCreatedAt);
          setSaccoCreatedAtDate(onboardDateObj);

          for (const month of monthlyData) {
            for (const m of month.meetings) {
              if (m.date >= onboardDateObj || (m.date.getFullYear() === onboardDateObj.getFullYear() && m.date.getMonth() === onboardDateObj.getMonth() && m.date.getDate() >= onboardDateObj.getDate())) {
                onboardMeetingIdx = m.globalMeetingIndex;
                break;
              }
            }
            if (onboardMeetingIdx > 1) break;
          }
        }
        setStartMeetingIndex(onboardMeetingIdx);

        // Group financial activity by globalMeetingIndex (1 to 52)
        const tempFinancialData = {};
        const tempContributions = {};
        const tempShares = {};

        for (let mIdx = 1; mIdx <= totalMeetings; mIdx++) {
          tempContributions[mIdx] = new Set();
          tempShares[mIdx] = 0;
          tempFinancialData[mIdx] = {
            sharesAmount: 0,
            sharesCount: 0,
            devtAmount: 0,
            socialAmount: 0,
            txDates: [],
            totalAmount: 0
          };
        }

        // Map transactions to exact week number or closest meeting date window
        transactions.forEach((tx) => {
          let meetingIndex = Number(tx.week_number) || Number(tx.week);
          
          if (!meetingIndex && tx.description) {
            const match = tx.description.match(/week\s*(\d+)/i);
            if (match) {
              meetingIndex = parseInt(match[1], 10);
            }
          }

          if (!meetingIndex && tx.created_at) {
            const txDate = new Date(tx.created_at);
            let minDiff = Infinity;
            monthlyData.forEach(month => {
              month.meetings.forEach(m => {
                const diffDays = Math.abs((txDate - m.date) / (1000 * 60 * 60 * 24));
                if (diffDays < minDiff) {
                  minDiff = diffDays;
                  meetingIndex = m.globalMeetingIndex;
                }
              });
            });
          }

          if (!meetingIndex) {
            meetingIndex = weeksElapsed || 1;
          }

          if (meetingIndex >= 1 && meetingIndex <= totalMeetings) {
            tempContributions[meetingIndex].add(tx.category);
            const amt = Number(tx.amount) || 0;
            const mData = tempFinancialData[meetingIndex];
            mData.totalAmount += amt;

            if (tx.created_at) {
              const d = new Date(tx.created_at);
              const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              if (!mData.txDates.includes(dateStr)) {
                mData.txDates.push(dateStr);
              }
            }

            if (tx.category === 'shares') {
              const numShares = Math.floor(amt / (settings.sharePrice || 25000));
              tempShares[meetingIndex] += numShares;
              mData.sharesAmount += amt;
              mData.sharesCount += numShares;
            } else if (tx.category === 'development_fund') {
              mData.devtAmount += amt;
            } else if (tx.category === 'social_fund') {
              mData.socialAmount += amt;
            }
          }
        });

        setMeetingContributions(tempContributions);
        setMeetingShares(tempShares);
        setMeetingFinancialData(tempFinancialData);

        const calcConsistency = (contributedCount) => {
          const ratio = contributedCount / (weeksElapsed || 1);
          return Math.min(100, Math.round(ratio * 100));
        };

        const shareCount = Object.keys(tempContributions).filter(w => tempContributions[w].has('shares')).length;
        const devCount = Object.keys(tempContributions).filter(w => tempContributions[w].has('development_fund')).length;
        const socialCount = Object.keys(tempContributions).filter(w => tempContributions[w].has('social_fund')).length;

        setSharesConsistency(calcConsistency(shareCount));
        setDevFundConsistency(calcConsistency(devCount));
        setSocialFundConsistency(calcConsistency(socialCount));
      } catch (err) {
        console.error("Error loading contribution habits:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadContributionHabits();

    function handleSettingsUpdate(e) {
      if (e.detail && e.detail.meetingDay) {
        setMeetingDay(e.detail.meetingDay);
        loadContributionHabits();
      }
    }

    function handleTransactionUpdate() {
      loadContributionHabits();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_settings_updated", handleSettingsUpdate);
      window.addEventListener("sacco_transaction_updated", handleTransactionUpdate);
      window.addEventListener("manual_contribution_logged", handleTransactionUpdate);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_settings_updated", handleSettingsUpdate);
        window.removeEventListener("sacco_transaction_updated", handleTransactionUpdate);
        window.removeEventListener("manual_contribution_logged", handleTransactionUpdate);
      }
    };
  }, []);

  const triggerTooltip = (e, meetingItem) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const finData = meetingFinancialData[meetingItem.globalMeetingIndex] || { sharesAmount: 0, devtAmount: 0, socialAmount: 0, totalAmount: 0, txDates: [] };

    const dateLabel = `${meetingItem.fullDateString} (Meeting ${meetingItem.monthMeetingIndex} of ${meetingItem.monthName})`;

    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 360;
    const estimatedWidth = Math.min(280, viewportWidth - 24);

    let clampedX = rect.left + rect.width / 2;
    if (clampedX - estimatedWidth / 2 < 12) {
      clampedX = 12 + estimatedWidth / 2;
    } else if (clampedX + estimatedWidth / 2 > viewportWidth - 12) {
      clampedX = viewportWidth - 12 - estimatedWidth / 2;
    }

    const positionBelow = rect.top < 160;
    const clampedY = positionBelow ? rect.bottom + 8 : rect.top - 8;

    const activeEndIndex = startMeetingIndex + currentWeek - 1;
    const isPreOnboarding = meetingItem.globalMeetingIndex < startMeetingIndex;
    const isUpcoming = meetingItem.globalMeetingIndex > activeEndIndex;
    const isMissed = meetingItem.globalMeetingIndex >= startMeetingIndex && meetingItem.globalMeetingIndex <= activeEndIndex && finData.totalAmount === 0;

    setActiveTooltip({
      x: clampedX,
      y: clampedY,
      positionBelow,
      dateLabel,
      finData,
      isPreOnboarding,
      isUpcoming,
      isMissed,
      onboardDateFormatted: saccoCreatedAtDate ? saccoCreatedAtDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""
    });
  };

  return (
    <div className="quick-actions">
      <div className="section-header">
        <h3 className="section-title">Contribution Habits</h3>
      </div>
      <div style={{ marginTop: "15px", paddingBottom: "5px" }}>
        <h4 style={{ fontSize: "1.8rem", color: "var(--text-dark)", marginBottom: "1.2rem" }}>
          Shares Pool Consistency
          <span style={{ float: "right", color: "#253b8e" }}>
            {loading ? "..." : `${sharesConsistency}%`}
          </span>
        </h4>
        <div style={{ width: "100%", height: "8px", backgroundColor: "#f1f5f9", borderRadius: "4px", overflow: "hidden", marginBottom: "20px" }}>
          <div style={{ width: loading ? "0%" : `${sharesConsistency}%`, height: "100%", backgroundColor: "#253b8e", transition: "width 0.5s ease-in-out" }} />
        </div>

        <h4 style={{ fontSize: "1.8rem", color: "var(--text-dark)", marginBottom: "1.2rem" }}>
          Dev Fund Obligations
          <span style={{ float: "right", color: "var(--success)" }}>
            {loading ? "..." : `${devFundConsistency}%`}
          </span>
        </h4>
        <div style={{ width: "100%", height: "8px", backgroundColor: "#f1f5f9", borderRadius: "4px", overflow: "hidden", marginBottom: "20px" }}>
          <div style={{ width: loading ? "0%" : `${devFundConsistency}%`, height: "100%", backgroundColor: "var(--success)", transition: "width 0.5s ease-in-out" }} />
        </div>

        <h4 style={{ fontSize: "1.8rem", color: "var(--text-dark)", marginBottom: "1.2rem" }}>
          Social Fund Activity
          <span style={{ float: "right", color: "#ef4444" }}>
            {loading ? "..." : `${socialFundConsistency}%`}
          </span>
        </h4>
        <div style={{ width: "100%", height: "8px", backgroundColor: "#f1f5f9", borderRadius: "4px", overflow: "hidden", marginBottom: "20px" }}>
          <div style={{ width: loading ? "0%" : `${socialFundConsistency}%`, height: "100%", backgroundColor: "#ef4444", transition: "width 0.5s ease-in-out" }} />
        </div>

        {/* Calendar Heatmap */}
        <div className="calendar-heatmap">
          <div className="heatmap-header">
            <div>
              <h4>Contribution Habit Tracker</h4>
              <p>Visualizing meeting obligations for every <strong>{meetingDay}</strong> starting from SACCO onboarding ({saccoCreatedAtDate ? saccoCreatedAtDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Registration Date"}).</p>
            </div>
            <span>Green = contributed, Red = missed, Gray = scheduled</span>
          </div>

          <div className="heatmap-months">
            {monthlyMeetingsStructure.map((month) => (
              <div key={month.name} className="heatmap-month">
                <span>{month.name}</span>
                <div className="heatmap-weekdays">
                  {month.meetings.map((mItem) => {
                    const idx = mItem.globalMeetingIndex;
                    const contributions = meetingContributions[idx] || new Set();
                    const sharesCount = meetingShares[idx] || 0;

                    let levelClass = "";
                    let inlineStyle = {};

                    const activeEndIndex = startMeetingIndex + currentWeek - 1;

                    if (idx < startMeetingIndex) {
                      inlineStyle = { backgroundColor: "#f8fafc", border: "0.1rem dashed #cbd5e1", opacity: 0.6 };
                    } else if (idx > activeEndIndex) {
                      inlineStyle = { backgroundColor: "#e2e8f0", border: "0.1rem solid #cbd5e1" };
                    } else {
                      const hasContribution = (contributions && contributions.size > 0) || sharesCount > 0;
                      if (!hasContribution) {
                        levelClass = "level-0";
                      } else if (sharesCount <= 2) {
                        levelClass = "level-1";
                      } else if (sharesCount <= 4) {
                        levelClass = "level-2";
                      } else if (sharesCount <= 7) {
                        levelClass = "level-3";
                      } else {
                        levelClass = "level-4";
                      }
                    }

                    return (
                      <div
                        key={mItem.globalMeetingIndex}
                        className={`heatmap-day ${levelClass}`}
                        style={inlineStyle}
                        title={mItem.fullDateString}
                        onMouseEnter={(e) => triggerTooltip(e, mItem)}
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerTooltip(e, mItem);
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
              <span className="heatmap-key-dot level-0" title="Missed (0 shares)"></span>
              <span className="heatmap-key-label">Missed</span>
              <span className="heatmap-key-label">Less</span>
              <span className="heatmap-key-dot level-1" title="1-2 shares"></span>
              <span className="heatmap-key-dot level-2" title="3-4 shares"></span>
              <span className="heatmap-key-dot level-3" title="5-7 shares"></span>
              <span className="heatmap-key-dot level-4" title="8-10 shares"></span>
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
            {activeTooltip.isPreOnboarding ? (
              <div className="tooltip-status-badge upcoming" style={{ background: "#f1f5f9", color: "#64748b" }}>
                <i className="fa-solid fa-flag"></i> Pre-Onboarding Period (SACCO registered on {activeTooltip.onboardDateFormatted || "Registration Date"})
              </div>
            ) : activeTooltip.isUpcoming ? (
              <div className="tooltip-status-badge upcoming">
                <i className="fa-solid fa-clock"></i> Scheduled Meeting Date
              </div>
            ) : activeTooltip.isMissed ? (
              <div className="tooltip-status-badge missed">
                <i className="fa-solid fa-triangle-exclamation"></i> No transactions on this meeting date (Missed)
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
