"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { subscribeToOwnSaccoSettings } from "../utils/realtimeScope";
import CustomSelect from "./CustomSelect";
import { exportWeeklyReportPDF } from "../utils/pdfExportUtils";
import { getActiveWeek, WEEKS_PER_CYCLE } from "../utils/meetingDateUtils";
import { DEFAULT_SHARE_PRICE, shareCountOf } from "../utils/sharePricing";
import "../styles/saccoSettings.css";

/**
 * Which SACCO week a ledger row belongs to.
 *
 * Extracted rather than repeated: the contributions table, the loans-issued table and the
 * repayments table all report on "this week", and if any of them attributed a row by a
 * different rule the same meeting would produce two figures that cannot be reconciled --
 * a disbursement filed under Week 12 on one page and Week 11 on the next.
 *
 * Precedence: the stamped column (migration 0021/0028 write it), then the `| Week N`
 * suffix the contribution API has always put in the description, then a fall back to the
 * position of the date within its own month for rows that predate both.
 */
function weekNumberOf(tx) {
  let txWeek = Number(tx.week_number) || Number(tx.week);

  if (!txWeek && tx.description) {
    const match = tx.description.match(/\|\s*Week\s*(\d+)/i);
    if (match) txWeek = parseInt(match[1], 10);
  }

  if (!txWeek && tx.created_at) {
    txWeek = Math.ceil(new Date(tx.created_at).getDate() / 7);
  }

  return Number(txWeek) || 0;
}

/** "12 Aug 2026" -- how a ledger date is printed in the lending tables. */
function formatLedgerDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "Wed 4 Jun 2025" -- how the anchor is shown next to the week number. */
function formatAnchor(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC"
  });
}

