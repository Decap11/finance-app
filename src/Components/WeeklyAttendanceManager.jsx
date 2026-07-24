"use client";

import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";

export default function WeeklyAttendanceManager({ allMembers = [] }) {
  const [currentWeek, setCurrentWeek] = useState(1);
  const [saccoId, setSaccoId] = useState(null);
  const [groupCode, setGroupCode] = useState("");
  const [attendance, setAttendance] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState(null);

  const FINE_PER_ABSENCE = 1000; // Shs 1,000 absenteeism cover fee

  useEffect(() => {
    async function loadSaccoContext() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("group_id")
          .eq("id", user.id)
          .single();

        if (!profile?.group_id) return;
        setGroupCode(profile.group_id);

        const { data: sacco } = await supabase
          .from("saccos")
          .select("id, current_week")
          .eq("group_code", profile.group_id)
          .limit(1)
          .single();

        if (sacco) {
          setSaccoId(sacco.id);
          setCurrentWeek(sacco.current_week || 1);
        }

        // Fetch settings if available
        const { data: settings } = await supabase
          .from("sacco_settings")
          .select("current_week")
          .ilike("group_code", profile.group_id)
          .limit(1);

        if (settings && settings.length > 0 && settings[0].current_week) {
          setCurrentWeek(settings[0].current_week);
        }
      } catch (err) {
        console.warn("Error loading SACCO context for attendance:", err);
      }
    }

    loadSaccoContext();
  }, []);

  // Initialize or fetch saved attendance for selected week
  useEffect(() => {
    if (!groupCode || !currentWeek) return;

    async function loadSavedAttendance() {
      setLoading(true);
      try {
        const { data: records } = await supabase
          .from("audit_events")
          .select("*")
          .eq("entity_type", "sacco_attendance")
          .order("created_at", { ascending: false });

        const weekRecord = (records || []).find(r => 
          r.metadata?.group_code?.toLowerCase() === groupCode.toLowerCase() && 
          Number(r.metadata?.week_number) === Number(currentWeek)
        );

        if (weekRecord && weekRecord.metadata?.attendance_map) {
          setAttendance(weekRecord.metadata.attendance_map);
        } else {
          // Default all members to "present"
          const defaultMap = {};
          (allMembers || []).forEach(m => {
            defaultMap[m.id] = "present";
          });
          setAttendance(defaultMap);
        }
      } catch (err) {
        console.warn("Failed to load attendance records:", err);
      } finally {
        setLoading(false);
      }
    }

    loadSavedAttendance();
  }, [groupCode, currentWeek, allMembers]);

  const toggleMemberStatus = (memberId, status) => {
    setAttendance(prev => ({
      ...prev,
      [memberId]: status
    }));
  };

  const markAllStatus = (status) => {
    const updated = {};
    (allMembers || []).forEach(m => {
      updated[m.id] = status;
    });
    setAttendance(updated);
  };

  // Calculations for Attendance & Fine Engine
  const totalMembers = allMembers.length;
  const filteredMembers = allMembers.filter(m => 
    (m.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (m.memberId || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const presentCount = Object.values(attendance).filter(s => s === "present").length;
  const absentCount = Object.values(attendance).filter(s => s === "absent").length;
  const excusedCount = Object.values(attendance).filter(s => s === "excused").length;

  const totalFinePool = absentCount * FINE_PER_ABSENCE;

  const handleSaveAttendance = async () => {
    if (!groupCode || !saccoId) return;
    setSaving(true);
    setStatusMessage(null);

    try {
      // 1. Log attendance event in audit_events
      const absentMemberIds = Object.keys(attendance).filter(id => attendance[id] === "absent");
      const absentMembers = allMembers.filter(m => absentMemberIds.includes(m.id));

      await supabase.from("audit_events").insert({
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
          total_fine_assessed: totalFinePool,
          registered_at: new Date().toISOString()
        }
      });

      // 2. Automatically log obligated absenteeism fine transactions for absent members
      if (absentMembers.length > 0) {
        const fineTransactions = absentMembers.map(m => ({
          sacco_id: saccoId,
          profile_id: m.id,
          type: "debit",
          category: "fines",
          amount: FINE_PER_ABSENCE,
          status: "pending",
          description: `Absenteeism Cover Fine - Week ${currentWeek}`,
          week_number: currentWeek,
          created_at: new Date().toISOString()
        }));

        try {
          await supabase.from("transactions").insert(fineTransactions);
        } catch (tErr) {
          console.warn("Failed to log fine transactions:", tErr);
        }
      }

      setStatusMessage({
        type: "success",
        text: `Week ${currentWeek} Presence Registered! ${absentCount} absent member(s) assessed Shs ${totalFinePool.toLocaleString()} absenteeism cover.`
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

  return (
    <div className="quick-actions" style={{ padding: "2.4rem", background: "var(--white)", borderRadius: "1.6rem", boxShadow: "var(--card-shadow)", border: "1px solid rgba(226, 232, 240, 0.8)", marginBottom: "2.4rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1.2rem" }}>
        <div>
          <h3 style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--text-dark)", display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <i className="fa-solid fa-clipboard-user" style={{ color: "var(--primary-color)" }}></i>
            Weekly Member Attendance Engine
          </h3>
          <p style={{ fontSize: "1.3rem", color: "var(--text-light)", marginTop: "0.3rem" }}>
            Register weekly presence & compute automatic absenteeism fines
          </p>
        </div>

        {/* Week Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", background: "#f8fafc", padding: "0.6rem 1.4rem", borderRadius: "1rem", border: "1px solid #e2e8f0" }}>
          <label style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-dark)" }}>Meeting Week:</label>
          <select
            value={currentWeek}
            onChange={(e) => setCurrentWeek(Number(e.target.value))}
            style={{ padding: "0.6rem 1rem", borderRadius: "0.6rem", border: "1px solid #cbd5e1", background: "white", fontSize: "1.35rem", fontWeight: 700, color: "var(--primary-color)", cursor: "pointer" }}
          >
            {Array.from({ length: 52 }, (_, i) => i + 1).map(w => (
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Status Alert Banner */}
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

      {/* Real-time Fine Calculator Engine Dashboard */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1.2rem", marginBottom: "2rem" }}>
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "1.2rem", borderRadius: "1.2rem", textAlign: "center" }}>
          <span style={{ fontSize: "1.2rem", color: "#166534", fontWeight: 600, display: "block" }}>Present</span>
          <strong style={{ fontSize: "2rem", color: "#15803d" }}>{presentCount}</strong>
        </div>

        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "1.2rem", borderRadius: "1.2rem", textAlign: "center" }}>
          <span style={{ fontSize: "1.2rem", color: "#991b1b", fontWeight: 600, display: "block" }}>Absent</span>
          <strong style={{ fontSize: "2rem", color: "#dc2626" }}>{absentCount}</strong>
        </div>

        <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", padding: "1.2rem", borderRadius: "1.2rem", textAlign: "center" }}>
          <span style={{ fontSize: "1.2rem", color: "#873800", fontWeight: 600, display: "block" }}>Excused</span>
          <strong style={{ fontSize: "2rem", color: "#d48806" }}>{excusedCount}</strong>
        </div>

        <div style={{ background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", padding: "1.2rem", borderRadius: "1.2rem", textAlign: "center", color: "white" }}>
          <span style={{ fontSize: "1.15rem", color: "#94a3b8", fontWeight: 600, display: "block" }}>Absenteeism Fine</span>
          <strong style={{ fontSize: "1.8rem", color: "#ef4444" }}>Shs {totalFinePool.toLocaleString()}</strong>
        </div>
      </div>

      {/* Batch Controls & Filter Search */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1.6rem", flexWrap: "wrap" }}>
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

        <div style={{ display: "flex", gap: "0.8rem" }}>
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

      {/* Member Attendance List */}
      <div style={{ maxHeight: "320px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "1.2rem", marginBottom: "2rem" }}>
        {filteredMembers.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "#94a3b8", fontSize: "1.3rem" }}>
            No members found matching "{searchQuery}".
          </div>
        ) : (
          filteredMembers.map((member) => {
            const status = attendance[member.id] || "present";
            return (
              <div
                key={member.id}
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
                <div style={{ display: "flex", alignItems: "center", gap: "1.2rem" }}>
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
                    fontSize: "1.4rem"
                  }}>
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <strong style={{ fontSize: "1.4rem", color: "var(--text-dark)", display: "block" }}>{member.name}</strong>
                    <span style={{ fontSize: "1.2rem", color: "#64748b" }}>{member.memberId || "MEM-000"}</span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                  {status === "absent" && (
                    <span style={{ fontSize: "1.2rem", fontWeight: 700, color: "#dc2626", padding: "0.4rem 0.8rem", borderRadius: "0.6rem", background: "#fee2e2" }}>
                      +Shs 1,000 Fine
                    </span>
                  )}
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
