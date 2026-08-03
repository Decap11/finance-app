"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabaseClient";
import "../styles/loanAdmin.css";

/**
 * Admin view of loan applications waiting on their fee, and the control that applies
 * late charges to overdue loans.
 *
 * Approving the disbursement itself is not here -- that is a `loan_disbursement`
 * transaction and belongs to the Contribution Approvals queue, where it already lives.
 * This panel covers the two steps that queue has no concept of: the application fee that
 * gates the request, and the monthly charge for running past the due date.
 */
export default function LoanApplicationsManager() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [sweeping, setSweeping] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("group_id")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile?.group_id) return;

      const { data: sacco } = await supabase
        .from("saccos")
        .select("id")
        .ilike("group_code", profile.group_id.trim())
        .limit(1)
        .maybeSingle();

      if (!sacco) return;

      const { data, error } = await supabase
        .from("loans")
        .select("id, loan_number, profile_id, amount_requested, total_repayable, term_months, purpose, status, application_fee, due_date, outstanding_balance, late_fee_months_charged, requested_at, borrower:profiles!profile_id(full_name, member_number)")
        .eq("sacco_id", sacco.id)
        .in("status", ["pending_fee", "pending_guarantors", "overdue"])
        .order("requested_at", { ascending: false });

      if (error) throw new Error(error.message);
      setLoans(data || []);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    const channel = supabase
      .channel("loan-admin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "loans" }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const confirmFee = async (loanId) => {
    setBusyId(loanId);
    setMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");

      const res = await fetch("/api/loans", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ action: "confirm_fee", loanId })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not confirm the fee");

      setMessage({ type: "success", text: data.message });
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const applyLateFees = async () => {
    setSweeping(true);
    setMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");

      const res = await fetch("/api/loans", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ action: "apply_late_fees" })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not apply late charges");

      setMessage({ type: "success", text: data.message });
      await load();

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sacco_transaction_updated"));
      }
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSweeping(false);
    }
  };

  const awaitingFee = loans.filter((l) => l.status === "pending_fee");
  const overdue = loans.filter((l) => l.status === "overdue");

  const statusLabel = {
    pending_fee: "Awaiting fee",
    pending_guarantors: "With guarantors",
    overdue: "Overdue"
  };

  return (
    <div className="loan-admin-card">
      <div className="loan-admin-header">
        <div>
          <h3 className="loan-admin-title">
            <i className="fa-solid fa-file-invoice-dollar"></i> Loan Applications
          </h3>
          <p className="loan-admin-subtitle">
            Confirm application fees and apply late charges. Approving the disbursement
            itself stays in the approvals queue.
          </p>
        </div>
        <button
          type="button"
          className="loan-admin-sweep"
          onClick={applyLateFees}
          disabled={sweeping}
          title="Charge every loan that has run a whole month past its due date"
        >
          {sweeping ? "Applying…" : "Apply late charges"}
        </button>
      </div>

      {message && (
        <div className={`loan-admin-message loan-admin-message-${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="loan-admin-counts">
        <div>
          <span>Awaiting fee</span>
          <strong>{awaitingFee.length}</strong>
        </div>
        <div>
          <span>Overdue</span>
          <strong className={overdue.length > 0 ? "loan-admin-bad" : ""}>{overdue.length}</strong>
        </div>
      </div>

      <div className="loan-admin-table-wrap">
        <table className="loan-admin-table">
          <thead>
            <tr>
              <th>Loan No.</th>
              <th>Member</th>
              <th>Requested</th>
              <th>Term</th>
              <th>Status</th>
              <th>Due</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="loan-admin-empty">Loading applications…</td></tr>
            ) : loans.length === 0 ? (
              <tr><td colSpan={7} className="loan-admin-empty">No applications need attention.</td></tr>
            ) : (
              loans.map((loan) => (
                <tr key={loan.id}>
                  <td className="loan-admin-number">{loan.loan_number || "—"}</td>
                  <td>
                    <strong>{loan.borrower?.full_name || "Member"}</strong>
                    <div className="loan-admin-sub">{loan.borrower?.member_number || "—"}</div>
                  </td>
                  <td>
                    Shs {Number(loan.amount_requested || 0).toLocaleString()}
                    <div className="loan-admin-sub">{loan.purpose || "—"}</div>
                  </td>
                  <td>{loan.term_months ? `${loan.term_months} mo` : "—"}</td>
                  <td>
                    <span className={`loan-admin-badge badge-${loan.status}`}>
                      {statusLabel[loan.status] || loan.status}
                    </span>
                  </td>
                  <td>
                    {loan.due_date
                      ? new Date(loan.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                      : "—"}
                    {loan.status === "overdue" && loan.late_fee_months_charged > 0 && (
                      <div className="loan-admin-sub">
                        {loan.late_fee_months_charged} charge(s) applied
                      </div>
                    )}
                  </td>
                  <td>
                    {loan.status === "pending_fee" ? (
                      <button
                        type="button"
                        className="loan-admin-btn"
                        disabled={busyId === loan.id}
                        onClick={() => confirmFee(loan.id)}
                      >
                        {busyId === loan.id
                          ? "…"
                          : `Confirm Shs ${Number(loan.application_fee || 0).toLocaleString()}`}
                      </button>
                    ) : (
                      <span className="loan-admin-sub">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