export default function SaccoSettings() {
  const [settings, setSettings] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("sacco_settings_cache");
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          // A corrupt cache is not an error worth reporting: this is a display-time
          // shortcut, the defaults below are correct, and the authoritative figures arrive
          // from /api/sacco-settings moments later. Falling through is the whole plan.
        }
      }
    }
    return {
      sharePrice: DEFAULT_SHARE_PRICE,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      meetingDay: "Wednesday",
      isLocked: false,
    };
  });

  const [allMembers, setAllMembers] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  // The loan records themselves, for the reference number, type and purpose that the
  // ledger row only carries as prose.
  const [allLoans, setAllLoans] = useState([]);

  // Filter Period states
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterWeek, setFilterWeek] = useState(1);

  // The aggregated report is NOT state. Every figure in it is a pure function of the loaded
  // members, transactions and loans and the selected week -- it was being recomputed in an
  // effect and written back with four setState calls, which is a second render pass per
  // change and one where the table briefly disagreed with the week selector above it. It is
  // a useMemo further down instead, and these are its empty values.
  //
  // Absence fines and every other fine are reported in their own columns -- they are
  // separate offences and a single "fines" figure would hide which is which.
  const EMPTY_TOTALS = {
    shares: 0,
    devt: 0,
    social: 0,
    absent: 0,
    fines: 0,
    grandTotal: 0,
  };

  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [message, setMessage] = useState("");
  const [saccoInfo, setSaccoInfo] = useState(null);
  const [cycleBusy, setCycleBusy] = useState(false);

  // A SACCO that has finished historical onboarding counts its weeks from an anchor date
  // (migration 0030) and the number is derived on every read, so it advances by itself.
  // Until then "Active Week Number" is the typed field it has always been.
  const isAnchored = Boolean(settings.weekAnchorDate);

  // Load Sacco configuration and live records cleanly
  async function loadDatabaseData() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const token = session?.access_token;
      // Attached unconditionally. There used to be a `token.length < 3000` guard here, from
      // when /api/sacco-settings answered unauthenticated reads: an oversized JWT quietly
      // dropped the header and the fetch still worked. The endpoint now returns 401 without
      // it, so the guard would have blanked this screen for exactly the accounts carrying
      // the most metadata -- and silently, since the fetch is wrapped below.
      const headers = token ? { "Authorization": `Bearer ${token}` } : {};

      const { data: profileData } = await supabase
        .from("profiles")
        .select("group_id")
        .eq("id", user.id)
        .single();

      let sacco = null;
      const cleanGroupCode = (profileData?.group_id || '').trim();
      if (cleanGroupCode) {
        const { data: saccoRows } = await supabase
          .from("saccos")
          .select("*")
          .ilike("group_code", cleanGroupCode)
          .limit(1);
        if (saccoRows && saccoRows.length > 0) {
          sacco = saccoRows[0];
        }
      }

      if (!sacco) {
        const { data: adminRows } = await supabase
          .from("saccos")
          .select("*")
          .eq("admin_profile_id", user.id)
          .limit(1);
        if (adminRows && adminRows.length > 0) {
          sacco = adminRows[0];
        }
      }

      if (sacco) {
        setSaccoInfo(sacco);
      }

      const effectiveGroupCode = (sacco?.group_code || cleanGroupCode || '').trim();

      // 1. Direct Supabase query on sacco_settings table
      if (effectiveGroupCode) {
        try {
          const { data: directSetting } = await supabase
            .from("sacco_settings")
            .select("*")
            .ilike("group_code", effectiveGroupCode)
            .maybeSingle();

          if (directSetting) {
            // This read is the fast path for first paint; /api/sacco-settings below is
            // the authority. Derive the week here too rather than trusting the stored
            // column -- that column is a cache, and between meetings it is a week behind.
            const meetingDay = directSetting.meeting_day || "Wednesday";
            const anchor = directSetting.week_anchor_date || null;
            const derivedWeek = anchor ? getActiveWeek(anchor, meetingDay) : null;

            const formatted = {
              sharePrice: Number(directSetting.share_price) || DEFAULT_SHARE_PRICE,
              devtFund: Number(directSetting.devt_fund) || 1000,
              socialFund: Number(directSetting.social_fund) || 2000,
              currentWeek: derivedWeek || Number(directSetting.current_week) || 1,
              meetingDay,
              isLocked: Boolean(directSetting.is_locked),
              isHistoricalMode: Boolean(directSetting.is_historical_mode),
              weekAnchorDate: anchor,
              isCycleComplete: Boolean(anchor) && (derivedWeek || 0) >= WEEKS_PER_CYCLE,
              groupCode: directSetting.group_code
            };
            setSettings(formatted);
            setFilterWeek(formatted.currentWeek || 1);
            if (typeof window !== "undefined") {
              localStorage.setItem("sacco_settings_cache", JSON.stringify(formatted));
            }
          }
        } catch {
          // ignore
        }
      }

      // 2. Fetch live active settings from /api/sacco-settings (queries sacco_settings table first)
      const apiUrl = effectiveGroupCode ? `/api/sacco-settings?group_code=${encodeURIComponent(effectiveGroupCode)}` : "/api/sacco-settings";
      const settingsRes = await fetch(apiUrl, { headers, cache: "no-store" });
      const settingsData = await settingsRes.json();

      if (settingsRes.ok && settingsData && settingsData.sharePrice !== undefined) {
        setSettings(settingsData);
        setFilterWeek(settingsData.currentWeek || 1);
        if (typeof window !== "undefined") {
          localStorage.setItem("sacco_settings_cache", JSON.stringify(settingsData));
        }
      }

      if (sacco) {
        // Parallelize profile list, transaction list and loan lookups
        const [profilesRes, txsRes, loansRes] = await Promise.all([
          supabase.from("profiles").select("*").ilike("group_id", sacco.group_code || cleanGroupCode),
          supabase.from("transactions").select("*").eq("sacco_id", sacco.id).in("status", ["approved", "completed", "pending"]),
          // Every loan, not only the open ones: a loan issued in the reported week may
          // already have been repaid in full by the time the report is run, and leaving it
          // out would make that week's lending look smaller than it was.
          supabase.from("loans").select("*").eq("sacco_id", sacco.id)
        ]);

        if (profilesRes.data) {
          setAllMembers(
            profilesRes.data.map((m) => ({
              id: m.id,
              name: m.full_name || "Unknown",
              memberId: m.member_number || "N/A",
            }))
          );
        }

        if (txsRes.data) {
          setAllTransactions(txsRes.data);
        }

        // A database that has not had the loan migrations applied answers with an error
        // rather than rows. The lending page then reports nothing for the week, which is
        // the right degradation -- it must not take the contributions report down with it.
        if (loansRes.data) {
          setAllLoans(loansRes.data);
        } else if (loansRes.error) {
          console.warn("Loan lookup for the weekly report failed:", loansRes.error.message);
        }
      }
    } catch (err) {
      console.warn("Failed to load database settings data:", err);
    } finally {
      setLoadingSettings(false);
      setLoadingData(false);
    }
  }

  useEffect(() => {
    // Deferred past the current render rather than called inside it. loadDatabaseData stays
    // outside the effect because the settings form awaits it after a successful save; the
    // compiler cannot see that its setState calls all sit behind an await, so calling it
    // from an effect body reads as a cascading render.
    const initial = setTimeout(loadDatabaseData, 0);

    // Realtime WebSocket listener for SACCO Settings updates
    // This SACCO's own configuration row.
    const unsubscribe = subscribeToOwnSaccoSettings(
      () => loadDatabaseData(),
      'sacco-settings'
    );

    return () => {
      clearTimeout(initial);
      unsubscribe();
    };
  }, []);

  // Compute Weekly Table and overall totals dynamically
  const { reportRows, reportTotals, loanRows, repaymentRows } = useMemo(() => {
    if (allMembers.length === 0) {
      return { reportRows: [], reportTotals: EMPTY_TOTALS, loanRows: [], repaymentRows: [] };
    }

    // The one week test, shared by the contributions rows and both lending tables below.
    const inSelectedWeek = (tx) => {
      if (weekNumberOf(tx) !== Number(filterWeek)) return false;
      return new Date(tx.created_at).getFullYear() === Number(filterYear);
    };

    const rows = allMembers.map((member) => {
      // Find matching transactions for the selected week & year
      const memberTxs = allTransactions.filter((tx) => {
        if (tx.profile_id !== member.id) return false;
        return inSelectedWeek(tx);
      });

      let sharesAmt = 0;
      let sharesQty = 0;
      let devtAmt = 0;
      let socialAmt = 0;
      // Absence and every other fine are counted apart. They are both money owed for
      // breaking a rule, but "was this member here?" and "what else did they do?" are
      // different questions and the report answers them in different columns.
      let absentAmt = 0;
      let finesAmt = 0;

      memberTxs.forEach((tx) => {
        const amt = Number(tx.amount) || 0;
        // Normalize legacy/alias category spellings before bucketing
        let catNorm = (tx.category || "").toLowerCase();
        if (catNorm === "fine" || catNorm === "penalty" || catNorm === "absenteeism") catNorm = "fines";
        if (catNorm === "devt") catNorm = "development_fund";
        if (catNorm === "social") catNorm = "social_fund";

        if (catNorm === "shares") {
          sharesAmt += amt;
          // The count as recorded on the row, not `amt / today's price`. Dividing meant
          // that changing the share price in the form above silently rewrote how many
          // shares every member had ever bought, in this report and everywhere else.
          sharesQty += shareCountOf(tx, settings.sharePrice);
        } else if (catNorm === "development_fund") {
          devtAmt += amt;
        } else if (catNorm === "social_fund") {
          socialAmt += amt;
        } else if (catNorm === "fines") {
          if ((tx.fine_type || "absenteeism") === "absenteeism") {
            absentAmt += amt;
          } else {
            finesAmt += amt;
          }
        }
      });

      const rowTotal = sharesAmt + devtAmt + socialAmt + absentAmt + finesAmt;

      return {
        memberId: member.memberId,
        name: member.name,
        sharesQty,
        sharesAmt,
        devtAmt,
        socialAmt,
        absentAmt,
        finesAmt,
        rowTotal,
      };
    });

    let totalShares = 0;
    let totalDev = 0;
    let totalSocial = 0;
    let totalAbsent = 0;
    let totalFines = 0;
    let grandTotal = 0;

    rows.forEach((r) => {
      totalShares += r.sharesAmt;
      totalDev += r.devtAmt;
      totalSocial += r.socialAmt;
      totalAbsent += r.absentAmt;
      totalFines += r.finesAmt;
      grandTotal += r.rowTotal;
    });

    const totals = {
      shares: totalShares,
      devt: totalDev,
      social: totalSocial,
      absent: totalAbsent,
      fines: totalFines,
      grandTotal,
    };

    // ---- Lending activity for the same week -------------------------------------------
    //
    // Read off the ledger rather than off `loans.disbursed_at`, for two reasons: the ledger
    // is what the contributions table above reports from, so both pages agree by
    // construction; and a loan carries one disbursement but many repayments, which only the
    // transactions have a row each for.
    const membersById = new Map(allMembers.map((m) => [m.id, m]));
    const loansById = new Map(allLoans.map((l) => [l.id, l]));

    const nameFor = (tx) => membersById.get(tx.profile_id)?.name || tx.full_name || "Unknown";
    const memberIdFor = (tx) => membersById.get(tx.profile_id)?.memberId || "N/A";
    const loanFor = (tx) => (tx.loan_id ? loansById.get(tx.loan_id) : null);

    const lendingTxs = allTransactions.filter(inSelectedWeek);

    const issued = lendingTxs
      .filter((tx) => (tx.category || "").toLowerCase() === "loan_disbursement")
      .map((tx) => {
        const loan = loanFor(tx);
        return {
          memberId: memberIdFor(tx),
          name: nameFor(tx),
          loanRef: loan?.loan_number || "-",
          loanType: loan?.loan_type === "social_fund" ? "Social Fund" : "Normal",
          purpose: loan?.purpose || tx.description || "-",
          amount: Number(tx.amount) || 0,
          status: (tx.status || "").toUpperCase(),
          date: formatLedgerDate(tx.created_at),
        };
      })
      .sort((a, b) => b.amount - a.amount);

    const repaid = lendingTxs
      .filter((tx) => (tx.category || "").toLowerCase() === "loan_repayment")
      .map((tx) => {
        const loan = loanFor(tx);
        return {
          memberId: memberIdFor(tx),
          name: nameFor(tx),
          loanRef: loan?.loan_number || "-",
          amount: Number(tx.amount) || 0,
          // Today's balance on that loan, not the balance immediately after this
          // installment -- nothing stores the latter. The PDF column says "Balance Now".
          outstanding: loan ? Number(loan.outstanding_balance) || 0 : null,
          status: (tx.status || "").toUpperCase(),
          date: formatLedgerDate(tx.created_at),
        };
      })
      .sort((a, b) => b.amount - a.amount);

    return { reportRows: rows, reportTotals: totals, loanRows: issued, repaymentRows: repaid };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- EMPTY_TOTALS is a constant shape
  }, [allMembers, allTransactions, allLoans, filterYear, filterMonth, filterWeek, settings.sharePrice]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setMessage("Saving settings...");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Authentication session not found.");

      const token = session.access_token;
      const headers = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      // 1. Direct Supabase update using logged-in Admin client
      //
      // current_week is omitted once the SACCO is anchored. The field is read-only in that
      // state and the number here is only what was last rendered into it, so writing it
      // back would pin the cache to a value that goes stale the moment the week rolls over.
      // finalize_historical_onboarding and start_new_sacco_cycle are the only things that
      // may move it.
      const updatePayload = {
        share_price: Number(settings.sharePrice),
        devt_fund: Number(settings.devtFund),
        social_fund: Number(settings.socialFund),
        ...(isAnchored ? {} : { current_week: Number(settings.currentWeek) }),
        meeting_day: (settings.meetingDay || "Wednesday").trim(),
        is_locked: Boolean(settings.isLocked),
        updated_at: new Date().toISOString()
      };

      const targetGroupCode = (saccoInfo?.group_code || "").trim().toUpperCase();
      if (targetGroupCode) {
        try {
          await supabase.from("sacco_settings").upsert({
            group_code: targetGroupCode,
            sacco_id: saccoInfo?.id || null,
            ...updatePayload
          }, { onConflict: "group_code" });
        } catch (e) {
          console.warn("sacco_settings direct upsert warning:", e);
        }
      }

      if (saccoInfo?.id) {
        try {
          const { meeting_day, ...saccoUpdatePayload } = updatePayload;
          await supabase.from('saccos').update(saccoUpdatePayload).eq('id', saccoInfo.id);
        } catch (e) {
          console.warn("saccos update warning:", e);
        }
      }

      // 2. Call API route as backup
      const res = await fetch("/api/sacco-settings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...settings,
          groupCode: targetGroupCode || saccoInfo?.group_code
        }),
      });

      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }

      if (!res.ok && data.error) {
        throw new Error(data.error);
      }

      if (data.dbWarning) {
        console.warn("DB Warning from /api/sacco-settings:", data.dbWarning);
      }

      setMessage("Settings saved successfully!");
      const updatedConf = data.settings || settings;
      setSettings(updatedConf);
      if (typeof window !== "undefined") {
        localStorage.setItem("sacco_settings_cache", JSON.stringify(updatedConf));
        window.dispatchEvent(new CustomEvent("sacco_settings_updated", { detail: updatedConf }));
      }
      setTimeout(() => setMessage(""), 4000);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  /**
   * Ends a backfill, or starts a fresh cycle. Both go through the same RPC route because
   * both do the same thing underneath: move the anchor and let every week number follow.
   *
   * "finish" rewrites the week number on every transaction and attendance register in the
   * SACCO, so it asks first. There is no undo short of running it again.
   */
  async function handleCycleAction(action) {
    const confirmText = action === "start_new_cycle"
      ? "Start a new 52-week cycle? This week's meeting becomes Week 1. Past records keep the week numbers of the cycle they happened in."
      : "Finish historical onboarding?\n\nYour oldest record becomes Week 1, and every transaction and attendance register in this SACCO is renumbered to count from it. Historical Onboarding Mode will be switched off.";

    if (typeof window !== "undefined" && !window.confirm(confirmText)) return;

    setCycleBusy(true);
    setMessage(action === "start_new_cycle" ? "Starting a new cycle..." : "Finishing historical onboarding...");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Authentication session not found.");

      const res = await fetch("/api/admin/finalize-onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ action, saccoId: saccoInfo?.id || null })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update the week cycle.");

      let summary = action === "start_new_cycle"
        ? `New cycle started. Week 1 is ${formatAnchor(data.anchor_date)}.`
        : `Historical onboarding complete. Week 1 is ${formatAnchor(data.anchor_date)}; this is now Week ${data.active_week}. ${data.transactions_restamped} record(s) and ${data.attendance_restamped} attendance register(s) renumbered.`;

      // Finishing the backfill is the moment the arrears become knowable: the anchor is set,
      // so every member's weekly development and social fund obligation can finally be
      // counted from a real Week 1. Reporting it here means the gaps are named while the
      // admin is still on the screen that created them, rather than being noticed later.
      if (action !== "start_new_cycle") {
        try {
          const duesRes = await fetch("/api/dues", {
            headers: { "Authorization": `Bearer ${session.access_token}` },
            cache: "no-store"
          });
          if (duesRes.ok) {
            const dues = await duesRes.json();
            const behind = dues?.totals?.membersBehind || 0;
            summary += behind > 0
              ? ` ${behind} member(s) are behind on mandatory weekly funds — Shs ${(dues.totals.totalOwed || 0).toLocaleString()} outstanding.`
              : " All members are current on mandatory weekly funds.";
          }
        } catch {
          // A missing summary line is not a failed finalize. The renumbering already happened.
        }
      }

      setMessage(summary);

      // The anchor changed, so every derived number on this screen is stale. Re-read rather
      // than patching state, and tell the rest of the app to do the same.
      await loadDatabaseData();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_settings_updated"));
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
      }
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setCycleBusy(false);
    }
  }

  const handlePrintReport = () => {
    window.print();
  };

  const handleExportPDF = () => {
    if (reportRows.length === 0) return;
    exportWeeklyReportPDF({
      saccoInfo,
      filterWeek,
      reportRows,
      reportTotals,
      meetingDay: settings.meetingDay || "Wednesday",
      loanRows,
      repaymentRows
    });
  };

  const getMonthName = (mIndex) => {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    return months[mIndex];
  };

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const yearOptions = [
    { value: 2025, label: "2025" },
    { value: 2026, label: "2026" },
    { value: 2027, label: "2027" },
  ];

  const monthOptions = [
    { value: 0, label: "January" },
    { value: 1, label: "February" },
    { value: 2, label: "March" },
    { value: 3, label: "April" },
    { value: 4, label: "May" },
    { value: 5, label: "June" },
    { value: 6, label: "July" },
    { value: 7, label: "August" },
    { value: 8, label: "September" },
    { value: 9, label: "October" },
    { value: 10, label: "November" },
    { value: 11, label: "December" },
  ];

  const weekOptions = Array.from(
    { length: Math.max(52, settings.currentWeek) },
    (_, i) => i + 1
  ).map((w) => ({
    value: w,
    label: `Week ${w}${w === settings.currentWeek ? " (Active)" : ""}`,
  }));

  return (
    <div className="sacco-settings-container">
      {/* 1. Sacco Group Settings Form */}
      <form onSubmit={handleSave} className="sacco-settings-card no-print">
        <h3 className="settings-title">Configure Group settings</h3>
        <p className="settings-subtitle">Manage share valuations, weekly period submission windows, and rules.</p>

        {message && <div className="settings-message">{message}</div>}

        <div className="settings-grid">
          <div className="form-group">
            <label htmlFor="sharePrice">Share Price (Shs)</label>
            <input
              type="number"
              id="sharePrice"
              name="sharePrice"
              value={settings.sharePrice}
              onChange={handleChange}
              placeholder="e.g. 25000"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="currentWeek">Active Week Number</label>
            {isAnchored ? (
              // Derived from the anchor, so there is nothing here to type. Showing it as a
              // field the admin can edit would invite them to correct a number that will
              // simply be recomputed on the next read.
              <>
                <div style={{
                  padding: "1rem",
                  fontSize: "1.3rem",
                  fontWeight: 700,
                  backgroundColor: "var(--bg-light, #f8fafc)",
                  border: "0.1rem solid var(--border-color, #e2e8f0)",
                  borderRadius: "0.8rem",
                  color: "var(--text-dark, #1e293b)"
                }}>
                  Week {settings.currentWeek} of {WEEKS_PER_CYCLE}
                </div>
                <small className="settings-hint">
                  Week 1 was {formatAnchor(settings.weekAnchorDate)}. Counts forward on its own
                  every {settings.meetingDay || "Wednesday"}.
                </small>
              </>
            ) : (
              <input
                type="number"
                id="currentWeek"
                name="currentWeek"
                value={settings.currentWeek}
                onChange={handleChange}
                placeholder="e.g. 1"
                required
              />
            )}
          </div>

          <div className="form-group">
            <label htmlFor="devtFund">Weekly Dev Fund (Shs)</label>
            <input
              type="number"
              id="devtFund"
              name="devtFund"
              value={settings.devtFund}
              onChange={handleChange}
              placeholder="e.g. 1000"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="socialFund">Weekly Social Fund — Minimum (Shs)</label>
            <input
              type="number"
              id="socialFund"
              name="socialFund"
              value={settings.socialFund}
              onChange={handleChange}
              placeholder="e.g. 2000"
              required
            />
            <small className="settings-hint">
              The least a member may put in each week. They can give more than this and it is
              credited in full; anything below it is refused, and the week counts as unpaid
              until the shortfall is covered.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="loanApplicationFee">Loan Application Fee (Shs)</label>
            {/* min and step are both multiples of 500 so the step base lines up and
                round figures stay valid -- min="1" with a step would reject 5,000. */}
            <input
              type="number"
              id="loanApplicationFee"
              name="loanApplicationFee"
              value={settings.loanApplicationFee ?? 5000}
              onChange={handleChange}
              min="0"
              step="500"
              placeholder="e.g. 5000"
            />
            <small className="settings-hint">
              Flat charge per application, whatever the loan is worth. An admin confirms it
              before the guarantors are asked to sign.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="loanLateFeeAmount">Late Repayment Charge (Shs / month)</label>
            <input
              type="number"
              id="loanLateFeeAmount"
              name="loanLateFeeAmount"
              value={settings.loanLateFeeAmount ?? 10000}
              onChange={handleChange}
              min="0"
              step="500"
              placeholder="e.g. 10000"
            />
            <small className="settings-hint">
              Charged for each whole month a loan stays unpaid past its due date. Set to 0
              to charge nothing.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="loanMinGuarantors">Guarantors Required per Loan</label>
            <input
              type="number"
              id="loanMinGuarantors"
              name="loanMinGuarantors"
              value={settings.loanMinGuarantors ?? 3}
              onChange={handleChange}
              min="0"
              max="10"
              step="1"
              placeholder="e.g. 3"
            />
            <small className="settings-hint">
              A member cannot submit a request with fewer than this many guarantors from
              your SACCO.
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="meetingDay">Weekly Meeting Day</label>
            <CustomSelect
              value={settings.meetingDay || "Wednesday"}
              options={[
                { value: "Monday", label: "Monday" },
                { value: "Tuesday", label: "Tuesday" },
                { value: "Wednesday", label: "Wednesday" },
                { value: "Thursday", label: "Thursday" },
                { value: "Friday", label: "Friday" },
                { value: "Saturday", label: "Saturday" },
                { value: "Sunday", label: "Sunday" },
              ]}
              onChange={(val) => setSettings((prev) => ({ ...prev, meetingDay: val }))}
              minWidth="100%"
            />
          </div>
        </div>

        <div className="toggle-group">
          <div className="toggle-info">
            <span className="toggle-label">Lock Weekly Transactions</span>
            <span className="toggle-desc">Temporarily freeze all member contribution submissions for the active week.</span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              name="isLocked"
              checked={settings.isLocked}
              onChange={handleChange}
            />
            <span className="slider round"></span>
          </label>
        </div>

        <div className="toggle-group">
          <div className="toggle-info">
            <span className="toggle-label">Historical Onboarding Mode (Legacy Past Weeks)</span>
            <span className="toggle-desc">Enable if you need to manually enter past week records for members prior to app onboarding.</span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              name="isHistoricalMode"
              checked={Boolean(settings.isHistoricalMode)}
              onChange={(e) => setSettings((prev) => ({ ...prev, isHistoricalMode: e.target.checked }))}
            />
            <span className="slider round"></span>
          </label>
        </div>

        {/* Finishing a backfill is what turns the typed week number into a counted one, so
            the button belongs next to the switch that started it. */}
        {settings.isHistoricalMode && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", padding: "1.2rem 1.4rem", borderRadius: "0.8rem", marginTop: "1.2rem", fontSize: "1.25rem", color: "#92400e" }}>
            <p style={{ margin: "0 0 1rem" }}>
              When every past record has been entered up to today, finish onboarding. Your oldest
              record becomes <strong>Week 1</strong>, the active week is counted forward from it,
              and every record is renumbered to match.
            </p>
            <button
              type="button"
              onClick={() => handleCycleAction("finish")}
              disabled={cycleBusy}
              className="btn-save-settings"
              style={{ marginTop: 0, background: "#b45309" }}
            >
              {cycleBusy ? "Working..." : "Finish Historical Onboarding"}
            </button>
          </div>
        )}

        {/* The active week clamps at 52. Without this the SACCO would sit there forever. */}
        {settings.isCycleComplete && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "1.2rem 1.4rem", borderRadius: "0.8rem", marginTop: "1.2rem", fontSize: "1.25rem", color: "#1e40af" }}>
            <p style={{ margin: "0 0 1rem" }}>
              <strong>Week {WEEKS_PER_CYCLE} reached.</strong> This cycle is complete. Starting a new
              one makes this week&apos;s meeting Week 1 again; past records keep the week numbers of
              the cycle they happened in.
            </p>
            <button
              type="button"
              onClick={() => handleCycleAction("start_new_cycle")}
              disabled={cycleBusy}
              className="btn-save-settings"
              style={{ marginTop: 0, background: "#1d4ed8" }}
            >
              {cycleBusy ? "Working..." : "Start New Cycle"}
            </button>
          </div>
        )}

        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "1rem 1.4rem", borderRadius: "0.8rem", marginTop: "1.5rem", fontSize: "1.25rem", color: "#166534" }}>
          <i className="fa-solid fa-calendar-check" style={{ marginRight: "0.8rem" }}></i>
          {isAnchored ? (
            <>
              <strong>Week 1 was {formatAnchor(settings.weekAnchorDate)}.</strong> The active week is
              counted from there, one per {settings.meetingDay || "Wednesday"}, and rolls over after{" "}
              {WEEKS_PER_CYCLE} weeks.
            </>
          ) : (
            <>
              <strong>Week counted by hand:</strong> the active week is whatever is typed above.
              Switch on Historical Onboarding, enter your past records, then finish onboarding to
              have it counted from your first record instead.
            </>
          )}
        </div>

        <button type="submit" disabled={loadingSettings} className="btn-save-settings" style={{ marginTop: "1.5rem" }}>
          Save Configurations
        </button>
      </form>

      {/* 2. Print Performance Report Panel */}
      <div className="sacco-settings-card performance-report-card">
        <div className="report-header">
          <div>
            <h3 className="settings-title">Cooperative Performance Report</h3>
            <p className="settings-subtitle no-print">Generate a clean structured report and export/print for audit checks.</p>
          </div>
          
          {/* Filters controls */}
          <div className="report-filters no-print">
            <div className="filter-group">
              <CustomSelect
                value={filterYear}
                options={yearOptions}
                onChange={(val) => setFilterYear(Number(val))}
                minWidth="100px"
              />
            </div>
            <div className="filter-group">
              <CustomSelect
                value={filterMonth}
                options={monthOptions}
                onChange={(val) => setFilterMonth(Number(val))}
                minWidth="135px"
              />
            </div>
            <div className="filter-group">
              <CustomSelect
                value={filterWeek}
                options={weekOptions}
                onChange={(val) => setFilterWeek(Number(val))}
                minWidth="165px"
              />
            </div>
            <button onClick={handlePrintReport} className="btn-print-report">
              <i className="fa-solid fa-print"></i> Print Report
            </button>
            <button onClick={handleExportPDF} className="btn-print-report" style={{ backgroundColor: "#059669", marginLeft: "1rem" }}>
              <i className="fa-solid fa-file-pdf"></i> Export PDF
            </button>
          </div>
        </div>

        {/* Printable Area Layout */}
        <div className="printable-report-area">
          <div className="print-only-header">
            <h2>{saccoInfo?.name || "Blessed Youth Sacco"}</h2>
            <p>Group Code: {saccoInfo?.group_code || "BYS-8240"} | Acronym: {saccoInfo?.acronym || "BYS"}</p>
            <p className="print-date">Generated on: {today}</p>
            <div className="divider"></div>
          </div>

          <div className="report-period-badge">
            <span>Active Operational Period: <strong>Week {filterWeek} ({getMonthName(filterMonth)} {filterYear})</strong></span>
          </div>

          {/* Mobile Swipe Hint Banner */}
          <div className="mobile-scroll-hint no-print">
            <i className="fa-solid fa-arrows-left-right"></i> Scroll table horizontally to view full ledger breakdown
          </div>

          {/* Tabular performance display */}
          <div className="report-table-wrapper">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Member ID</th>
                  <th>Member Name</th>
                  <th>Shares</th>
                  <th>Development</th>
                  <th>Social Fund</th>
                  <th>Absent</th>
                  <th>Fines</th>
                  <th style={{ textAlign: "right" }}>Row Total</th>
                </tr>
              </thead>
              <tbody>
                {loadingData ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: "center", padding: "2rem" }}>
                      Loading database records...
                    </td>
                  </tr>
                ) : reportRows.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: "center", padding: "2rem" }}>
                      No member records found.
                    </td>
                  </tr>
                ) : (
                  reportRows.map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.memberId}</td>
                      <td><strong>{row.name}</strong></td>
                      <td>
                        {row.sharesAmt > 0 ? `Shs ${row.sharesAmt.toLocaleString()} (${row.sharesQty} ${row.sharesQty === 1 ? 'Share' : 'Shares'})` : "Shs 0"}
                      </td>
                      <td>Shs {row.devtAmt.toLocaleString()}</td>
                      <td>Shs {row.socialAmt.toLocaleString()}</td>
                      <td>Shs {row.absentAmt.toLocaleString()}</td>
                      <td>Shs {row.finesAmt.toLocaleString()}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>
                        Shs {row.rowTotal.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
                {/* Table Footer: Totals Row */}
                <tr className="totals-row">
                  <td colSpan="2"><strong>TOTALS</strong></td>
                  <td><strong>Shs {reportTotals.shares.toLocaleString()}</strong></td>
                  <td><strong>Shs {reportTotals.devt.toLocaleString()}</strong></td>
                  <td><strong>Shs {reportTotals.social.toLocaleString()}</strong></td>
                  <td><strong>Shs {reportTotals.absent.toLocaleString()}</strong></td>
                  <td><strong>Shs {reportTotals.fines.toLocaleString()}</strong></td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: "#1e3a8a" }}>
                    <strong>Shs {reportTotals.grandTotal.toLocaleString()}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="print-only-footer">
            <div className="signature-section">
              <div className="signature-box">
                <div className="signature-line"></div>
                <span>Prepared By: Administrator</span>
              </div>
              <div className="signature-box">
                <div className="signature-line"></div>
                <span>Approved By: Chairperson</span>
              </div>
            </div>
            <p className="disclaimer">This document serves as an official weekly ledger statement of account summaries.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
