import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import CustomSelect from "./CustomSelect";
import { getForthcomingMeetingDate } from "../utils/meetingDateUtils";
import { DEFAULT_SHARE_PRICE, shareCountOf } from "../utils/sharePricing";
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
          dayNumber: d,
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

export default function CalendarHeatMap({ memberId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sharesConsistency, setSharesConsistency] = useState(100);
  const [devFundConsistency, setDevFundConsistency] = useState(100);
  const [socialFundConsistency, setSocialFundConsistency] = useState(100);
  const [meetingFinancialData, setMeetingFinancialData] = useState({});
  // No meetingContributions state: the per-meeting Set of categories is built as a local in
  // the loader and consumed there to compute the three consistency percentages. It was also
  // copied into state that only a dead line in the render read, so the copy is gone and the
  // local stays.
  const [meetingShares, setMeetingShares] = useState({});
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [meetingDay, setMeetingDay] = useState("Wednesday");
  const [monthlyMeetingsStructure, setMonthlyMeetingsStructure] = useState([]);
  const [saccoCreatedAtDate, setSaccoCreatedAtDate] = useState(null);
  const [startMeetingIndex, setStartMeetingIndex] = useState(1);
  // A SACCO onboarded with years of paper records has activity long before this year.
  // The grid is built for one year at a time, so which year is being looked at has to be
  // part of the state rather than assumed to be the current one.
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState([]);

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
    // Defined inside the effect that owns it, which also settles the dependency warning:
    // it reads memberId and selectedYear, so as an outside function it was a dependency
    // the effect could not list without re-subscribing the realtime channel every render.
    async function loadContributionHabits() {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setLoading(false);
          return;
        }

        const params = new URLSearchParams({ year: String(selectedYear) });
        if (memberId) params.set("memberId", memberId);
        const res = await fetch(`/api/contribution-habits?${params.toString()}`, {
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

        if (Array.isArray(data.availableYears) && data.availableYears.length) {
          setAvailableYears(data.availableYears);
        }

        // The grid must be built for the year being viewed, not for today. Building it for
        // the current year while showing another year's transactions would snap every one
        // of them onto the nearest meeting of the wrong year.
        const { monthlyData, totalMeetings } = getMonthlyMeetingDates(selectedYear, configuredDay);
        setMonthlyMeetingsStructure(monthlyData);

        const weeksElapsed = settings.currentWeek || 1;
        setCurrentWeek(weeksElapsed);

        // Flatten meetings for quick lookup
        const allMeetings = [];
        monthlyData.forEach(m => allMeetings.push(...m.meetings));

        // Which meeting the SACCO actually joined on. Meetings before it are dimmed rather
        // than scored, because a member cannot have missed a meeting that happened before
        // their group was keeping records here.
        //
        // This used to be skipped entirely whenever isHistoricalMode was on, pinning the
        // start to meeting 1 -- which meant switching the toggle on to backfill turned every
        // week between January and the onboarding date bright red on every member's screen,
        // accusing them of missing meetings that predate the SACCO. Backfilled entries were
        // never at risk of being hidden by clipping here (a meeting with contributions is
        // coloured from its own data, before the start index is ever consulted), so the
        // special case bought nothing and cost that.
        let onboardMeetingIdx = 1;
        let onboardDateObj = null;

        // Once the SACCO has finished historical onboarding, the anchor -- its own Week 1 --
        // is where the record genuinely begins, and it is usually well before the day the
        // group registered here. Preferring it is what stops a backfilled year of real
        // contributions being dimmed as "pre-onboarding".
        //
        // An anchor in an earlier year than the one on screen resolves to meeting 1 through
        // the nearest-match below, which is correct: every meeting of this year is inside
        // the record.
        const rawOnboardDate = settings.weekAnchorDate
          || data.saccoCreatedAt || settings.onboardingDate || settings.onboarding_date;

        // The date shown in the tooltip stays the day the group actually registered -- that
        // label says "registered on", and the anchor is a different fact.
        const rawRegisteredDate = data.saccoCreatedAt || settings.onboardingDate || settings.onboarding_date;
        if (rawRegisteredDate) {
          setSaccoCreatedAtDate(new Date(rawRegisteredDate));
        }

        if (rawOnboardDate) {
          onboardDateObj = new Date(rawOnboardDate);

          // Find the exact meeting date corresponding to the SACCO onboarding week using unified getForthcomingMeetingDate
          const targetOnboardMeetingDate = getForthcomingMeetingDate(onboardDateObj, configuredDay);

          let bestIdx = 1;
          let minDiff = Infinity;

          allMeetings.forEach(m => {
            const diffMs = Math.abs(m.date.getTime() - targetOnboardMeetingDate.getTime());
            if (diffMs < minDiff) {
              minDiff = diffMs;
              bestIdx = m.globalMeetingIndex;
            }
          });

          onboardMeetingIdx = bestIdx;
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
            finesAmount: 0,
            txDates: [],
            totalAmount: 0,
            txList: []
          };
        }

        // Map transactions by created_at timestamp using unified getForthcomingMeetingDate
        transactions.forEach((tx) => {
          let explicitWeek = Number(tx.week_number) || Number(tx.week);
        
          if (!explicitWeek && tx.description) {
            const match = tx.description.match(/week\s*(\d+)/i);
            if (match) {
              explicitWeek = parseInt(match[1], 10);
            }
          }

          let meetingIndex = null;

          // 0. Priority: a row that NAMES its week.
          //
          // settle_mandatory_weeks (migration 0038) writes arrears payments stamped with
          // week_number and dated the day the cash arrived. Matching on created_at first
          // would draw that money on the meeting it was HANDED OVER at, leaving the week it
          // actually settled blank forever -- which is exactly the disagreement between this
          // tracker and the arrears card that the week ledger exists to end. An explicit
          // week outranks any inference from a date.
          //
          // Only rows carrying a real week_number take this path; the description fallback
          // below is a regex over prose and is not authoritative enough to outrank a date.
          if (Number(tx.week_number) && onboardMeetingIdx) {
            meetingIndex = onboardMeetingIdx + Number(tx.week_number) - 1;
          }

          // 1. Otherwise match using unified getForthcomingMeetingDate algorithm
          if (!meetingIndex && tx.created_at) {
            const txDate = new Date(tx.created_at);
            const targetMeetingDate = getForthcomingMeetingDate(txDate, configuredDay);

            let bestMeetingIdx = null;
            let minDiff = Infinity;

            allMeetings.forEach(m => {
              const diffMs = Math.abs(m.date.getTime() - targetMeetingDate.getTime());
              if (diffMs < minDiff) {
                minDiff = diffMs;
                bestMeetingIdx = m.globalMeetingIndex;
              }
            });

            meetingIndex = bestMeetingIdx;
          }

          // 2. Fallback: Map relative SACCO week number starting from onboardMeetingIdx
          if (!meetingIndex && explicitWeek) {
            meetingIndex = onboardMeetingIdx + explicitWeek - 1;
          }

          if (!meetingIndex) {
            meetingIndex = onboardMeetingIdx + (weeksElapsed || 1) - 1;
          }

          if (meetingIndex >= 1 && meetingIndex <= totalMeetings) {
            let catNorm = tx.category;
            if (catNorm === 'devt') catNorm = 'development_fund';
            if (catNorm === 'social') catNorm = 'social_fund';
            if (catNorm === 'fine' || catNorm === 'penalty' || catNorm === 'absenteeism') catNorm = 'fines';

            tempContributions[meetingIndex].add(catNorm);
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

            if (catNorm === 'shares') {
              // The count the member actually bought, from the row itself. Dividing by the
              // current price re-interpreted every past week whenever the admin changed it.
              const numShares = shareCountOf(tx, settings.sharePrice || DEFAULT_SHARE_PRICE);
              tempShares[meetingIndex] += numShares;
              mData.sharesAmount += amt;
              mData.sharesCount += numShares;
            } else if (catNorm === 'development_fund') {
              mData.devtAmount += amt;
            } else if (catNorm === 'social_fund') {
              mData.socialAmount += amt;
            } else if (catNorm === 'fines') {
              mData.finesAmount += amt;
            }

            mData.txList.push({
              id: tx.id,
              category: catNorm,
              amount: amt,
              date: tx.created_at ? new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "N/A",
              status: tx.status || "completed"
            });
          }
        });

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

    // Subscribe to real-time transactions updates for instant green heatmap tier updates
    const channel = supabase
      .channel('realtime-habits-tracker')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        () => {
          loadContributionHabits();
        }
      )
      .subscribe();

    function handleSettingsUpdate(e) {
      if (e.detail && e.detail.meetingDay) {
        setMeetingDay(e.detail.meetingDay);
      }
      loadContributionHabits();
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
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_settings_updated", handleSettingsUpdate);
        window.removeEventListener("sacco_transaction_updated", handleTransactionUpdate);
        window.removeEventListener("manual_contribution_logged", handleTransactionUpdate);
      }
    };
  }, [memberId, selectedYear]);

  const triggerTooltip = (e, meetingItem) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const finData = meetingFinancialData[meetingItem.globalMeetingIndex] || { sharesAmount: 0, devtAmount: 0, socialAmount: 0, finesAmount: 0, totalAmount: 0, txDates: [], txList: [] };

    const dateLabel = `${meetingItem.fullDateString} (Meeting ${meetingItem.monthMeetingIndex} of ${meetingItem.monthName})`;

    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 360;
    const estimatedWidth = Math.min(320, viewportWidth - 24);

    let clampedX = rect.left + rect.width / 2;
    if (clampedX - estimatedWidth / 2 < 12) {
      clampedX = 12 + estimatedWidth / 2;
    } else if (clampedX + estimatedWidth / 2 > viewportWidth - 12) {
      clampedX = viewportWidth - 12 - estimatedWidth / 2;
    }

    const positionBelow = rect.top < 160;
    const clampedY = positionBelow ? rect.bottom + 8 : rect.top - 8;

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const activeEndIndex = startMeetingIndex + currentWeek - 1;
    const isPreOnboarding = meetingItem.globalMeetingIndex < startMeetingIndex;
    const isFutureDate = meetingItem.date > today;
    const isUpcoming = isFutureDate || meetingItem.globalMeetingIndex > activeEndIndex;
    const isMissed = !isPreOnboarding && !isUpcoming && (finData.sharesAmount === 0 || (finData.sharesCount || 0) === 0);

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

  // A year that finished before the SACCO joined the system holds only whatever has been
  // backfilled so far. "Missed" is not a claim that can be made about it -- an empty
  // meeting there means nobody has typed that record in yet, not that the member failed
  // to pay. Live years keep the original red/grey semantics.
  const isHistoricalYear = selectedYear < new Date().getFullYear();

  return (
    <div className="quick-actions">
      <div className="section-header">
        <h3 className="section-title">Contribution Habits</h3>
      </div>

      {/* The load failure was being captured into state and then rendered nowhere, so a
          member whose habits could not be fetched saw 0% consistency across every fund --
          indistinguishable from a member who had genuinely never contributed. */}
      {error && !loading && (
        <div
          role="alert"
          style={{
            margin: "1.2rem 0",
            padding: "1rem 1.2rem",
            borderRadius: "0.8rem",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            color: "#991b1b",
            fontSize: "1.25rem",
            fontWeight: 600
          }}
        >
          Your contribution habits could not be loaded, so the percentages below are not
          your real figures. Reload the page to try again.
        </div>
      )}
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
              <p>
                {isHistoricalYear ? (
                  <>Backfilled records for every <strong>{meetingDay}</strong> of <strong>{selectedYear}</strong>, filed on the dates they actually happened.</>
                ) : (
                  <>Visualizing meeting obligations for every <strong>{meetingDay}</strong> starting from SACCO onboarding ({saccoCreatedAtDate ? saccoCreatedAtDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Registration Date"}).</>
                )}
              </p>
            </div>
            {availableYears.length > 1 && (
              <CustomSelect
                value={selectedYear}
                options={availableYears.map((y) => ({ value: y, label: String(y) }))}
                onChange={(val) => setSelectedYear(Number(val))}
                minWidth="10rem"
              />
            )}
            <span>
              {isHistoricalYear
                ? "Green = recorded, Gray = no record entered"
                : "Green = contributed, Red = missed, Gray = scheduled"}
            </span>
          </div>

          <div className="heatmap-months">
            {monthlyMeetingsStructure.map((month) => (
              <div key={month.name} className="heatmap-month">
                <span>{month.name}</span>
                <div className="heatmap-weekdays">
                  {month.meetings.map((mItem) => {
                    const idx = mItem.globalMeetingIndex;
                    const sharesCount = meetingShares[idx] || 0;

                    let levelClass = "";
                    let inlineStyle = {};

                    const today = new Date();
                    today.setHours(23, 59, 59, 999);

                    const activeEndIndex = startMeetingIndex + currentWeek - 1;
                    const isFutureDate = mItem.date > today;
                    const isUpcoming = isFutureDate || idx > activeEndIndex;
                    const hasShares = sharesCount > 0;

                    // Green box level is STRICTLY conditional on user contributing shares (> 0 shares)
                    if (hasShares) {
                      if (sharesCount <= 2) {
                        levelClass = "level-1"; // 1-2 shares
                      } else if (sharesCount <= 5) {
                        levelClass = "level-2"; // 3-5 shares
                      } else if (sharesCount <= 8) {
                        levelClass = "level-3"; // 6-8 shares
                      } else {
                        levelClass = "level-4"; // 9-10+ shares
                      }
                    } else if (isHistoricalYear) {
                      // No record entered for that meeting -- not a missed payment.
                      inlineStyle = { backgroundColor: "#f8fafc", border: "0.1rem dashed #cbd5e1", opacity: 0.6 };
                    } else if (idx < startMeetingIndex) {
                      inlineStyle = { backgroundColor: "#f8fafc", border: "0.1rem dashed #cbd5e1", opacity: 0.6 };
                    } else if (isUpcoming) {
                      inlineStyle = { backgroundColor: "#e2e8f0", border: "0.1rem solid #cbd5e1" };
                    } else {
                      // Failed to contribute shares for an elapsed meeting week -> RED BOX!
                      levelClass = "level-0";
                    }

                    return (
                      <div
                        key={mItem.globalMeetingIndex}
                        className={`heatmap-day ${levelClass}`}
                        style={inlineStyle}
                        onMouseEnter={(e) => triggerTooltip(e, mItem)}
                        onMouseLeave={() => setActiveTooltip(null)}
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
              <span className="heatmap-key-dot level-1" title="1-2 shares"></span>
              <span className="heatmap-key-label" style={{ fontSize: "1.1rem", color: "#64748b" }}>1-2</span>
              <span className="heatmap-key-dot level-2" title="3-5 shares"></span>
              <span className="heatmap-key-label" style={{ fontSize: "1.1rem", color: "#64748b" }}>3-5</span>
              <span className="heatmap-key-dot level-3" title="6-8 shares"></span>
              <span className="heatmap-key-label" style={{ fontSize: "1.1rem", color: "#64748b" }}>6-8</span>
              <span className="heatmap-key-dot level-4" title="9-10+ shares"></span>
              <span className="heatmap-key-label" style={{ fontSize: "1.1rem", color: "#64748b" }}>9-10+</span>
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
            {activeTooltip.isPreOnboarding && activeTooltip.finData.totalAmount === 0 ? (
              <div className="tooltip-status-badge upcoming" style={{ background: "#f1f5f9", color: "#64748b" }}>
                <i className="fa-solid fa-flag"></i> Pre-Onboarding Period (SACCO registered on {activeTooltip.onboardDateFormatted || "Registration Date"})
              </div>
            ) : activeTooltip.isUpcoming && activeTooltip.finData.totalAmount === 0 ? (
              <div className="tooltip-status-badge upcoming">
                <i className="fa-solid fa-clock"></i> Scheduled Meeting Date
              </div>
            ) : activeTooltip.finData.totalAmount === 0 ? (
              <div className="tooltip-status-badge missed">
                <i className="fa-solid fa-triangle-exclamation"></i> No transactions on this meeting date (Missed)
              </div>
            ) : (
              <div className="tooltip-financial-list">
                {activeTooltip.finData.sharesAmount === 0 && (
                  <div className="tooltip-status-badge missed" style={{ marginBottom: "0.8rem", padding: "0.4rem 0.8rem", fontSize: "1.1rem" }}>
                    <i className="fa-solid fa-triangle-exclamation"></i> Missed Shares Obligation (0 Shares)
                  </div>
                )}

                <div style={{ fontSize: "1.1rem", textTransform: "uppercase", letterSpacing: "0.05rem", color: "#94a3b8", fontWeight: 700, marginBottom: "0.4rem" }}>
                  Weekly Transactions Summary
                </div>

                {activeTooltip.finData.sharesAmount > 0 && (
                  <div className="tooltip-fin-row">
                    <span className="tooltip-fin-label"><i className="fa-solid fa-chart-pie" style={{ color: "#38bdf8", marginRight: "0.4rem" }}></i> Shares Contribution:</span>
                    <span className="tooltip-fin-value">Shs {activeTooltip.finData.sharesAmount.toLocaleString()} ({activeTooltip.finData.sharesCount} shares)</span>
                  </div>
                )}
                {activeTooltip.finData.devtAmount > 0 && (
                  <div className="tooltip-fin-row">
                    <span className="tooltip-fin-label"><i className="fa-solid fa-building" style={{ color: "#4ade80", marginRight: "0.4rem" }}></i> Development Fund:</span>
                    <span className="tooltip-fin-value">Shs {activeTooltip.finData.devtAmount.toLocaleString()}</span>
                  </div>
                )}
                {activeTooltip.finData.socialAmount > 0 && (
                  <div className="tooltip-fin-row">
                    <span className="tooltip-fin-label"><i className="fa-solid fa-hand-holding-heart" style={{ color: "#f87171", marginRight: "0.4rem" }}></i> Social Fund:</span>
                    <span className="tooltip-fin-value">Shs {activeTooltip.finData.socialAmount.toLocaleString()}</span>
                  </div>
                )}
                {activeTooltip.finData.finesAmount > 0 && (
                  <div className="tooltip-fin-row">
                    <span className="tooltip-fin-label"><i className="fa-solid fa-user-xmark" style={{ color: "#fbbf24", marginRight: "0.4rem" }}></i> Absenteeism Fines:</span>
                    <span className="tooltip-fin-value" style={{ color: "#fbbf24" }}>Shs {activeTooltip.finData.finesAmount.toLocaleString()}</span>
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
