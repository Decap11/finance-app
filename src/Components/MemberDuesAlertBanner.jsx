"use client";

import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

/**
 * "You are behind on the weekly mandatory funds."
 *
 * Amber, not red, and deliberately so: MemberFineAlertBanner sits directly above this one and
 * is red because a fine is a penalty already incurred. This is an obligation not yet met.
 * A member who owes four weeks of social fund has not been punished for anything, and the two
 * banners must not read as the same kind of trouble.
 *
 * Everything shown here is derived, never stored -- see utils/duesEngine.js. Nothing is owed
 * until a week has actually passed, so a member who joined this week sees no banner at all.
 */

const FUND_LABELS = {
  development_fund: "Development Fund",
  social_fund: "Social Fund"
};

// The same colours these two pools carry everywhere else in the app.
const FUND_COLORS = {
  development_fund: "#10b981",
  social_fund: "#ef4444"
};

export default function MemberDuesAlertBanner() {
  const [dues, setDues] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDues() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch("/api/dues", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store"
        });
        if (!res.ok) return;

        const data = await res.json();
        // A member's own row is the only one RLS gave them, but an admin viewing their own
        // dashboard gets the whole SACCO back -- so pick out this user rather than trusting
        // position.
        const mine = (data.rows || []).find(
          (row) => String(row.profileId) === String(session.user.id)
        );
        setDues(mine || null);
      } catch (err) {
        // A banner that cannot load is a banner that does not render. Never block the dashboard.
        console.warn("Failed to load member dues:", err);
      } finally {
        setLoading(false);
      }
    }

    loadDues();

    if (typeof window === "undefined") return;

    // Approving a contribution changes what is owed, and so does an admin changing the
    // weekly amounts. Both already broadcast on these events.
    const handleUpdate = () => loadDues();
    window.addEventListener("sacco_transaction_updated", handleUpdate);
    window.addEventListener("sacco_settings_updated", handleUpdate);
    return () => {
      window.removeEventListener("sacco_transaction_updated", handleUpdate);
      window.removeEventListener("sacco_settings_updated", handleUpdate);
    };
  }, []);

  if (loading || !dues || !dues.totalOwed) return null;

  const behindFunds = Object.entries(dues.funds || {}).filter(([, f]) => f.owed > 0);

  return (
    <div style={{
      background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
      border: "1px solid #fde68a",
      borderRadius: "1.6rem",
      padding: "1.6rem 2rem",
      marginBottom: "2rem",
      boxShadow: "0 4px 14px rgba(245, 158, 11, 0.12)",
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
          background: "#f59e0b",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "2rem",
          flexShrink: 0
        }}>
          <i className="fa-solid fa-calendar-xmark"></i>
        </div>

        <div>
          <h4 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#92400e", marginBottom: "0.2rem" }}>
            Weekly Fund Contributions Outstanding
          </h4>

          <p style={{ fontSize: "1.3rem", color: "#78350f", lineHeight: 1.5 }}>
            {behindFunds.map(([fund, f], idx) => (
              <span key={fund}>
                {idx > 0 && " and "}
                <strong style={{ color: FUND_COLORS[fund] || "#92400e" }}>
                  {f.weeksBehind} {f.weeksBehind === 1 ? "week" : "weeks"}
                </strong>
                {" behind on "}
                {FUND_LABELS[fund] || fund}
                {" (UGX "}{f.owed.toLocaleString()}{")"}
              </span>
            ))}
            . These are mandatory every meeting week.
          </p>

          {/* A member who has already paid should not be told to pay again. */}
          {dues.totalPending > 0 && (
            <p style={{ fontSize: "1.2rem", color: "#a16207", marginTop: "0.4rem" }}>
              <i className="fa-solid fa-clock" style={{ marginRight: "0.5rem" }}></i>
              UGX {dues.totalPending.toLocaleString()} you have submitted is awaiting admin
              verification and will reduce this once approved.
            </p>
          )}

          {/* The figure is an assumption when nobody has stated when this member joined and
              there is nothing on file for them. Saying so is the difference between a
              reminder and a false accusation, and it tells them what to ask their admin for. */}
          {dues.startSource === "assumed" && (
            <p style={{ fontSize: "1.2rem", color: "#a16207", marginTop: "0.4rem" }}>
              <i className="fa-solid fa-circle-info" style={{ marginRight: "0.5rem" }}></i>
              No contributions are recorded for you yet and your join date has not been set, so
              this is counted from the SACCO&apos;s Week 1. Speak to your admin if that is not
              right.
            </p>
          )}
        </div>
      </div>

      <div style={{
        background: "white",
        padding: "0.8rem 1.6rem",
        borderRadius: "1rem",
        border: "1px solid #fcd34d",
        textAlign: "right"
      }}>
        <span style={{ fontSize: "1.15rem", color: "#92400e", display: "block", fontWeight: 600 }}>
          Total Due
        </span>
        <strong style={{ fontSize: "1.8rem", color: "#d97706" }}>
          UGX {dues.totalOwed.toLocaleString()}
        </strong>
      </div>
    </div>
  );
}
