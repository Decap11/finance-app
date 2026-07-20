"use client";

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import CustomSelect from "./CustomSelect.jsx";
import "../styles/saccoSettings.css";

export default function SaccoSettings() {
  const [settings, setSettings] = useState(() => {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem("sacco_settings_cache");
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {}
      }
    }
    return {
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      meetingDay: "Wednesday",
      isLocked: false,
    };
  });

  const [allMembers, setAllMembers] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);

  // Filter Period states
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterWeek, setFilterWeek] = useState(1);

  // Aggregated Report states
  const [reportRows, setReportRows] = useState([]);
  const [reportTotals, setReportTotals] = useState({
    shares: 0,
    devt: 0,
    social: 0,
    fines: 0,
    grandTotal: 0,
  });

  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [message, setMessage] = useState("");
  const [saccoInfo, setSaccoInfo] = useState(null);

  // Load Sacco configuration
  async function loadSettings() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const headers = (token && token.length < 3000) ? { "Authorization": `Bearer ${token}` } : {};

      const res = await fetch("/api/sacco-settings", { headers });
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
        setFilterWeek(data.currentWeek || 1);
        if (typeof window !== "undefined") {
          localStorage.setItem("sacco_settings_cache", JSON.stringify(data));
        }
      }
    } catch (err) {
      console.warn("Failed to load Sacco settings:", err);
      if (typeof window !== "undefined") {
        const cached = localStorage.getItem("sacco_settings_cache");
        if (cached) {
          try {
            setSettings(JSON.parse(cached));
          } catch (e) {}
        }
      }
    } finally {
      setLoadingSettings(false);
    }
  }

  // Load live transactions and profiles from database
  async function loadDatabaseData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from("profiles")
        .select("group_id")
        .eq("id", user.id)
        .single();

      if (!profileData) return;

      const { data: sacco } = await supabase
        .from("saccos")
        .select("*")
        .eq("group_code", profileData.group_id)
        .single();

      if (!sacco) return;
      setSaccoInfo(sacco);

      // Parallelize profile list and transaction list lookups
      const [profilesRes, txsRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("group_id", profileData.group_id),
        supabase.from("transactions").select("*").eq("sacco_id", sacco.id).in("status", ["approved", "completed", "pending"])
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
    } catch (err) {
      console.warn("Failed to load database data:", err);
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    Promise.all([loadSettings(), loadDatabaseData()]);
  }, []);

  // Compute Weekly Table and overall totals dynamically
  useEffect(() => {
    if (allMembers.length === 0) return;

    const rows = allMembers.map((member) => {
      // Find matching transactions for the selected week & year
      const memberTxs = allTransactions.filter((tx) => {
        if (tx.profile_id !== member.id) return false;

        // 1. Extract SACCO Week Number from database row or description text
        let txWeek = Number(tx.week_number) || Number(tx.week);
        if (!txWeek && tx.description) {
          const match = tx.description.match(/\|\s*Week\s*(\d+)/i);
          if (match) {
            txWeek = parseInt(match[1], 10);
          }
        }
        if (!txWeek && tx.created_at) {
          const txDate = new Date(tx.created_at);
          txWeek = Math.ceil(txDate.getDate() / 7);
        }

        const txDate = new Date(tx.created_at);
        const txYear = txDate.getFullYear();

        return (
          Number(txWeek) === Number(filterWeek) &&
          txYear === Number(filterYear)
        );
      });

      let sharesAmt = 0;
      let sharesQty = 0;
      let devtAmt = 0;
      let socialAmt = 0;
      let finesAmt = 0;

      memberTxs.forEach((tx) => {
        const amt = Number(tx.amount) || 0;
        if (tx.category === "shares") {
          sharesAmt += amt;
          sharesQty += Math.round(amt / settings.sharePrice);
        } else if (tx.category === "development_fund") {
          devtAmt += amt;
        } else if (tx.category === "social_fund") {
          socialAmt += amt;
        } else if (tx.category === "fine") {
          finesAmt += amt;
        }
      });

      const rowTotal = sharesAmt + devtAmt + socialAmt + finesAmt;

      return {
        memberId: member.memberId,
        name: member.name,
        sharesQty,
        sharesAmt,
        devtAmt,
        socialAmt,
        finesAmt,
        rowTotal,
      };
    });

    let totalShares = 0;
    let totalDev = 0;
    let totalSocial = 0;
    let totalFines = 0;
    let grandTotal = 0;

    rows.forEach((r) => {
      totalShares += r.sharesAmt;
      totalDev += r.devtAmt;
      totalSocial += r.socialAmt;
      totalFines += r.finesAmt;
      grandTotal += r.rowTotal;
    });

    setReportRows(rows);
    setReportTotals({
      shares: totalShares,
      devt: totalDev,
      social: totalSocial,
      fines: totalFines,
      grandTotal,
    });
  }, [allMembers, allTransactions, filterYear, filterMonth, filterWeek, settings.sharePrice]);

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
      if (token && token.length < 4096) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch("/api/sacco-settings", {
        method: "POST",
        headers,
        body: JSON.stringify(settings),
      });

      const text = await res.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(text || "Server returned a non-JSON response.");
      }

      if (!res.ok) throw new Error(data.error || "Failed to update settings.");

      setMessage("Settings saved successfully!");
      if (data.settings) {
        setSettings(data.settings);
        if (typeof window !== "undefined") {
          localStorage.setItem("sacco_settings_cache", JSON.stringify(data.settings));
          window.dispatchEvent(new CustomEvent("sacco_settings_updated", { detail: data.settings }));
        }
      }
      setTimeout(() => setMessage(""), 3000);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const handlePrintReport = () => {
    window.print();
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
            <input
              type="number"
              id="currentWeek"
              name="currentWeek"
              value={settings.currentWeek}
              onChange={handleChange}
              placeholder="e.g. 1"
              required
            />
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
            <label htmlFor="socialFund">Weekly Social Fund (Shs)</label>
            <input
              type="number"
              id="socialFund"
              name="socialFund"
              value={settings.socialFund}
              onChange={handleChange}
              placeholder="e.g. 2000"
              required
            />
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

        <button type="submit" disabled={loadingSettings} className="btn-save-settings">
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
                  <th>Fines</th>
                  <th style={{ textAlign: "right" }}>Row Total</th>
                </tr>
              </thead>
              <tbody>
                {loadingData ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center", padding: "2rem" }}>
                      Loading database records...
                    </td>
                  </tr>
                ) : reportRows.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: "center", padding: "2rem" }}>
                      No member records found.
                    </td>
                  </tr>
                ) : (
                  reportRows.map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.memberId}</td>
                      <td><strong>{row.name}</strong></td>
                      <td>
                        {row.sharesQty > 0 ? `${row.sharesQty} (Shs ${row.sharesAmt.toLocaleString()})` : "Shs 0"}
                      </td>
                      <td>Shs {row.devtAmt.toLocaleString()}</td>
                      <td>Shs {row.socialAmt.toLocaleString()}</td>
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
