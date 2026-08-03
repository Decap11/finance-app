"use client";

import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

export default function MemberFineAlertBanner() {
  const [pendingFines, setPendingFines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMemberFines() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: txList } = await supabase
          .from("transactions")
          .select("*")
          .eq("profile_id", user.id)
          .eq("category", "fines")
          .eq("status", "pending")
          .order("created_at", { ascending: false });

        setPendingFines(txList || []);
      } catch (err) {
        console.warn("Failed to load member fine alerts:", err);
      } finally {
        setLoading(false);
      }
    }

    loadMemberFines();

    const handleTxUpdate = () => loadMemberFines();
    if (typeof window !== "undefined") {
      window.addEventListener("sacco_transaction_updated", handleTxUpdate);
      return () => window.removeEventListener("sacco_transaction_updated", handleTxUpdate);
    }
  }, []);

  if (loading || pendingFines.length === 0) return null;

  const totalOwed = pendingFines.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const latestFine = pendingFines[0];

  // A fine for arriving late is not an absence, and this banner used to tell every fined
  // member they had been "marked absent" regardless. Split the outstanding fines so the
  // wording matches what the member is actually being charged for.
  const absenceFines = pendingFines.filter(
    (tx) => (tx.fine_type || "absenteeism") === "absenteeism"
  );
  const otherFines = pendingFines.filter(
    (tx) => (tx.fine_type || "absenteeism") !== "absenteeism"
  );

  const heading = absenceFines.length === 0
    ? `Unpaid Fine Notice (${pendingFines.length})`
    : otherFines.length === 0
      ? `Absenteeism Cover Fine Notice (${absenceFines.length} Unpaid)`
      : `Unpaid Fines (${absenceFines.length} absence, ${otherFines.length} other)`;

  const detail = absenceFines.length > 0 && otherFines.length === 0
    ? <>You were marked absent for meeting session <strong>{latestFine.description || `Week ${latestFine.week_number}`}</strong>.</>
    : otherFines.length > 0 && absenceFines.length === 0
      ? <>Most recent: <strong>{latestFine.description || "Fine issued by your SACCO"}</strong>.</>
      : <>You have <strong>{absenceFines.length}</strong> unpaid absence fine(s) and <strong>{otherFines.length}</strong> other unpaid fine(s).</>;

  return (
    <div style={{
      background: "linear-gradient(135deg, #fef2f2 0%, #ffe4e6 100%)",
      border: "1px solid #fecaca",
      borderRadius: "1.6rem",
      padding: "1.6rem 2rem",
      marginBottom: "2rem",
      boxShadow: "0 4px 14px rgba(239, 68, 68, 0.12)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "1.6rem",
      flexWrap: "wrap"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1.4rem" }}>
        <div style={{
          width: "4.4rem",
          height: "4.4rem",
          borderRadius: "50%",
          background: "#ef4444",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "2rem",
          flexShrink: 0
        }}>
          <i className="fa-solid fa-triangle-exclamation"></i>
        </div>
        <div>
          <h4 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#991b1b", marginBottom: "0.2rem" }}>
            {heading}
          </h4>
          <p style={{ fontSize: "1.3rem", color: "#7f1d1d", lineHeight: 1.4 }}>
            {detail} You currently owe <strong>UGX {totalOwed.toLocaleString()}</strong> in unpaid fines.
          </p>
        </div>
      </div>

      <div style={{
        background: "white",
        padding: "0.8rem 1.6rem",
        borderRadius: "1rem",
        border: "1px solid #fca5a5",
        textAlign: "right"
      }}>
        <span style={{ fontSize: "1.15rem", color: "#991b1b", display: "block", fontWeight: 600 }}>Total Fine Owed</span>
        <strong style={{ fontSize: "1.8rem", color: "#dc2626" }}>UGX {totalOwed.toLocaleString()}</strong>
      </div>
    </div>
  );
}
