"use client";

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/saccoSettings.css";

export default function SaccoSettings() {
  const [settings, setSettings] = useState({
    sharePrice: 25000,
    devtFund: 1000,
    socialFund: 2000,
    currentWeek: 1,
    isLocked: false,
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
      const res = await fetch("/api/sacco-settings");
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
        setFilterWeek(data.currentWeek || 1);
      }
    } catch (err) {
      console.warn("Failed to load Sacco settings:", err);
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

      // 1. Fetch Sacco profiles
      const { data: profilesList } = await supabase
        .from("profiles")
        .select("*")
        .eq("group_id", profileData.group_id);

      if (profilesList) {
        setAllMembers(
          profilesList.map((m) => ({
            id: m.id,
            name: m.full_name || "Unknown",
            memberId: m.member_number || "N/A",
          }))
        );
      }

      // 2. Fetch all Sacco transactions of status completed/approved/pending
      const { data: txsList } = await supabase
        .from("transactions")
        .select("*")
        .eq("sacco_id", sacco.id)
        .in("status", ["approved", "completed", "pending"]);

      if (txsList) {
        setAllTransactions(txsList);
      }
    } catch (err) {
      console.warn("Failed to load database data:", err);
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    loadSettings();
    loadDatabaseData();
  }, []);

  // Compute Weekly Table and overall totals dynamically
  useEffect(() => {
    if (allMembers.length === 0) return;

    const rows = allMembers.map((member) => {
      // Find matching transactions for the selected week/month/year
      const memberTxs = allTransactions.filter((tx) => {
        if (tx.profile_id !== member.id) return false;

        const txDate = new Date(tx.created_at);
        const txYear = txDate.getFullYear();
        const txMonth = txDate.getMonth();
        const txDay = txDate.getDate();
        const txWeek = Math.ceil(txDay / 7);

        return (
          txYear === Number(filterYear) &&
          txMonth === Number(filterMonth) &&
          txWeek === Number(filterWeek)
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

      const res = await fetch("/api/sacco-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(settings),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update settings.");

      setMessage("Settings saved successfully!");
      await loadSettings();
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
          <div className="report-filters no-print" style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <div className="filter-group">
              <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))}>
                <option value="2025">2025</option>
                <option value="2026">2026</option>
                <option value="2027">2027</option>
              </select>
            </div>
            <div className="filter-group">
              <select value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))}>
                <option value="0">January</option>
                <option value="1">February</option>
                <option value="2">March</option>
                <option value="3">April</option>
                <option value="4">May</option>
                <option value="5">June</option>
                <option value="6">July</option>
                <option value="7">August</option>
                <option value="8">September</option>
                <option value="9">October</option>
                <option value="10">November</option>
                <option value="11">December</option>
              </select>
            </div>
            <div className="filter-group">
              <select value={filterWeek} onChange={(e) => setFilterWeek(Number(e.target.value))}>
                <option value="1">Week 1</option>
                <option value="2">Week 2</option>
                <option value="3">Week 3</option>
                <option value="4">Week 4</option>
              </select>
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
