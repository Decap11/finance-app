"use client";

import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

export default function WeeklyAttendanceManager({ allMembers = [] }) {
  const [currentWeek, setCurrentWeek] = useState(1);
  const [saccoId, setSaccoId] = useState(null);
  const [groupCode, setGroupCode] = useState("");
  const [fineRate, setFineRate] = useState(1000); // Default Shs 1,000 absenteeism fine
  const [attendance, setAttendance] = useState({});
  const [fineTransactions, setFineTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearingFineId, setClearingFineId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState(null);

  const [internalMembers, setInternalMembers] = useState([]);

  useEffect(() => {
    async function loadSaccoContext() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("group_id")
          .eq("id", user.id)
          .maybeSingle();

        const activeGroupCode = profile?.group_id || user.user_metadata?.group_id;
        if (activeGroupCode) {
          setGroupCode(activeGroupCode);

          const { data: sacco } = await supabase
            .from("saccos")
            .select("id, current_week, absenteeism_fine_amount")
            .ilike("group_code", activeGroupCode.trim())
            .limit(1)
            .maybeSingle();

          if (sacco) {
            setSaccoId(sacco.id);
            setCurrentWeek(sacco.current_week || 1);
            if (sacco.absenteeism_fine_amount) {
              setFineRate(Number(sacco.absenteeism_fine_amount));
            }
          }
        }
      } catch (err) {
        console.warn("Error loading SACCO context for attendance:", err);
      }
    }

    async function loadMembersFromAPI() {
      if (allMembers && allMembers.length > 0) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch("/api/group-members", {
          headers: { "Authorization": `Bearer ${session.access_token}` }
        });
        const data = await res.json();
        if (res.ok && data.profiles) {
          const formatted = data.profiles.map(p => ({
            id: p.id,
            name: p.full_name || p.email || "Member",
            memberId: p.member_number || `MEM-${String(p.id).substring(0, 4).toUpperCase()}`,
            phone: p.phone || "N/A",
            email: p.email || "N/A",
            role: p.role || "member",
            status: p.status || "active"
          }));
          setInternalMembers(formatted);
        }
      } catch (err) {
        console.warn("WeeklyAttendanceManager API member fetch failed:", err);
      }
    }

    loadSaccoContext();
    loadMembersFromAPI();
  }, [allMembers]);

  const activeMemberList = (allMembers && allMembers.length > 0) ? allMembers : internalMembers;

  // Load saved attendance snapshot & fine transactions for selected meeting week
  useEffect(() => {
    if (!groupCode || !currentWeek) return;

    async function loadWeekData() {
      setLoading(true);
      try {
        let auditQuery = supabase
          .from("audit_events")
          .select("*")
          .eq("entity_type", "sacco_attendance")
          .order("created_at", { ascending: false });

        if (saccoId) {
          auditQuery = auditQuery.eq("sacco_id", saccoId);
        }

        const { data: records } = await auditQuery;

        const weekRecord = (records || []).find(r => 
          r.metadata?.group_code?.toLowerCase() === groupCode.toLowerCase() && 
          Number(r.metadata?.week_number) === Number(currentWeek)
        );

        if (weekRecord && weekRecord.metadata?.attendance_map) {
          setAttendance(weekRecord.metadata.attendance_map);
        } else {
          const defaultMap = {};
          (activeMemberList || []).forEach(m => {
            defaultMap[m.id] = "present";
          });
          setAttendance(defaultMap);
        }

        // 2. Fetch fine transactions for this week
        if (saccoId) {
          const { data: txList } = await supabase
            .from("transactions")
            .select("*")
            .eq("sacco_id", saccoId)
            .eq("category", "fines")
            .ilike("description", `%Week ${currentWeek}`);

          setFineTransactions(txList || []);
        }
      } catch (err) {
        console.warn("Failed to load week attendance & fine data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadWeekData();
  }, [groupCode, saccoId, currentWeek, activeMemberList]);

  const toggleMemberStatus = (memberId, status) => {
    setAttendance(prev => ({
      ...prev,
      [memberId]: status
    }));
  };

  const markAllStatus = (status) => {
    const updated = {};
    (activeMemberList || []).forEach(m => {
      updated[m.id] = status;
    });
    setAttendance(updated);
  };

  // Real-time Financial Fine Engine Calculations
  const filteredMembers = activeMemberList.filter(m => 
    (m.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (m.memberId || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const presentCount = Object.values(attendance).filter(s => s === "present").length;
  const absentCount = Object.values(attendance).filter(s => s === "absent").length;
  const excusedCount = Object.values(attendance).filter(s => s === "excused").length;

  const totalFinesAssessed = absentCount * fineRate;

  // Compute collected vs outstanding fines from transaction records
  const collectedFines = fineTransactions
    .filter(tx => tx.status === "completed" || tx.status === "approved")
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  const outstandingFines = fineTransactions
    .filter(tx => tx.status === "pending")
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  // Save Attendance & Issue Fine Liabilities
  const handleSaveAttendance = async () => {
    if (!groupCode || !saccoId) return;
    setSaving(true);
    setStatusMessage(null);

    try {
      const absentMemberIds = Object.keys(attendance).filter(id => attendance[id] === "absent");
      const absentMembers = activeMemberList.filter(m => absentMemberIds.includes(m.id));

      // 1. Record attendance snapshot
      await supabase.from("audit_events").insert({
        sacco_id: saccoId,
        entity_type: "sacco_attendance",
        action: `register_attendance_week_${currentWeek}`,
        metadata: {
          group_code: groupCode,
          sacco_id: saccoId,
          week_number: currentWeek,
          attendance_map: attendance,
          present_count: presentCount,
          absent_count: absentCount,
          excused_count: excusedCount,
          fine_rate: fineRate,
          total_fine_assessed: totalFinesAssessed,
          registered_at: new Date().toISOString()
        }
      });

      // 2. Log pending absenteeism fines for absent members (deduplicated)
      if (absentMembers.length > 0) {
        const { data: existingFines } = await supabase
          .from("transactions")
          .select("profile_id")
          .eq("sacco_id", saccoId)
          .eq("category", "fines")
          .ilike("description", `%Week ${currentWeek}`);

        const existingFineMemberIds = new Set((existingFines || []).map(f => f.profile_id));
        const newAbsentMembers = absentMembers.filter(m => !existingFineMemberIds.has(m.id));

        if (newAbsentMembers.length > 0) {
          const fineTransactionsToInsert = newAbsentMembers.map(m => ({
            sacco_id: saccoId,
            profile_id: m.id,
            direction: "debit",
            category: "fines",
            amount: fineRate,
            status: "pending",
            description: `Absenteeism Cover Fine - Week ${currentWeek}`,
            week_number: currentWeek,
            created_at: new Date().toISOString()
          }));

          try {
            await supabase.from("transactions").insert(fineTransactionsToInsert);
          } catch (tErr) {
            console.warn("Fine transactions logging notice:", tErr);
          }
        }
      }

      // Re-fetch fine transactions
      const { data: updatedTx } = await supabase
        .from("transactions")
        .select("*")
        .eq("sacco_id", saccoId)
        .eq("category", "fines")
        .ilike("description", `%Week ${currentWeek}`);

      setFineTransactions(updatedTx || []);

      setStatusMessage({
        type: "success",
        text: `Week ${currentWeek} Presence Saved! ${absentCount} absent member(s) assessed UGX ${totalFinesAssessed.toLocaleString()} in fines.`
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sacco_transaction_updated"));
      }
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: "Failed to save attendance: " + err.message
      });
    } finally {
      setSaving(false);
    }
  };

  // Mark Fine as Paid / Cleared
  const handleClearFine = async (memberId, existingTxId) => {
    setClearingFineId(memberId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("/api/admin/clear-fine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          transactionId: existingTxId,
          memberId: memberId,
          weekNum: currentWeek
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to clear fine");
      }

      // Refresh fine transactions
      const { data: updatedTx } = await supabase
        .from("transactions")
        .select("*")
        .eq("sacco_id", saccoId)
        .eq("category", "fines")
        .ilike("description", `%Week ${currentWeek}`);

      setFineTransactions(updatedTx || []);

      setStatusMessage({
        type: "success",
        text: `Absenteeism Fine of UGX ${fineRate.toLocaleString()} marked as PAID for Member!`
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sacco_transaction_updated"));
      }
    } catch (err) {
      setStatusMessage({
        type: "error",
        text: "Error clearing fine: " + err.message
      });
    } finally {
      setClearingFineId(null);
    }
  };

  return (
    <div className="quick-actions attendance-engine-card" style={{ padding: "2.4rem", background: "var(--white)", borderRadius: "1.6rem", boxShadow: "var(--card-shadow)", border: "1px solid rgba(226, 232, 240, 0.8)", marginBottom: "2.4rem" }}>
      {/* Header */}
      <div className="attendance-header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1.2rem" }}>
        <div>
          <h3 style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--text-dark)", display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <i className="fa-solid fa-clipboard-user" style={{ color: "var(--primary-color)" }}></i>
            Weekly Member Attendance Engine
          </h3>
          <p style={{ fontSize: "1.3rem", color: "var(--text-light)", marginTop: "0.3rem" }}>
            Register weekly presence & track UGX {fineRate.toLocaleString()} absenteeism cover fines
          </p>
        </div>

        {/* Meeting Week Selector */}
        <div className="attendance-week-selector" style={{ display: "flex", alignItems: "center", gap: "1rem", background: "#f8fafc", padding: "0.6rem 1.4rem", borderRadius: "1rem", border: "1px solid #e2e8f0" }}>
          <label style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-dark)" }}>Meeting Week:</label>
          <select
            value={currentWeek}
            onChange={(e) => setCurrentWeek(Number(e.target.value))}
            className="attendance-week-select"
          >
            {Array.from({ length: 52 }, (_, i) => i + 1).map(w => (
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Alert Banner */}
      {statusMessage && (
        <div style={{
          padding: "1.2rem 1.6rem",
          borderRadius: "1rem",
          marginBottom: "2rem",
          fontSize: "1.3rem",
          fontWeight: 600,
          background: statusMessage.type === "success" ? "#d1fae5" : "#fee2e2",
          color: statusMessage.type === "success" ? "#065f46" : "#991b1b",
          border: `1px solid ${statusMessage.type === "success" ? "#a7f3d0" : "#fca5a5"}`,
          display: "flex",
          alignItems: "center",
          gap: "0.8rem"
        }}>
          <i className={statusMessage.type === "success" ? "fa-solid fa-circle-check" : "fa-solid fa-circle-exclamation"}></i>
          {statusMessage.text}
        </div>
      )}

      {/* Real-time Fine Calculation Engine Dashboard */}
      <div className="attendance-metrics-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "1.2rem", marginBottom: "2rem" }}>
        <div className="attendance-metrics-card" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "1.2rem", borderRadius: "1.2rem", textAlign: "center" }}>
          <span style={{ fontSize: "1.2rem", color: "#166534", fontWeight: 600, display: "block" }}>Present</span>
          <strong style={{ fontSize: "2rem", color: "#15803d" }}>{presentCount}</strong>
        </div>

        <div className="attendance-metrics-card" style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "1.2rem", borderRadius: "1.2rem", textAlign: "center" }}>
          <span style={{ fontSize: "1.2rem", color: "#991b1b", fontWeight: 600, display: "block" }}>Absent</span>
          <strong style={{ fontSize: "2rem", color: "#dc2626" }}>{absentCount}</strong>
        </div>

        <div className="attendance-metrics-card" style={{ background: "#fffbe6", border: "1px solid #ffe58f", padding: "1.2rem", borderRadius: "1.2rem", textAlign: "center" }}>
          <span style={{ fontSize: "1.2rem", color: "#873800", fontWeight: 600, display: "block" }}>Excused</span>
          <strong style={{ fontSize: "2rem", color: "#d48806" }}>{excusedCount}</strong>
        </div>

        <div className="attendance-metrics-card" style={{ background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", padding: "1.2rem", borderRadius: "1.2rem", textAlign: "center", color: "white" }}>
          <span style={{ fontSize: "1.15rem", color: "#94a3b8", fontWeight: 600, display: "block" }}>Fines Assessed</span>
          <strong style={{ fontSize: "1.8rem", color: "#ef4444" }}>UGX {totalFinesAssessed.toLocaleString()}</strong>
        </div>

        <div className="attendance-metrics-card" style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "1.2rem", borderRadius: "1.2rem", textAlign: "center" }}>
          <span style={{ fontSize: "1.15rem", color: "#065f46", fontWeight: 600, display: "block" }}>Fines Paid</span>
          <strong style={{ fontSize: "1.8rem", color: "#059669" }}>UGX {collectedFines.toLocaleString()}</strong>
        </div>
      </div>

      {/* Batch Controls & Search */}
      <div className="attendance-batch-controls" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1.6rem", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <i className="fa-solid fa-magnifying-glass" style={{ position: "absolute", left: "1.2rem", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}></i>
          <input
            type="text"
            placeholder="Search member by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", padding: "0.8rem 1.2rem 0.8rem 3.6rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", fontSize: "1.3rem" }}
          />
        </div>

        <div className="attendance-batch-buttons" style={{ display: "flex", gap: "0.8rem" }}>
          <button
            type="button"
            onClick={() => markAllStatus("present")}
            style={{ padding: "0.6rem 1.2rem", borderRadius: "0.8rem", border: "none", background: "#dcfce7", color: "#166534", fontSize: "1.25rem", fontWeight: 700, cursor: "pointer" }}
          >
            Mark All Present
          </button>
          <button
            type="button"
            onClick={() => markAllStatus("absent")}
            style={{ padding: "0.6rem 1.2rem", borderRadius: "0.8rem", border: "none", background: "#fee2e2", color: "#991b1b", fontSize: "1.25rem", fontWeight: 700, cursor: "pointer" }}
          >
            Mark All Absent
          </button>
        </div>
      </div>

      {/* Member Attendance & Fine Payment List */}
      <div style={{ maxHeight: "360px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "1.2rem", marginBottom: "2rem" }}>
        {filteredMembers.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#94a3b8", fontSize: "1.3rem" }}>
            No members found matching "{searchQuery}".
          </div>
        ) : (
          filteredMembers.map((member) => {
            const status = attendance[member.id] || "present";
            const memberFineTx = fineTransactions.find(t => t.profile_id === member.id);
            const isFinePaid = memberFineTx && (memberFineTx.status === "completed" || memberFineTx.status === "approved");

            return (
              <div
                key={member.id}
                className="attendance-member-row"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "1.2rem 1.6rem",
                  borderBottom: "1px solid #f1f5f9",
                  background: status === "absent" ? "#fef2f2" : "white",
                  transition: "background 0.2s ease"
                }}
              >
                <div className="attendance-member-info" style={{ display: "flex", alignItems: "center", gap: "1.2rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <div style={{
                      width: "3.6rem",
                      height: "3.6rem",
                      borderRadius: "50%",
                      background: "var(--primary-light)",
                      color: "var(--primary-color)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: "1.4rem",
                      flexShrink: 0
                    }}>
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <strong style={{ fontSize: "1.4rem", color: "var(--text-dark)", display: "block" }}>{member.name}</strong>
                      <span style={{ fontSize: "1.2rem", color: "#64748b" }}>{member.memberId || "MEM-000"}</span>
                    </div>
                  </div>

                  {status === "absent" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                      <span style={{
                        fontSize: "1.15rem",
                        fontWeight: 700,
                        color: isFinePaid ? "#065f46" : "#dc2626",
                        padding: "0.4rem 0.8rem",
                        borderRadius: "0.6rem",
                        background: isFinePaid ? "#d1fae5" : "#fee2e2",
                        border: `1px solid ${isFinePaid ? "#a7f3d0" : "#fca5a5"}`
                      }}>
                        {isFinePaid ? "✓ Fine Paid (UGX 1,000)" : "🔴 Unpaid Fine (UGX 1,000)"}
                      </span>

                      {!isFinePaid && (
                        <button
                          type="button"
                          onClick={() => handleClearFine(member.id, memberFineTx?.id)}
                          disabled={clearingFineId === member.id}
                          style={{
                            padding: "0.4rem 0.8rem",
                            borderRadius: "0.6rem",
                            border: "none",
                            background: "#059669",
                            color: "white",
                            fontSize: "1.15rem",
                            fontWeight: 700,
                            cursor: "pointer"
                          }}
                        >
                          {clearingFineId === member.id ? "Clearing..." : "Mark Fine Paid"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="attendance-member-actions" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                  <button
                    type="button"
                    onClick={() => toggleMemberStatus(member.id, "present")}
                    style={{
                      padding: "0.6rem 1.2rem",
                      borderRadius: "0.8rem",
                      border: status === "present" ? "2px solid #16a34a" : "1px solid #cbd5e1",
                      background: status === "present" ? "#16a34a" : "white",
                      color: status === "present" ? "white" : "#475569",
                      fontWeight: 700,
                      fontSize: "1.2rem",
                      cursor: "pointer"
                    }}
                  >
                    <i className="fa-solid fa-check" style={{ marginRight: "0.4rem" }}></i> Present
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleMemberStatus(member.id, "absent")}
                    style={{
                      padding: "0.6rem 1.2rem",
                      borderRadius: "0.8rem",
                      border: status === "absent" ? "2px solid #dc2626" : "1px solid #cbd5e1",
                      background: status === "absent" ? "#dc2626" : "white",
                      color: status === "absent" ? "white" : "#475569",
                      fontWeight: 700,
                      fontSize: "1.2rem",
                      cursor: "pointer"
                    }}
                  >
                    <i className="fa-solid fa-xmark" style={{ marginRight: "0.4rem" }}></i> Absent
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleMemberStatus(member.id, "excused")}
                    style={{
                      padding: "0.6rem 1.2rem",
                      borderRadius: "0.8rem",
                      border: status === "excused" ? "2px solid #d97706" : "1px solid #cbd5e1",
                      background: status === "excused" ? "#d97706" : "white",
                      color: status === "excused" ? "white" : "#475569",
                      fontWeight: 700,
                      fontSize: "1.2rem",
                      cursor: "pointer"
                    }}
                  >
                    Excused
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Save Button */}
      <button
        type="button"
        onClick={handleSaveAttendance}
        disabled={saving || loading}
        style={{
          width: "100%",
          padding: "1.2rem",
          borderRadius: "1rem",
          background: "#253b8e",
          color: "white",
          border: "none",
          fontSize: "1.5rem",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 0.4rem 1.4rem rgba(37, 59, 142, 0.25)"
        }}
      >
        {saving ? "Saving Presence & Assessing Fines..." : `Save Week ${currentWeek} Presence & Log Absenteeism Fines`}
      </button>
    </div>
  );
}
