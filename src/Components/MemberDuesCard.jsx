"use client";

import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

/**
 * Outstanding weekly mandatory funds, for the admin overview card row.
 *
 * Sits inside the existing .summary-cards grid alongside the Gross SACCO Profit card, which
 * it is modelled on -- same grid, same visual weight, no new tab and no new sidebar entry.
 *
 * It expands in place because a SACCO-wide total on its own does not tell an admin anything
 * actionable: the question behind "we are owed 420,000" is always "by whom", and that list
 * has to live somewhere. Collapsed it is a metric; opened it is the chase list, ranked worst
 * first.
 *
 * Figures are derived on every read -- see utils/duesEngine.js. Nothing here is stored, so
 * recording a missing contribution clears the row on the next load with no other action.
 */

const FUND_LABELS = {
  development_fund: "Development",
  social_fund: "Social"
};

export default function MemberDuesCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function loadDues() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch("/api/dues", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store"
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Could not load member dues.");

        setData(body);
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadDues();

    if (typeof window === "undefined") return;

    // Approving a contribution, backfilling a historical record and changing the weekly
    // amounts all move these numbers. Each already broadcasts on one of these events.
    const handleUpdate = () => loadDues();
    window.addEventListener("sacco_transaction_updated", handleUpdate);
    window.addEventListener("sacco_settings_updated", handleUpdate);
    window.addEventListener("manual_contribution_logged", handleUpdate);
    return () => {
      window.removeEventListener("sacco_transaction_updated", handleUpdate);
      window.removeEventListener("sacco_settings_updated", handleUpdate);
      window.removeEventListener("manual_contribution_logged", handleUpdate);
    };
  }, []);

  const totals = data?.totals;
  const behind = (data?.rows || []).filter((row) => row.totalOwed > 0);
  const isClear = Boolean(data) && !error && (totals?.totalOwed || 0) === 0;

  return (
    <div
      className="card card-member-dues"
      style={{
        borderLeft: `4px solid ${isClear ? "#10b981" : "#f59e0b"}`,
        background: "white",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <div className="card-header" style={{ marginBottom: "0.8rem" }}>
        <span className="card-title" style={{ fontWeight: 700, color: "var(--text-dark)", fontSize: "1.5rem" }}>
          Outstanding Fund Dues
        </span>
        <div
          className="card-icon"
          style={{
            backgroundColor: isClear ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
            color: isClear ? "#10b981" : "#f59e0b",
            width: "4rem",
            height: "4rem",
            borderRadius: "1rem"
          }}
        >
          <i className={`fa-solid ${isClear ? "fa-circle-check" : "fa-calendar-xmark"}`} style={{ fontSize: "1.8rem" }}></i>
        </div>
      </div>

      {loading && (
        <div style={{ fontSize: "1.3rem", color: "#64748b" }}>Calculating…</div>
      )}

      {error && !loading && (
        <div style={{ fontSize: "1.25rem", color: "#ef4444" }}>{error}</div>
      )}

      {!loading && !error && isClear && (
        <div style={{ fontSize: "1.3rem", color: "#059669", fontWeight: 600, marginTop: "auto" }}>
          <i className="fa-solid fa-check" style={{ marginRight: "0.6rem" }}></i>
          All members are current on weekly funds.
        </div>
      )}

      {/* `data &&` is load-bearing: with no session loadDues returns early leaving data null
          and error null, and without this guard the branch below would read totals off
          undefined. */}
      {!loading && !error && data && !isClear && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem", fontSize: "1.2rem", color: "#64748b" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><i className="fa-solid fa-seedling" style={{ color: "#10b981", marginRight: "0.4rem" }}></i> Development Fund:</span>
              <strong style={{ color: "#10b981" }}>Shs {(totals.developmentOwed || 0).toLocaleString()}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span><i className="fa-solid fa-handshake-angle" style={{ color: "#ef4444", marginRight: "0.4rem" }}></i> Social Fund:</span>
              <strong style={{ color: "#ef4444" }}>Shs {(totals.socialOwed || 0).toLocaleString()}</strong>
            </div>
          </div>

          <div style={{ marginTop: "auto", paddingTop: "0.8rem", borderTop: "1px dashed #e2e8f0" }}>
            <span style={{ fontSize: "1.1rem", textTransform: "uppercase", letterSpacing: "0.05rem", fontWeight: 800, color: "#f59e0b" }}>
              Total Owed by Members
            </span>
            <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#92400e", letterSpacing: "-0.05rem", marginTop: "0.1rem" }}>
              Shs {(totals.totalOwed || 0).toLocaleString()}
            </div>

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                background: "none",
                border: "none",
                padding: "0.6rem 0 0",
                color: "#b45309",
                fontSize: "1.2rem",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem"
              }}
            >
              <i className={`fa-solid fa-chevron-${expanded ? "up" : "down"}`}></i>
              {totals.membersBehind} {totals.membersBehind === 1 ? "member" : "members"} behind
              {expanded ? " — hide" : " — view"}
            </button>
          </div>

          {expanded && (
            <div style={{ marginTop: "1rem", borderTop: "1px solid #e2e8f0", paddingTop: "1rem", maxHeight: "26rem", overflowY: "auto" }}>
              {behind.map((row) => (
                <div
                  key={row.profileId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "1rem",
                    padding: "0.7rem 0",
                    borderBottom: "1px solid #f1f5f9"
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-dark)" }}>
                      {row.name}
                      {row.memberNumber && (
                        <span style={{ fontWeight: 500, color: "#94a3b8" }}> ({row.memberNumber})</span>
                      )}
                    </div>
                    <div style={{ fontSize: "1.15rem", color: "#64748b", marginTop: "0.15rem" }}>
                      {Object.entries(row.funds || {})
                        .filter(([, f]) => f.owed > 0)
                        .map(([fund, f]) => `${FUND_LABELS[fund] || fund} ${f.weeksBehind}w`)
                        .join(" · ")}
                    </div>
                    {/* Which of the three the figure rests on. Only a stated join date is a
                        fact; the other two are said plainly so nobody is chased for an
                        inference, and so the fix is obvious -- set their join date. */}
                    {row.startSource === "assumed" && (
                      <div style={{ fontSize: "1.1rem", color: "#b45309", marginTop: "0.15rem" }}>
                        <i className="fa-solid fa-circle-info" style={{ marginRight: "0.4rem" }}></i>
                        No records and no join date — assumed from Week 1
                      </div>
                    )}
                    {row.startSource === "first_record" && (
                      <div style={{ fontSize: "1.1rem", color: "#94a3b8", marginTop: "0.15rem" }}>
                        Counted from their first record — set a join date to be exact
                      </div>
                    )}
                  </div>

                  <strong style={{ fontSize: "1.35rem", color: "#b45309", whiteSpace: "nowrap" }}>
                    Shs {row.totalOwed.toLocaleString()}
                  </strong>
                </div>
              ))}

              {totals.assumedMembers > 0 && (
                <div style={{ fontSize: "1.15rem", color: "#64748b", marginTop: "0.8rem", lineHeight: 1.5 }}>
                  Shs {totals.assumedOwed.toLocaleString()} of this total comes from{" "}
                  {totals.assumedMembers} {totals.assumedMembers === 1 ? "member" : "members"} with
                  no records and no join date. Set their join date on the Members tab, or backfill
                  their history, to replace the assumption with real figures.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
