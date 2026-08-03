import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabaseClient";
import CustomSelect from "./CustomSelect";
import { getSaccoWeekOf } from "../utils/meetingDateUtils";
import "../styles/featureArea.css";

// Everything a SACCO could have on paper before it was onboarded. Fines used to be
// excluded here because the form had no field for what the fine was for, which would
// have produced fines indistinguishable from absence fines. There is a reason field now,
// so they belong -- an admin backfilling a year of records cannot be asked to leave the
// penalties out.
const recordTypeOptions = [
  { value: "shares", label: "Shares Contribution" },
  { value: "development_fund", label: "Development Fund" },
  { value: "social_fund", label: "Social Fund" },
  { value: "savings", label: "Savings" },
  { value: "fines", label: "Fine / Penalty" },
  { value: "loan_disbursement", label: "Loan Issued" },
  { value: "loan_repayment", label: "Loan Repayment" },
  { value: "dividend", label: "Dividend Paid Out" }
];

const loanTypeOptions = [
  { value: "normal", label: "Normal Loan (5% p.m.)" },
  { value: "social_fund", label: "Social Fund Emergency (0%)" }
];

const DAY_INDICES = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6
};

function todayISO() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * Which meeting week a date falls in when the SACCO has no anchor yet -- the Nth
 * occurrence of its meeting day within that date's own calendar year.
 *
 * Mirrors meeting_week_of() in migration 0028 exactly, including the "minimum 1" for a
 * date landing before the year's first meeting day. This is only ever shown to the
 * admin for confirmation; the number actually stored is the one the database computes,
 * so the two cannot drift apart in the ledger even if this ever disagreed.
 *
 * Once historical onboarding is finished the SACCO counts from an anchor instead and
 * getSaccoWeekOf takes over -- see derivedWeek below. Records typed before that point are
 * renumbered by finalize_historical_onboarding, so this rule is only ever what a row
 * starts out with.
 *
 * Arithmetic in UTC rather than local time: the previous version of this form walked
 * every day of the year in local time for each of 52 weeks on every single render, which
 * was roughly nineteen thousand Date allocations per keystroke, and local-time day
 * arithmetic silently loses an hour across a DST boundary.
 */
function meetingWeekOf(dateStr, meetingDayName) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;

  const targetDow = DAY_INDICES[meetingDayName] ?? 3;
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const firstMeeting = new Date(Date.UTC(year, 0, 1 + ((targetDow - jan1.getUTCDay() + 7) % 7)));

  if (d < firstMeeting) return 1;
  return Math.floor(Math.round((d - firstMeeting) / 86400000) / 7) + 1;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC"
  });
}

