"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import CustomSelect from "./CustomSelect";
import "../styles/memberFines.css";

/**
 * General fines: late arrival, and whatever else a committee decides to penalise.
 *
 * Absence is NOT handled here. It belongs to WeeklyAttendanceManager, which issues its
 * fines as part of recording who turned up, and this panel filters those out on the way
 * in. The two are separate things that happen to cost money the same way -- mixing them
 * would mean an admin could fine someone for being absent without the attendance record
 * ever saying they were, and the week's numbers would stop reconciling.
 */
const PRESET_TYPES = [
  { value: "late", label: "Late arrival" },
  { value: "misconduct", label: "Misconduct" },
  { value: "loan_default", label: "Late loan repayment" },
  { value: "other", label: "Other (describe below)" }
];

const TYPE_LABELS = {
  late: "Late arrival",
  misconduct: "Misconduct",
  loan_default: "Late loan repayment",
  other: "Other",
  absenteeism: "Absence"
};

export default function MemberFinesManager({ allMembers = [] }) {
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);

  const [memberId, setMemberId] = useState("");
  const [fineType, setFineType] = useState("late");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [currentWeek, setCurrentWeek] = useState(1);
  const [defaults, setDefaults] = useState({ late: 500 });
  const [issuing, setIssuing] = useState(false);

  const memberOptions = allMembers.map((m) => ({
    value: m.id,
    label: `${m.name}${m.memberId ? ` (${m.memberId})` : ""}`
  }));

  const loadFines = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // exclude=absenteeism is what keeps the attendance engine's fines out of this list.
      const res = await fetch("/api/admin/fines?exclude=absenteeism", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store"
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Could not load fines");
      setFines(data.fines || []);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFines();

    // Asked for BY GROUP CODE, always. /api/sacco-settings is public and, called without
    // one, falls back to the most recently updated settings row in the table -- which on a
    // multi-tenant database is somebody else's. Naming the group is what makes it safe.
    //
    // This used to read saccos.current_week straight from the table. It cannot any more:
    // since migration 0030 the active week is derived from week_anchor_date so it advances
    // on its own each meeting day, and the stored column is only a cache that goes a week
    // stale between meetings. A fine stamped from it would land on the wrong week.
    async function loadSaccoDefaults() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("group_id")
          .eq("id", user.id)
          .maybeSingle();

        const groupCode = (profile?.group_id || "").trim();
        if (!groupCode) return;

        const res = await fetch(
          `/api/sacco-settings?group_code=${encodeURIComponent(groupCode)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;

        const settings = await res.json();
        setCurrentWeek(Number(settings.currentWeek) || 1);
        const late = Number(settings.lateFineAmount) || 500;
        setDefaults({ late });
        setAmount(String(late));
      } catch {
        // A missing default is not fatal -- the admin types an amount either way.
      }
    }
    loadSaccoDefaults();
  }, [loadFines]);

  // Picking a reason pre-fills its configured amount, which the admin can then override.
  // Done here rather than in an effect on fineType so the state change stays tied to the
  // interaction that caused it.
  const handleTypeChange = (next) => {
    setFineType(next);
    if (next === "late" && defaults.late) setAmount(String(defaults.late));
  };

  const handleIssue = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (!memberId) return setMessage({ type: "error", text: "Choose the member being fined." });
    if (!Number(amount) || Number(amount) <= 0) {
      return setMessage({ type: "error", text: "Enter an amount greater than zero." });
    }
    if (fineType === "other" && !note.trim()) {
      return setMessage({ type: "error", text: "Describe what the fine is for." });
    }

    setIssuing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");

      const res = await fetch("/api/admin/fines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          profileId: memberId,
          amount: Number(amount),
          fineType,
          description: note.trim()
            ? `${TYPE_LABELS[fineType] || fineType}: ${note.trim()} | Week ${currentWeek}`
            : `${TYPE_LABELS[fineType] || fineType} | Week ${currentWeek}`,
          weekNumber: currentWeek
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not issue the fine");

      setMessage({ type: "success", text: `Fine of UGX ${Number(amount).toLocaleString()} issued.` });
      setNote("");
      setMemberId("");
      await loadFines();

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sacco_transaction_updated"));
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setIssuing(false);
    }
  };

  const handleAction = async (fine, action) => {
    setBusyId(fine.id);
    setMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");

      const res = await fetch("/api/admin/fines", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ transactionId: fine.id, action })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");

      setMessage({ type: "success", text: data.message });
      await loadFines();

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sacco_transaction_updated"));
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const outstanding = fines
    .filter((f) => f.status === "pending")
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);

  const collected = fines
    .filter((f) => f.status === "completed" || f.status === "approved")
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);

  return (
    <div className="fines-card">
      <div className="fines-header">
        <div>
          <h3 className="fines-title">
            <i className="fa-solid fa-gavel"></i> Member Fines
          </h3>
          <p className="fines-subtitle">
            Late arrival and other penalties. Absence fines are issued from the attendance
            engine above and are not listed here.
          </p>
        </div>
        <div className="fines-totals">
          <div className="fines-total">
            <span className="fines-total-label">Outstanding</span>
            <strong className="fines-total-value fines-unpaid">
              UGX {outstanding.toLocaleString()}
            </strong>
          </div>
          <div className="fines-total">
            <span className="fines-total-label">Collected</span>
            <strong className="fines-total-value fines-paid">
              UGX {collected.toLocaleString()}
            </strong>
          </div>
        </div>
      </div>

      {message && (
        <div className={`fines-message fines-message-${message.type}`}>{message.text}</div>
      )}

      <form className="fines-form" onSubmit={handleIssue}>
        <div className="fines-field">
          <label>Member</label>
          <CustomSelect
            value={memberId}
            options={memberOptions}
            onChange={setMemberId}
            placeholder="Select a member..."
          />
        </div>

        <div className="fines-field">
          <label>Reason</label>
          <CustomSelect value={fineType} options={PRESET_TYPES} onChange={handleTypeChange} />
        </div>

        <div className="fines-field">
          <label htmlFor="fine-amount">Amount (UGX)</label>
          {/* min is the step base, so min="1" step="100" would make 1, 101, 201 ... the
              only valid amounts and reject every round figure a fine is actually set at.
              Both are multiples of 100 so the sequence runs 100, 200 ... 1000. */}
          <input
            id="fine-amount"
            type="number"
            min="100"
            step="100"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500"
          />
        </div>

        <div className="fines-field fines-field-wide">
          <label htmlFor="fine-note">
            Note {fineType === "other" && <span className="fines-required">required</span>}
          </label>
          <input
            id="fine-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened? This is shown to the member."
          />
        </div>

        <button type="submit" className="fines-submit" disabled={issuing}>
          {issuing ? "Issuing…" : `Issue Fine — Week ${currentWeek}`}
        </button>
      </form>

      <div className="fines-table-wrap">
        <table className="fines-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Reason</th>
              <th>Week</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="fines-empty">Loading fines…</td>
              </tr>
            ) : fines.length === 0 ? (
              <tr>
                <td colSpan={6} className="fines-empty">
                  No fines issued yet. Absence fines live in the attendance engine.
                </td>
              </tr>
            ) : (
              fines.map((fine) => {
                const paid = fine.status === "completed" || fine.status === "approved";
                const waived = fine.status === "rejected";
                return (
                  <tr key={fine.id}>
                    <td>{fine.full_name || "Member"}</td>
                    <td>{TYPE_LABELS[fine.fine_type] || fine.fine_type || "Fine"}</td>
                    <td>{fine.week_number ?? "—"}</td>
                    <td className="fines-amount">UGX {Number(fine.amount).toLocaleString()}</td>
                    <td>
                      <span
                        className={
                          paid ? "fines-badge fines-badge-paid"
                            : waived ? "fines-badge fines-badge-waived"
                              : "fines-badge fines-badge-unpaid"
                        }
                      >
                        {paid ? "Paid" : waived ? "Waived" : "Unpaid"}
                      </span>
                    </td>
                    <td>
                      {paid || waived ? (
                        <span className="fines-done">—</span>
                      ) : (
                        <div className="fines-actions">
                          <button
                            type="button"
                            className="fines-btn fines-btn-collect"
                            disabled={busyId === fine.id}
                            onClick={() => handleAction(fine, "collect")}
                          >
                            {busyId === fine.id ? "…" : "Mark Paid"}
                          </button>
                          <button
                            type="button"
                            className="fines-btn fines-btn-waive"
                            disabled={busyId === fine.id}
                            onClick={() => handleAction(fine, "waive")}
                          >
                            Waive
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
