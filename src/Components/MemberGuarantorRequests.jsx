"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

export default function MemberGuarantorRequests() {
  const [profileId, setProfileId] = useState("");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);

  useEffect(() => {
    async function loadUserSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;

        setProfileId(session.user.id);
        fetchGuarantorRequests(session.user.id);
      } catch (err) {
        console.warn("Failed to load user session for Guarantor Requests:", err);
      } finally {
        setLoading(false);
      }
    }

    loadUserSession();
  }, []);

  const fetchGuarantorRequests = async (pId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`/api/loans/guarantors?profile_id=${pId}&status=pending`, {
        headers: { "Authorization": `Bearer ${session.access_token}` },
        cache: "no-store"
      });
      const result = await res.json();

      if (!res.ok) throw new Error(result.error || "Could not load your guarantee requests");

      setRequests(result.requests || []);
    } catch (err) {
      // Surfaced rather than logged: a guarantor who cannot see a request they were
      // asked to sign needs to know the list failed, not assume nobody asked.
      setStatusMessage({ type: "error", text: err.message });
    }
  };

  const handleResponse = async (guarantorId, responseChoice) => {
    setProcessingId(guarantorId);
    setStatusMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch("/api/loans/guarantors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "respond",
          guarantor_id: guarantorId,
          response: responseChoice
        })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Failed to submit response");

      setStatusMessage({
        type: responseChoice === "approved" ? "success" : "info",
        text: result.result?.message || `Successfully recorded your decision (${responseChoice}).`
      });

      fetchGuarantorRequests(profileId);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sacco_transaction_updated"));
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: "Response failed: " + err.message });
    } finally {
      setProcessingId(null);
    }
  };

  // A member with genuinely nothing to sign should not see an empty card, but a failed
  // load or a just-recorded decision must still be able to say so -- returning null on
  // an empty list alone swallowed both.
  if (loading) return null;
  if (requests.length === 0 && !statusMessage) return null;

  return (
    <div style={{ background: "#ffffff", borderRadius: "1.6rem", padding: "2.5rem", boxShadow: "0 0.4rem 2rem rgba(0,0,0,0.02)", border: "1px solid #f1f5f9", marginBottom: "2rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.6rem" }}>
        <div style={{ width: "3.6rem", height: "3.6rem", borderRadius: "50%", backgroundColor: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="fa-solid fa-user-shield" style={{ color: "#253b8e", fontSize: "1.6rem" }}></i>
        </div>
        <div>
          <h3 style={{ fontSize: "1.8rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Pending Peer Loan Guarantee Requests
          </h3>
          <p style={{ fontSize: "1.2rem", color: "#64748b", margin: "0.2rem 0 0" }}>
            Fellow SACCO members have requested your sign-off to guarantee their loan application.
          </p>
        </div>
      </div>

      {statusMessage && (
        <div style={{ padding: "1rem 1.4rem", borderRadius: "0.8rem", fontSize: "1.2rem", fontWeight: 600, marginBottom: "1.6rem", backgroundColor: statusMessage.type === "error" ? "#fee2e2" : statusMessage.type === "success" ? "#d1fae5" : "#e0e7ff", color: statusMessage.type === "error" ? "#dc2626" : statusMessage.type === "success" ? "#047857" : "#3730a3" }}>
          {statusMessage.text}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.5rem" }}>
        {requests.map((req) => {
          const borrowerName = req.borrower?.full_name || "SACCO Member";
          const borrowerNumber = req.borrower?.member_number || "MEM-000";
          // `loans` has no `amount` column; the request used to select one, which made
          // PostgREST reject the whole query and this list come back permanently empty.
          const loanAmount = Number(req.loan?.amount_requested || req.guaranteed_amount || 0);
          const term = req.loan?.term_months || 12;

          return (
            <div key={req.id} style={{ background: "#f8fafc", borderRadius: "1.2rem", border: "1px solid #cbd5e1", padding: "1.8rem", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <span style={{ fontSize: "1.2rem", fontWeight: 700, color: "#253b8e" }}>{borrowerNumber}</span>
                  <span style={{ fontSize: "1.1rem", fontWeight: 700, backgroundColor: "#fef3c7", color: "#b45309", padding: "0.3rem 0.8rem", borderRadius: "0.4rem" }}>
                    Pending Your Guarantee
                  </span>
                </div>

                <h4 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0f172a", margin: "0 0 0.6rem" }}>{borrowerName}</h4>
                
                <div style={{ fontSize: "1.3rem", color: "#475569", marginBottom: "1.2rem" }}>
                  Requesting <strong>UGX {loanAmount.toLocaleString()}</strong> over <strong>{term} Months</strong>
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                <button
                  onClick={() => handleResponse(req.id, "approved")}
                  disabled={processingId === req.id}
                  style={{ flex: 1, padding: "0.9rem", borderRadius: "0.8rem", border: "none", backgroundColor: "#10b981", color: "#ffffff", fontWeight: 700, fontSize: "1.2rem", cursor: "pointer" }}
                >
                  {processingId === req.id ? "Processing..." : "✓ Accept & Guarantee"}
                </button>

                <button
                  onClick={() => handleResponse(req.id, "rejected")}
                  disabled={processingId === req.id}
                  style={{ flex: 1, padding: "0.9rem", borderRadius: "0.8rem", border: "1px solid #fca5a5", backgroundColor: "#ffffff", color: "#ef4444", fontWeight: 700, fontSize: "1.2rem", cursor: "pointer" }}
                >
                  ✕ Decline
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