export default function ManualContributionLog({ allMembers }) {
  const [addMember, setAddMember] = useState("");
  const [recordType, setRecordType] = useState("shares");
  const [addAmount, setAddAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [currentWeek, setCurrentWeek] = useState(1);
  const [meetingDay, setMeetingDay] = useState("Wednesday");
  // Week 1 of the SACCO's cycle, once historical onboarding has been finished. null until
  // then, and the calendar-year rule is used instead.
  const [weekAnchorDate, setWeekAnchorDate] = useState(null);
  // Backdating is only permitted while the SACCO has historical onboarding switched on
  // in Configuration Settings. The database enforces this too -- see migration 0028 --
  // so this flag is here to explain the rule, not to be the rule.
  const [historicalEnabled, setHistoricalEnabled] = useState(false);
  const [loggingMode, setLoggingMode] = useState("current"); // "current" | "historical"
  // Last value of the setting this form has seen, so the tab can follow the switch being
  // flipped without also fighting the admin. `null` means settings have not loaded yet.
  const lastHistoricalSetting = useRef(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null); // { type: "success" | "error", text }
  const [recentlyLogged, setRecentlyLogged] = useState([]);

  // Loan disbursement
  const [termMonths, setTermMonths] = useState(1);
  const [loanType, setLoanType] = useState("normal");
  const [purpose, setPurpose] = useState("");

  // Loan repayment
  const [openLoans, setOpenLoans] = useState([]);
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [loansLoading, setLoansLoading] = useState(false);
  // Bumped after a repayment lands, so the picker re-reads the outstanding balances it
  // just changed. Keeping the fetch entirely inside the effect is what stops it being a
  // setState called synchronously from an effect body.
  const [loansRefreshKey, setLoansRefreshKey] = useState(0);

  // Fines
  const [fineReason, setFineReason] = useState("");

  // Derived rather than stored, so that if an admin switches historical onboarding off in
  // Configuration Settings while this form is open, the realtime settings subscription
  // flips it back to current-week entry immediately -- no stale backdated submit.
  const isHistorical = loggingMode === "historical" && historicalEnabled;
  // The date actually submitted. Never the raw box value unless backdating is permitted.
  const effectiveDate = isHistorical ? occurredOn : todayISO();
  const isLoanIssue = recordType === "loan_disbursement";
  const isRepayment = recordType === "loan_repayment";
  const isFine = recordType === "fines";

  const memberOptions = useMemo(
    () => (allMembers || []).map((m) => ({
      value: m.id,
      label: `${m.name} (${m.memberId || m.phone || "Member"})`
    })),
    [allMembers]
  );

  // What the admin is shown as "falls in week N". Follows whichever rule the database will
  // apply to this row, so the confirmation and the ledger cannot disagree.
  const derivedWeek = useMemo(
    () => (weekAnchorDate
      ? getSaccoWeekOf(effectiveDate, weekAnchorDate, meetingDay)
      : meetingWeekOf(effectiveDate, meetingDay)),
    [effectiveDate, meetingDay, weekAnchorDate]
  );

  const loanOptions = useMemo(
    () => openLoans.map((l) => ({
      value: l.id,
      label: `${l.loan_number || "Loan"} — ${l.loan_type === "social_fund" ? "Social Fund" : "Normal"} · Shs ${Number(l.outstanding_balance || 0).toLocaleString()} left`
    })),
    [openLoans]
  );

  // Settings + realtime. Deliberately no dependencies: this subscribes to a WebSocket
  // channel, and the previous version listed `loggingMode`, so every toggle between
  // Current and Historical tore the channel down and built a new one.
  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch("/api/sacco-settings", {
          headers: { "Authorization": `Bearer ${session.access_token}` },
          cache: "no-store"
        });
        const data = await res.json();
        if (!res.ok || cancelled) return;

        const settingsObj = data.settings || data;
        setCurrentWeek(Number(settingsObj.currentWeek) || 1);
        if (settingsObj.meetingDay) setMeetingDay(settingsObj.meetingDay);
        setWeekAnchorDate(settingsObj.weekAnchorDate || null);
        const historicalOn = Boolean(settingsObj.isHistoricalMode);
        setHistoricalEnabled(historicalOn);

        // Open the tab the setting implies. Someone who has just switched Historical
        // Onboarding on came here to backfill, so landing on Current Week means a
        // deliberate extra click every time -- and the mistake it invites (typing a
        // past meeting's figures into a form dated today) is silent and lands in the
        // ledger.
        //
        // Keyed on the setting *changing*, not on its value, which is what lets an
        // admin switch back to Current Week for a one-off entry and stay there: this
        // runs again on every realtime settings event, and comparing against the value
        // alone would drag them back to Historical each time.
        if (lastHistoricalSetting.current !== historicalOn) {
          setLoggingMode(historicalOn ? "historical" : "current");
          // Switched off with a backdated date still in the box: that date can no longer
          // be submitted, so put it back to today rather than leave it there looking live.
          if (!historicalOn) setOccurredOn(todayISO());
          lastHistoricalSetting.current = historicalOn;
        }
      } catch (err) {
        console.warn("Failed to load settings in manual contribution:", err);
      }
    }

    loadSettings();

    const channel = supabase
      .channel("manual-log-sacco-settings-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sacco_settings" }, loadSettings)
      .on("postgres_changes", { event: "*", schema: "public", table: "saccos" }, loadSettings)
      .subscribe();

    function handleSettingsUpdate(e) {
      // Finishing historical onboarding moves the anchor, which changes every week number
      // this form shows -- and it dispatches this event with no detail. Re-read rather
      // than trying to patch state from a payload that may not be there.
      if (!e.detail) {
        loadSettings();
        return;
      }
      if (e.detail.meetingDay) setMeetingDay(e.detail.meetingDay);
      if (e.detail.currentWeek) setCurrentWeek(Number(e.detail.currentWeek));
      if ("weekAnchorDate" in e.detail) setWeekAnchorDate(e.detail.weekAnchorDate || null);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_settings_updated", handleSettingsUpdate);
    }

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_settings_updated", handleSettingsUpdate);
      }
    };
  }, []);

  // Only fetched when a repayment is actually being logged -- there is no reason to ask
  // for a member's loans while someone is typing in a shares contribution. Clearing the
  // list is done by the handlers that cause it, not here: an effect that resets state on
  // the way past is a cascading render, and the reset has a specific trigger.
  //
  // The abort matters because switching members quickly can otherwise let the first
  // member's loans arrive last and sit there under the second member's name.
  useEffect(() => {
    if (!isRepayment || !addMember) return;

    const controller = new AbortController();

    async function run() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || controller.signal.aborted) return;
        setLoansLoading(true);
        const res = await fetch(`/api/admin/manual-contribution?memberId=${encodeURIComponent(addMember)}`, {
          headers: { "Authorization": `Bearer ${session.access_token}` },
          cache: "no-store",
          signal: controller.signal
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setOpenLoans(res.ok ? (data.loans || []) : []);
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.warn("Failed to load member's open loans:", err);
        setOpenLoans([]);
      } finally {
        if (!controller.signal.aborted) setLoansLoading(false);
      }
    }

    run();

    return () => controller.abort();
  }, [isRepayment, addMember, loansRefreshKey]);

  function handleMemberChange(val) {
    setAddMember(val);
    setSelectedLoanId("");
    setOpenLoans([]);
  }

  function handleRecordTypeChange(val) {
    setRecordType(val);
    if (val !== "loan_repayment") setSelectedLoanId("");
  }

  function handleModeChange(mode) {
    if (mode === "historical" && !historicalEnabled) {
      setMessage({
        type: "error",
        text: "Historical onboarding is switched off. Turn it on in Configuration Settings to backdate records."
      });
      return;
    }
    setLoggingMode(mode);
    setMessage(null);
    // Current-week entries are dated today, which is when the admin is recording them.
    // Historical entries keep whatever date is already in the box so a run of records
    // from the same meeting can be typed without re-picking the date each time.
    if (mode === "current") setOccurredOn(todayISO());
  }

  function validate() {
    if (!addMember) return "Select the member this record belongs to.";
    if (!recordType) return "Select what kind of record this is.";
    if (!effectiveDate) return "Set the date this actually happened.";
    if (effectiveDate > todayISO()) return "That date is in the future.";
    if (effectiveDate < todayISO() && !historicalEnabled) {
      return "Historical onboarding is switched off. Turn it on in Configuration Settings to backdate records.";
    }
    const amt = Number(addAmount);
    if (!Number.isFinite(amt) || amt <= 0) return "Enter an amount greater than zero.";
    if (isFine && !fineReason.trim()) return "Say what the fine was for.";
    if (isRepayment && !selectedLoanId) return "Choose which loan this repayment was against.";
    if (isLoanIssue && (!termMonths || Number(termMonths) < 1)) return "A loan needs a term of at least one month.";
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const problem = validate();
    if (problem) {
      setMessage({ type: "error", text: problem });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");

      const res = await fetch("/api/admin/manual-contribution", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          memberId: addMember,
          category: recordType,
          amount: Number(addAmount),
          occurredOn: effectiveDate,
          fineType: isFine ? fineReason.trim() : undefined,
          loanId: isRepayment ? selectedLoanId : undefined,
          loanType: isLoanIssue ? loanType : undefined,
          termMonths: isLoanIssue ? Number(termMonths) : undefined,
          purpose: isLoanIssue ? (purpose.trim() || undefined) : undefined
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log the record");

      const memberName = memberOptions.find((m) => m.value === addMember)?.label || "Member";
      const typeLabel = recordTypeOptions.find((t) => t.value === recordType)?.label || recordType;

      setMessage({
        type: "success",
        text: `${typeLabel} of Shs ${Number(addAmount).toLocaleString()} recorded for ${formatDateLabel(effectiveDate)} (week ${data.week_number ?? derivedWeek}).`
      });

      setRecentlyLogged((prev) => [
        {
          id: data.transaction_id || `${Date.now()}`,
          member: memberName,
          type: typeLabel,
          amount: Number(addAmount),
          date: effectiveDate
        },
        ...prev
      ].slice(0, 8));

      // What makes every other component redraw. The realtime subscriptions cover the
      // database side; these cover the components that listen for an explicit signal.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
        window.dispatchEvent(new CustomEvent("manual_contribution_logged"));
      }

      // Member and date are kept: backfilling is repetitive, and a whole meeting's
      // records for one member share both.
      setAddAmount("");
      setFineReason("");
      setPurpose("");
      if (isRepayment) setLoansRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ type: "error", text: err.message || "An error occurred" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="quick-actions quick-actions-log" onSubmit={handleSubmit}>
      <div className="section-header section-header-log" style={{ marginBottom: "1.5rem" }}>
        <h3 className="section-title">
          <i className="fa-solid fa-file-invoice-dollar icon-log"></i>
          Log Contribution / Loan
        </h3>
      </div>

      <div className="toggle-container">
        <button
          type="button"
          onClick={() => handleModeChange("current")}
          className={`toggle-button ${!isHistorical ? "active" : ""}`}
        >
          Current Week ({currentWeek})
        </button>
        <button
          type="button"
          onClick={() => handleModeChange("historical")}
          disabled={!historicalEnabled}
          title={historicalEnabled
            ? "Record entries against the dates they actually happened"
            : "Switch on Historical Onboarding in Configuration Settings to enable this"}
          className={`toggle-button ${isHistorical ? "active" : ""}`}
          style={!historicalEnabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
        >
          Historical Onboarding
          {!historicalEnabled && <i className="fa-solid fa-lock" style={{ marginLeft: "0.5rem", fontSize: "1.1rem" }}></i>}
        </button>
      </div>

      {!historicalEnabled && (
        <div style={{
          padding: "0.9rem 1.1rem",
          borderRadius: "0.8rem",
          backgroundColor: "#f1f5f9",
          color: "#475569",
          fontSize: "1.15rem",
          marginBottom: "1.6rem",
          border: "0.1rem solid #e2e8f0"
        }}>
          <i className="fa-solid fa-circle-info" style={{ marginRight: "0.6rem" }}></i>
          Backfilling past records is off. Enable <strong>Historical Onboarding</strong> in
          Configuration Settings to record entries against the dates they happened.
        </div>
      )}

      {isHistorical && (
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
          Backfilling paper records. Each entry is filed on the date you give it, not today.
        </div>
      )}

      {message && (
        <div style={{
          padding: "0.9rem 1rem",
          borderRadius: "0.8rem",
          marginBottom: "1.4rem",
          background: message.type === "success" ? "#d1fae5" : "#fee2e2",
          color: message.type === "success" ? "#065f46" : "#991b1b",
          textAlign: "center",
          fontSize: "1.2rem",
          fontWeight: 600
        }}>
          {message.text}
        </div>
      )}

      <div className="admin-form-group admin-form-group-member">
        <label className="admin-label-member">Select Member</label>
        <CustomSelect
          value={addMember}
          options={memberOptions}
          onChange={handleMemberChange}
          placeholder="-- Select Member --"
        />
      </div>

      <div className="admin-form-group admin-form-group-fund">
        <label className="admin-label-fund">Record Type</label>
        <CustomSelect
          value={recordType}
          options={recordTypeOptions}
          onChange={handleRecordTypeChange}
        />
      </div>

      {isFine && (
        <div className="admin-form-group">
          <label>What was the fine for?</label>
          <input
            type="text"
            placeholder="e.g. late arrival"
            value={fineReason}
            onChange={(e) => setFineReason(e.target.value)}
          />
        </div>
      )}

      {isLoanIssue && (
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
            />
          </div>

          <div className="admin-form-group">
            <label>Purpose</label>
            <input
              type="text"
              placeholder="e.g. business expansion"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </div>
        </>
      )}

      {isRepayment && (
        <div className="admin-form-group">
          <label>Repayment Against</label>
          {loansLoading ? (
            <div style={{ fontSize: "1.2rem", color: "var(--text-light)", padding: "1rem 0" }}>
              Loading this member&apos;s loans…
            </div>
          ) : loanOptions.length > 0 ? (
            <CustomSelect
              value={selectedLoanId}
              options={loanOptions}
              onChange={(val) => setSelectedLoanId(val)}
              placeholder="-- Select Loan --"
            />
          ) : (
            <div style={{ fontSize: "1.2rem", color: "#92400e", padding: "1rem 0" }}>
              {addMember
                ? "This member has no open loan. Record the loan itself first."
                : "Select a member to see their open loans."}
            </div>
          )}
        </div>
      )}

      <div className="admin-form-group">
        <label>Date It Happened</label>
        {isHistorical ? (
          <>
            <input
              type="date"
              value={occurredOn}
              max={todayISO()}
              onChange={(e) => setOccurredOn(e.target.value)}
            />
            {occurredOn && (
              <div style={{ fontSize: "1.15rem", color: "var(--text-light)", marginTop: "0.6rem" }}>
                {formatDateLabel(occurredOn)} · falls in week {derivedWeek}
              </div>
            )}
          </>
        ) : (
          <div style={{
            padding: "1rem",
            fontSize: "1.3rem",
            fontWeight: 700,
            backgroundColor: "var(--bg-light)",
            border: "0.1rem solid var(--border-color)",
            borderRadius: "0.8rem",
            color: "var(--text-dark)"
          }}>
            Today — {formatDateLabel(effectiveDate)} (week {currentWeek})
          </div>
        )}
      </div>

      <div className="admin-form-group admin-form-group-amount">
        <label className="admin-label-amount">Amount (Shs)</label>
        <input
          type="number"
          min="1"
          placeholder="Enter amount..."
          className="admin-input-amount"
          value={addAmount}
          onChange={(e) => setAddAmount(e.target.value)}
        />
      </div>

      <button className="admin-btn-primary admin-btn-register-contribution" disabled={loading}>
        {loading ? "Logging..." : "Register Record"}
        {!loading && <i className="fa-solid fa-check-double" style={{ marginLeft: "0.5rem" }}></i>}
      </button>

      {recentlyLogged.length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <div style={{
            fontSize: "1.2rem", fontWeight: 700, color: "var(--text-light)",
            marginBottom: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05rem"
          }}>
            Added this session
          </div>
          {recentlyLogged.map((r) => (
            <div key={r.id} style={{
              display: "flex", justifyContent: "space-between", gap: "1rem",
              fontSize: "1.2rem", padding: "0.6rem 0",
              borderBottom: "0.1rem solid var(--border-color, #e2e8f0)"
            }}>
              <span style={{ color: "var(--text-dark)" }}>{r.type}</span>
              <span style={{ color: "var(--text-light)" }}>{formatDateLabel(r.date)}</span>
              <span style={{ fontWeight: 700 }}>Shs {r.amount.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
