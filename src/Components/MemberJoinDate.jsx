"use client";

import { useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * The date a member joined the SACCO, editable in place on their card.
 *
 * This is the fact the whole arrears calculation rests on. Without it
 * src/utils/duesEngine.js has to infer a start from the member's earliest record, and that
 * inference cannot tell "joined in week 20" from "was here since week 1 and paid nothing
 * until week 20" -- so it forgives the unpaid weeks. Stating the date closes that, which is
 * why the field says plainly which of the two the member is currently on.
 *
 * Clearing it is a first-class action, not an edge case: it is the undo for a mistyped date,
 * and it hands the member back to the inference rather than leaving a wrong fact in place.
 */
export default function MemberJoinDate({ member, onSaved }) {
  const [value, setValue] = useState(member.joinedOn || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const stated = Boolean(member.joinedOn);
  const today = new Date().toISOString().slice(0, 10);

  async function save(next) {
    setBusy(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");

      const res = await fetch("/api/admin/join-dates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ memberId: member.id, joinedOn: next || null })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the join date.");

      setValue(next || "");
      // Everything that counts arrears has just changed for this member.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sacco_transaction_updated"));
      }
      if (onSaved) onSaved();
    } catch (err) {
      // Put the field back to what the database still holds, so what is on screen is never a
      // date that was not saved.
      setValue(member.joinedOn || "");
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.8rem" }}>
        <span style={{ fontSize: "1.2rem", color: "var(--text-light)", fontWeight: 500 }}>
          Joined SACCO
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input
            type="date"
            value={value}
            max={today}
            disabled={busy}
            onChange={(e) => save(e.target.value)}
            style={{
              fontSize: "1.2rem",
              padding: "0.3rem 0.5rem",
              borderRadius: "0.5rem",
              border: `0.1rem solid ${stated ? "#bbf7d0" : "var(--border-color, #e2e8f0)"}`,
              background: stated ? "#f0fdf4" : "var(--bg-light, #f8fafc)",
              color: "var(--text-dark)",
              fontWeight: 600
            }}
          />
          {stated && (
            <button
              type="button"
              onClick={() => save(null)}
              disabled={busy}
              title="Clear the date and go back to inferring it from their first record"
              style={{
                background: "none",
                border: "none",
                color: "#94a3b8",
                fontSize: "1.3rem",
                cursor: "pointer",
                padding: "0.2rem 0.3rem",
                lineHeight: 1
              }}
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          )}
        </div>
      </div>

      <div style={{ fontSize: "1.05rem", color: error ? "#ef4444" : "#94a3b8", textAlign: "right" }}>
        {busy
          ? "Saving…"
          : error
            ? error
            : stated
              ? "Dues counted from this date"
              : "Not set — dues counted from their first record"}
      </div>
    </div>
  );
}
