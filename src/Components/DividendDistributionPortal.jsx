"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default function DividendDistributionPortal() {
  const [saccoId, setSaccoId] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [saccoName, setSaccoName] = useState("PEWOSA SACCO Group");

  const [profitPool, setProfitPool] = useState("");
  const [cycleYear, setCycleYear] = useState(new Date().getFullYear());
  const [distributionMode, setDistributionMode] = useState("shares");

  const [previewData, setPreviewData] = useState(null);
  const [calculating, setCalculating] = useState(false);

  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState([]);

  const [statusMessage, setStatusMessage] = useState(null);

  useEffect(() => {
    async function loadSaccoContext() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("group_id")
          .eq("id", session.user.id)
          .single();

        if (profile?.group_id) {
          setGroupCode(profile.group_id);
          const { data: sacco } = await supabase
            .from("saccos")
            .select("id, name")
            .ilike("group_code", profile.group_id.trim())
            .maybeSingle();

          if (sacco) {
            setSaccoId(sacco.id);
            if (sacco.name) setSaccoName(sacco.name);
            loadHistory(sacco.id);
          }
        }
      } catch (err) {
        console.warn("Failed to load SACCO context for Dividend Portal:", err);
      }
    }

    loadSaccoContext();
  }, []);

  const loadHistory = async (sId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`/api/admin/dividends?sacco_id=${sId}&action=history`, {
        headers: { "Authorization": `Bearer ${session.access_token}` }
      });
      const result = await res.json();
      if (result.success) {
        setHistory(result.cycles || []);
      }
    } catch (err) {
      console.warn("Failed to load dividend cycles history:", err);
    }
  };

  const handleCalculatePreview = async () => {
    if (!saccoId || !profitPool || Number(profitPool) <= 0) {
      setStatusMessage({ type: "error", text: "Please enter a valid Net Profit Pool amount greater than 0." });
      return;
    }

    setCalculating(true);
    setStatusMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch(`/api/admin/dividends?sacco_id=${saccoId}&profit_pool=${profitPool}&action=preview`, {
        headers: { "Authorization": `Bearer ${session.access_token}` }
      });
      const result = await res.json();

      if (!result.success) throw new Error(result.error || "Failed to calculate preview");

      setPreviewData(result.preview);
    } catch (err) {
      setStatusMessage({ type: "error", text: "Calculation preview failed: " + err.message });
    } finally {
      setCalculating(false);
    }
  };

  const handleExecutePayout = async () => {
    if (!previewData || !saccoId || !profitPool) return;

    const confirmRun = window.confirm(
      `Confirm Dividend Payout of UGX ${Number(profitPool).toLocaleString()} for ${cycleYear}?\n\nThis will automatically credit ${previewData.members?.length || 0} members' accounts.`
    );

    if (!confirmRun) return;

    setExecuting(true);
    setStatusMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch("/api/admin/dividends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          sacco_id: saccoId,
          cycle_year: cycleYear,
          profit_pool: Number(profitPool),
          distribution_mode: distributionMode
        })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Execution failed");

      setStatusMessage({
        type: "success",
        text: result.result?.message || `Successfully distributed UGX ${Number(profitPool).toLocaleString()} in dividends!`
      });

      setProfitPool("");
      setPreviewData(null);
      loadHistory(saccoId);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sacco_transaction_updated"));
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: "Execution failed: " + err.message });
    } finally {
      setExecuting(false);
    }
  };

  const exportDividendPDF = (dataToExport) => {
    const members = dataToExport.members || [];
    if (members.length === 0) return;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    // Colors
    const primaryColor = [37, 59, 142];
    const darkTextColor = [15, 23, 42];

    // Header
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 210, 26, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(saccoName.toUpperCase(), 10, 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.text(`DIVIDEND DISTRIBUTION REPORT - CYCLE ${cycleYear}`, 10, 19);

    // Summary Box
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(10, 29, 190, 16, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...darkTextColor);
    doc.text(`Profit Pool: UGX ${Number(dataToExport.profit_pool || profitPool || 0).toLocaleString()}`, 14, 36);
    doc.text(`Total Shares: ${dataToExport.total_shares || 0}`, 75, 36);
    doc.text(`Dividend/Share: UGX ${Number(dataToExport.dividend_per_share || 0).toLocaleString()}`, 125, 36);

    const headers = [["Member ID", "Member Name", "Shares Owned", "Equity %", "Dividend Payout (UGX)"]];
    const rows = members.map(m => [
      m.member_number || "MEM-000",
      m.full_name || "Unknown Member",
      m.shares_count || 0,
      `${m.equity_percentage || 0}%`,
      Number(m.calculated_payout || m.payout_amount || 0).toLocaleString()
    ]);

    autoTable(doc, {
      startY: 48,
      head: headers,
      body: rows,
      theme: "grid",
      headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9.5 },
      bodyStyles: { fontSize: 9, textColor: darkTextColor }
    });

    doc.save(`${groupCode}_dividend_report_${cycleYear}.pdf`);
  };

  return (
    <div style={{ background: "#ffffff", borderRadius: "1.6rem", padding: "2.5rem", boxShadow: "0 0.4rem 2rem rgba(0,0,0,0.02)", border: "1px solid #f1f5f9", marginBottom: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h3 style={{ fontSize: "1.8rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
            <i className="fa-solid fa-coins" style={{ color: "#eab308", marginRight: "0.8rem" }}></i>
            Annual Dividend Distribution Portal
          </h3>
          <p style={{ fontSize: "1.2rem", color: "#64748b", margin: "0.4rem 0 0" }}>
            Calculate and distribute net profit dividends to members proportional to their share equity.
          </p>
        </div>
      </div>

      {statusMessage && (
        <div style={{
          padding: "1.2rem 1.6rem",
          borderRadius: "0.8rem",
          fontSize: "1.3rem",
          fontWeight: 600,
          marginBottom: "1.6rem",
          backgroundColor: statusMessage.type === "error" ? "#fee2e2" : "#d1fae5",
          color: statusMessage.type === "error" ? "#dc2626" : "#047857"
        }}>
          {statusMessage.text}
        </div>
      )}

      {/* Input Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem", marginBottom: "2rem", background: "#f8fafc", padding: "2rem", borderRadius: "1.2rem", border: "1px solid #e2e8f0" }}>
        <div>
          <label style={{ display: "block", fontSize: "1.2rem", fontWeight: 700, color: "#334155", marginBottom: "0.6rem" }}>
            Cycle Financial Year
          </label>
          <input
            type="number"
            value={cycleYear}
            onChange={(e) => setCycleYear(e.target.value)}
            style={{ width: "100%", padding: "1rem 1.2rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", fontSize: "1.3rem", fontWeight: 600 }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "1.2rem", fontWeight: 700, color: "#334155", marginBottom: "0.6rem" }}>
            Net Profit Pool (UGX)
          </label>
          <input
            type="number"
            placeholder="e.g. 10000000"
            value={profitPool}
            onChange={(e) => setProfitPool(e.target.value)}
            style={{ width: "100%", padding: "1rem 1.2rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", fontSize: "1.3rem", fontWeight: 600 }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: "1.2rem", fontWeight: 700, color: "#334155", marginBottom: "0.6rem" }}>
            Payout Mode
          </label>
          <select
            value={distributionMode}
            onChange={(e) => setDistributionMode(e.target.value)}
            style={{ width: "100%", padding: "1rem 1.2rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", fontSize: "1.3rem", fontWeight: 600, backgroundColor: "#ffffff" }}
          >
            <option value="shares">Reinvest into Shares Account</option>
            <option value="savings">Credit General Savings Account</option>
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            onClick={handleCalculatePreview}
            disabled={calculating}
            style={{
              width: "100%",
              padding: "1.1rem 1.6rem",
              borderRadius: "0.8rem",
              border: "none",
              backgroundColor: "#253b8e",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "1.3rem",
              cursor: "pointer",
              transition: "all 0.2s ease"
            }}
          >
            {calculating ? "Calculating..." : "Preview Distribution"}
          </button>
        </div>
      </div>

      {/* Preview Table */}
      {previewData && (
        <div style={{ marginBottom: "3rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "1.2rem", overflow: "hidden" }}>
          <div style={{ padding: "1.6rem 2rem", background: "#f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0f172a" }}>
                Calculated Dividend Rate: UGX {Number(previewData.dividend_per_share || 0).toLocaleString()} / share
              </span>
              <div style={{ fontSize: "1.2rem", color: "#64748b" }}>
                Total Equity: {previewData.total_shares} Shares across {previewData.members?.length || 0} Members
              </div>
            </div>

            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                onClick={() => exportDividendPDF(previewData)}
                style={{ padding: "0.8rem 1.4rem", borderRadius: "0.6rem", border: "1px solid #cbd5e1", backgroundColor: "#ffffff", color: "#334155", fontWeight: 700, fontSize: "1.2rem", cursor: "pointer" }}
              >
                <i className="fa-solid fa-file-pdf" style={{ color: "#ef4444", marginRight: "0.6rem" }}></i>
                Export PDF Preview
              </button>

              <button
                onClick={handleExecutePayout}
                disabled={executing}
                style={{ padding: "0.8rem 1.6rem", borderRadius: "0.6rem", border: "none", backgroundColor: "#10b981", color: "#ffffff", fontWeight: 700, fontSize: "1.2rem", cursor: "pointer" }}
              >
                {executing ? "Processing Bulk Payout..." : "Approve & Execute Payout"}
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc", textAlign: "left", fontSize: "1.2rem", color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                  <th style={{ padding: "1.2rem 1.5rem" }}>Member ID</th>
                  <th style={{ padding: "1.2rem 1.5rem" }}>Member Name</th>
                  <th style={{ padding: "1.2rem 1.5rem" }}>Shares Owned</th>
                  <th style={{ padding: "1.2rem 1.5rem" }}>Equity %</th>
                  <th style={{ padding: "1.2rem 1.5rem", textAlign: "right" }}>Dividend Payout (UGX)</th>
                </tr>
              </thead>
              <tbody>
                {(previewData.members || []).map((m) => (
                  <tr key={m.profile_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "1.2rem 1.5rem", fontSize: "1.3rem", fontWeight: 700, color: "#0f172a" }}>{m.member_number || "MEM-000"}</td>
                    <td style={{ padding: "1.2rem 1.5rem", fontSize: "1.3rem", color: "#334155" }}>{m.full_name || "Unknown Member"}</td>
                    <td style={{ padding: "1.2rem 1.5rem", fontSize: "1.3rem", fontWeight: 700, color: "#253b8e" }}>{m.shares_count || 0} shares</td>
                    <td style={{ padding: "1.2rem 1.5rem", fontSize: "1.3rem", color: "#64748b" }}>{m.equity_percentage}%</td>
                    <td style={{ padding: "1.2rem 1.5rem", fontSize: "1.4rem", fontWeight: 800, color: "#10b981", textAlign: "right" }}>
                      UGX {Number(m.calculated_payout || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historical Cycles */}
      {history.length > 0 && (
        <div>
          <h4 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f172a", marginBottom: "1.2rem" }}>
            Completed Dividend Payout History
          </h4>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc", textAlign: "left", fontSize: "1.1rem", color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                  <th style={{ padding: "1rem" }}>Year</th>
                  <th style={{ padding: "1rem" }}>Profit Pool (UGX)</th>
                  <th style={{ padding: "1rem" }}>Total Shares</th>
                  <th style={{ padding: "1rem" }}>Dividend / Share</th>
                  <th style={{ padding: "1rem" }}>Mode</th>
                  <th style={{ padding: "1rem" }}>Execution Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((cycle) => (
                  <tr key={cycle.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "1rem", fontSize: "1.2rem", fontWeight: 700 }}>{cycle.cycle_year}</td>
                    <td style={{ padding: "1rem", fontSize: "1.2rem", fontWeight: 700, color: "#10b981" }}>UGX {Number(cycle.total_profit_pool || 0).toLocaleString()}</td>
                    <td style={{ padding: "1rem", fontSize: "1.2rem" }}>{cycle.total_shares_count}</td>
                    <td style={{ padding: "1rem", fontSize: "1.2rem" }}>UGX {Number(cycle.dividend_per_share || 0).toLocaleString()}</td>
                    <td style={{ padding: "1rem", fontSize: "1.1rem", textTransform: "capitalize" }}>{cycle.distribution_mode}</td>
                    <td style={{ padding: "1rem", fontSize: "1.1rem", color: "#64748b" }}>{new Date(cycle.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
