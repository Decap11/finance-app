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

const FUND_COLORS = {
  development_fund: "#10b981",
  social_fund: "#ef4444"
};

/** "Wed 8 Jul" -- short, because it sits at the end of a line that already names the week. */
function meetingLabel(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC"
  });
}

export default function MemberDuesCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  // Which member's week-by-week breakdown is open. One at a time: this list is a chase
  // list, and the admin is dealing with one person's cash at a time.
  const [detailFor, setDetailFor] = useState(null);
  // Weeks ticked for settlement, keyed `${profileId}:${fund}:${week}` so a stale tick from
  // one member cannot follow the admin to the next.
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  // Bumped after a payment is registered, to re-read the figures that payment just moved.
  // A counter rather than hoisting the fetch out of the effect: keeping the whole read
  // inside is what stops it being a setState called synchronously from an effect body,
  // which is the same reason manualContributionlog.jsx carries a duesRefreshKey.
  const [refreshKey, setRefreshKey] = useState(0);

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
  }, [refreshKey]);

  const totals = data?.totals;
  const behind = (data?.rows || []).filter((row) => row.totalOwed > 0);
  const isClear = Boolean(data) && !error && (totals?.totalOwed || 0) === 0;

  function toggleDetail(profileId) {
    setNotice(null);
    setDetailFor((current) => (current === profileId ? null : profileId));
  }

  function togglePick(key) {
    setPicked((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  /** The weeks ticked for one member and one fund, oldest first. */
  function pickedWeeks(profileId, fund) {
    return Object.entries(picked)
      .filter(([key, on]) => on && key.startsWith(`${profileId}:${fund}:`))
      .map(([key]) => Number(key.split(":")[2]))
      .filter((w) => Number.isInteger(w))
      .sort((a, b) => a - b);
  }

  /**
   * Banks the cash against the weeks it clears.
   *
   * One fund per call, which is what the RPC takes: a settlement is money for a named
   * obligation, and letting one button write into two funds would make a partial failure
   * impossible to describe.
   */
  async function registerPayment(member, fund) {
    const weeks = pickedWeeks(member.profileId, fund);
    if (weeks.length === 0) return;

    setBusy(true);
    setNotice(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");

      const res = await fetch("/api/dues", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ memberId: member.profileId, category: fund, weeks })
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not register the payment.");

      const settled = Number(body.settled_weeks) || 0;
      setNotice({
        ok: true,
        text: `Registered Shs ${Number(body.total || 0).toLocaleString()} for ${member.name} — `
          + `${settled} ${settled === 1 ? "week" : "weeks"} of ${FUND_LABELS[fund]} fund.`
          + (body.skipped > 0
            ? ` ${body.skipped} was already settled and was not charged again.`
            : "")
      });

      // Drop only this member's ticks; an admin working down the list keeps their place.
      setPicked((prev) => Object.fromEntries(
        Object.entries(prev).filter(([key]) => !key.startsWith(`${member.profileId}:`))
      ));

      setRefreshKey((k) => k + 1);

      // The member's own banner and every other money surface read these.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
        window.dispatchEvent(new CustomEvent("manual_contribution_logged"));
      }
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

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
              {notice && (
                <div style={{
                  padding: "0.9rem 1.1rem",
                  borderRadius: "0.8rem",
                  marginBottom: "1rem",
                  fontSize: "1.2rem",
                  fontWeight: 600,
                  lineHeight: 1.5,
                  background: notice.ok ? "#f0fdf4" : "#fef2f2",
                  color: notice.ok ? "#15803d" : "#b91c1c",
                  border: `1px solid ${notice.ok ? "#bbf7d0" : "#fecaca"}`
                }}>
                  <i
                    className={`fa-solid ${notice.ok ? "fa-circle-check" : "fa-triangle-exclamation"}`}
                    style={{ marginRight: "0.6rem" }}
                  ></i>
                  {notice.text}
                </div>
              )}

              {behind.map((row) => {
                const open = detailFor === row.profileId;
                // Grouped by fund because that is how the money is received and how it is
                // registered -- one obligation at a time.
                const byFund = (row.outstandingWeeks || []).reduce((acc, w) => {
                  (acc[w.fund] = acc[w.fund] || []).push(w);
                  return acc;
                }, {});

                return (
                  <div key={row.profileId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <button
                      type="button"
                      onClick={() => toggleDetail(row.profileId)}
                      style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "1rem",
                        padding: "0.7rem 0",
                        background: "none",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: "inherit"
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-dark)" }}>
                          <i
                            className={`fa-solid fa-chevron-${open ? "down" : "right"}`}
                            style={{ marginRight: "0.6rem", fontSize: "1rem", color: "#94a3b8" }}
                          ></i>
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
                    </button>

                    {open && (
                      <div style={{ padding: "0.2rem 0 1.2rem 1.8rem" }}>
                        {Object.keys(byFund).length === 0 && (
                          <div style={{ fontSize: "1.15rem", color: "#64748b" }}>
                            Nothing to register — this member is behind on a fund with no weekly
                            amount set.
                          </div>
                        )}

                        {Object.entries(byFund).map(([fund, weeks]) => {
                          const chosen = pickedWeeks(row.profileId, fund);
                          const due = chosen.reduce((sum, week) => {
                            const entry = weeks.find((w) => w.weekNumber === week);
                            return sum + (entry ? entry.shortfall : 0);
                          }, 0);

                          return (
                            <div key={fund} style={{ marginBottom: "1.4rem" }}>
                              <div style={{
                                fontSize: "1.15rem",
                                fontWeight: 800,
                                color: FUND_COLORS[fund] || "#334155",
                                textTransform: "uppercase",
                                letterSpacing: "0.04rem",
                                marginBottom: "0.5rem"
                              }}>
                                {FUND_LABELS[fund] || fund} fund — {weeks.length}{" "}
                                {weeks.length === 1 ? "week" : "weeks"} outstanding
                              </div>

                              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                                {weeks.map((w) => {
                                  // weekNumber is null for a SACCO that has never set a week
                                  // anchor. The week is still real and still shown, but it
                                  // cannot be settled by number, so it is not selectable.
                                  const settleable = Number.isInteger(w.weekNumber);
                                  const key = `${row.profileId}:${fund}:${w.weekNumber}`;
                                  const on = Boolean(picked[key]);

                                  return (
                                    <label
                                      key={`${fund}-${w.meetingDate}`}
                                      title={settleable
                                        ? undefined
                                        : "This SACCO has no week anchor, so weeks cannot be settled by number."}
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.5rem",
                                        padding: "0.5rem 0.9rem",
                                        borderRadius: "0.7rem",
                                        fontSize: "1.15rem",
                                        fontWeight: 600,
                                        cursor: settleable ? "pointer" : "not-allowed",
                                        opacity: settleable ? 1 : 0.55,
                                        background: on ? "#ecfdf5" : "#fffbeb",
                                        border: `1px solid ${on ? "#6ee7b7" : "#fde68a"}`,
                                        color: on ? "#047857" : "#92400e"
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        disabled={!settleable || busy}
                                        onChange={() => togglePick(key)}
                                        style={{ cursor: settleable ? "pointer" : "not-allowed" }}
                                      />
                                      <span>
                                        {settleable ? `Week ${w.weekNumber}` : "Week —"}
                                        <span style={{ fontWeight: 500, opacity: 0.75 }}>
                                          {" · "}{meetingLabel(w.meetingDate)}
                                        </span>
                                      </span>
                                      <strong>Shs {w.shortfall.toLocaleString()}</strong>
                                      {w.status === "partial" && (
                                        <span style={{ fontWeight: 500, fontSize: "1.05rem" }}>
                                          (part paid)
                                        </span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>

                              <button
                                type="button"
                                disabled={busy || chosen.length === 0}
                                onClick={() => registerPayment(row, fund)}
                                style={{
                                  marginTop: "0.8rem",
                                  padding: "0.7rem 1.4rem",
                                  borderRadius: "0.7rem",
                                  border: "none",
                                  fontSize: "1.2rem",
                                  fontWeight: 700,
                                  fontFamily: "inherit",
                                  color: "#ffffff",
                                  background: chosen.length === 0 ? "#cbd5e1" : "var(--primary-color, #253b8e)",
                                  cursor: busy || chosen.length === 0 ? "not-allowed" : "pointer"
                                }}
                              >
                                {busy
                                  ? "Registering…"
                                  : chosen.length === 0
                                    ? "Select the weeks paid for"
                                    : `Register Shs ${due.toLocaleString()} received`}
                              </button>
                            </div>
                          );
                        })}

                        <div style={{ fontSize: "1.1rem", color: "#94a3b8", lineHeight: 1.5 }}>
                          Registering files the money against the weeks you tick, dated today.
                          The member&apos;s history then shows those weeks as settled late rather
                          than never paid.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

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
