"use client";

import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { subscribeToOwnRows } from "../utils/realtimeScope";
import CustomSelect from "./CustomSelect";

const VAULT_CATEGORY_OPTIONS = [
  { value: "education", label: "Education / School Fees" },
  { value: "agriculture", label: "Agriculture & Land" },
  { value: "business", label: "Business Investment" },
  { value: "emergency", label: "Emergency Fund" },
  { value: "general", label: "General Savings" }
];

export default function MemberSavingsVaults() {
  const [profileId, setProfileId] = useState("");
  const [saccoId, setSaccoId] = useState("");

  const [vaults, setVaults] = useState([]);
  const [loading, setLoading] = useState(true);

  // New Vault Modal
  const [showModal, setShowModal] = useState(false);
  const [vaultName, setVaultName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [category, setCategory] = useState("general");
  const [targetDate, setTargetDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Deposit Modal
  const [depositVault, setDepositVault] = useState(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositing, setDepositing] = useState(false);

  const [statusMessage, setStatusMessage] = useState(null);

  useEffect(() => {
    async function loadMemberInfo() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;

        setProfileId(session.user.id);

        const { data: profile } = await supabase
          .from("profiles")
          .select("group_id")
          .eq("id", session.user.id)
          .single();

        if (profile?.group_id) {
          const { data: sacco } = await supabase
            .from("saccos")
            .select("id")
            .ilike("group_code", profile.group_id.trim())
            .maybeSingle();

          if (sacco) {
            setSaccoId(sacco.id);
            fetchVaults(session.user.id, sacco.id);
          }
        }
      } catch (err) {
        console.warn("Failed to load member info for Vaults:", err);
      } finally {
        setLoading(false);
      }
    }

    loadMemberInfo();
  }, []);

  // A function declaration, not a const arrow: the effect above calls this before this line
  // is reached, and only an intervening await keeps that out of the temporal dead zone. That
  // is a runtime ReferenceError waiting for someone to remove an await, so the declaration is
  // hoisted instead of relying on the timing.
  async function fetchVaults(pId, sId) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`/api/user-vaults?profile_id=${pId}&sacco_id=${sId}`, {
        headers: { "Authorization": `Bearer ${session.access_token}` }
      });
      const result = await res.json();
      if (result.success) {
        setVaults(result.vaults || []);
      }
    } catch (err) {
      console.warn("Failed to fetch member vaults:", err);
    }
  }

  // This component used to load once on mount and never again, so a member sitting on
  // this screen saw nothing until they refreshed. It dispatches
  // `sacco_transaction_updated` but never listened for one, and a window event would not
  // have been enough anyway: an admin backfilling records (or approving anything) is in a
  // different browser session entirely, and realtime is the only channel that crosses it.
  useEffect(() => {
    if (!profileId || !saccoId) return;

    const refresh = () => fetchVaults(profileId, saccoId);

    // A member's vaults are built from their own rows only.
    const unsubscribe = subscribeToOwnRows(
      ["transactions", "accounts"],
      refresh,
      "member-vaults"
    );

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_transaction_updated", refresh);
      window.addEventListener("manual_contribution_logged", refresh);
    }

    return () => {
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_transaction_updated", refresh);
        window.removeEventListener("manual_contribution_logged", refresh);
      }
    };
  }, [profileId, saccoId]);

  const handleCreateVault = async (e) => {
    e.preventDefault();
    if (!vaultName || !targetAmount || Number(targetAmount) <= 0) return;

    setSubmitting(true);
    setStatusMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch("/api/user-vaults", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "create",
          profile_id: profileId,
          sacco_id: saccoId,
          vault_name: vaultName,
          target_amount: Number(targetAmount),
          category,
          target_date: targetDate || null
        })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Creation failed");

      setStatusMessage({ type: "success", text: `Successfully created Piggybank Vault "${vaultName}"!` });
      setShowModal(false);
      setVaultName("");
      setTargetAmount("");
      setTargetDate("");
      fetchVaults(profileId, saccoId);
    } catch (err) {
      setStatusMessage({ type: "error", text: "Failed to create vault: " + err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    if (!depositVault || !depositAmount || Number(depositAmount) <= 0) return;

    setDepositing(true);
    setStatusMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch("/api/user-vaults", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "deposit",
          profile_id: profileId,
          sacco_id: saccoId,
          vault_id: depositVault.id,
          amount: Number(depositAmount)
        })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Deposit failed");

      setStatusMessage({ type: "success", text: `Successfully deposited UGX ${Number(depositAmount).toLocaleString()} into "${depositVault.vault_name}"!` });
      setDepositVault(null);
      setDepositAmount("");
      fetchVaults(profileId, saccoId);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sacco_transaction_updated"));
      }
    } catch (err) {
      setStatusMessage({ type: "error", text: "Deposit failed: " + err.message });
    } finally {
      setDepositing(false);
    }
  };

  if (loading) return null;

  return (
    <div style={{ background: "#ffffff", borderRadius: "1.6rem", padding: "2.5rem", boxShadow: "0 0.4rem 2rem rgba(0,0,0,0.02)", border: "1px solid #f1f5f9", marginBottom: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h3 style={{ fontSize: "1.8rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
            <i className="fa-solid fa-piggy-bank" style={{ color: "#ec4899", marginRight: "0.8rem" }}></i>
            Goal-Based Piggybank Target Savings
          </h3>
          <p style={{ fontSize: "1.2rem", color: "#64748b", margin: "0.4rem 0 0" }}>
            Earmark funds towards specific milestone goals (School Fees, Land, Emergency Reserve).
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          style={{ padding: "0.9rem 1.6rem", borderRadius: "0.8rem", border: "none", backgroundColor: "#253b8e", color: "#ffffff", fontWeight: 700, fontSize: "1.2rem", cursor: "pointer" }}
        >
          <i className="fa-solid fa-plus" style={{ marginRight: "0.6rem" }}></i>
          Create New Vault
        </button>
      </div>

      {statusMessage && (
        <div style={{ padding: "1rem 1.4rem", borderRadius: "0.8rem", fontSize: "1.2rem", fontWeight: 600, marginBottom: "1.6rem", backgroundColor: statusMessage.type === "error" ? "#fee2e2" : "#d1fae5", color: statusMessage.type === "error" ? "#dc2626" : "#047857" }}>
          {statusMessage.text}
        </div>
      )}

      {/* Vault Cards Grid */}
      {vaults.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 1rem", background: "#f8fafc", borderRadius: "1.2rem", border: "1px dashed #cbd5e1", color: "#64748b", fontSize: "1.3rem" }}>
          <i className="fa-solid fa-vault" style={{ fontSize: "3rem", color: "#94a3b8", marginBottom: "1rem" }}></i>
          <p style={{ margin: 0, fontWeight: 600 }}>No Target Savings Vaults created yet.</p>
          <span style={{ fontSize: "1.2rem", color: "#94a3b8" }}>Click "Create New Vault" to set your first savings goal!</span>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "2rem" }}>
          {vaults.map((vault) => {
            const current = Number(vault.current_balance || 0);
            const target = Number(vault.target_amount || 1);
            const percent = Math.min(100, Math.round((current / target) * 100));

            return (
              <div key={vault.id} style={{ background: "#f8fafc", borderRadius: "1.2rem", border: "1px solid #e2e8f0", padding: "2rem", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <span style={{ fontSize: "1.1rem", fontWeight: 700, textTransform: "uppercase", padding: "0.4rem 0.8rem", borderRadius: "0.4rem", backgroundColor: vault.status === "completed" ? "#d1fae5" : "#e0e7ff", color: vault.status === "completed" ? "#047857" : "#3730a3" }}>
                      {vault.status === "completed" ? "Goal Completed!" : vault.category}
                    </span>
                    {vault.target_date && (
                      <span style={{ fontSize: "1.1rem", color: "#64748b" }}>
                        <i className="fa-regular fa-calendar" style={{ marginRight: "0.4rem" }}></i>
                        {new Date(vault.target_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>

                  <h4 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0f172a", margin: "0 0 0.8rem" }}>{vault.vault_name}</h4>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem" }}>
                    <span style={{ fontSize: "1.8rem", fontWeight: 800, color: "#10b981" }}>
                      UGX {current.toLocaleString()}
                    </span>
                    <span style={{ fontSize: "1.2rem", color: "#64748b", fontWeight: 600 }}>
                      Target: UGX {target.toLocaleString()}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div style={{ width: "100%", height: "0.8rem", backgroundColor: "#e2e8f0", borderRadius: "1rem", overflow: "hidden", marginBottom: "0.8rem" }}>
                    <div style={{ width: `${percent}%`, height: "100%", backgroundColor: percent >= 100 ? "#10b981" : "#253b8e", transition: "width 0.4s ease" }}></div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "1.1rem", fontWeight: 700, color: "#475569" }}>
                    {percent}% Reached
                  </div>
                </div>

                <div style={{ marginTop: "1.6rem" }}>
                  <button
                    onClick={() => setDepositVault(vault)}
                    disabled={vault.status === "completed"}
                    style={{
                      width: "100%",
                      padding: "0.9rem",
                      borderRadius: "0.8rem",
                      border: "none",
                      backgroundColor: vault.status === "completed" ? "#cbd5e1" : "#10b981",
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: "1.2rem",
                      cursor: vault.status === "completed" ? "not-allowed" : "pointer"
                    }}
                  >
                    {vault.status === "completed" ? "Goal Achieved 🎉" : "+ Deposit Funds"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create Vault */}
      {showModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(15, 23, 42, 0.6)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999 }}>
          <div style={{ background: "#ffffff", padding: "2.5rem", borderRadius: "1.6rem", width: "90%", maxWidth: "450px", boxShadow: "0 1rem 3rem rgba(0,0,0,0.2)" }}>
            <h3 style={{ fontSize: "1.8rem", fontWeight: 800, color: "#0f172a", marginBottom: "1.5rem" }}>Create Target Savings Vault</h3>

            <form onSubmit={handleCreateVault}>
              <div style={{ marginBottom: "1.4rem" }}>
                <label style={{ display: "block", fontSize: "1.2rem", fontWeight: 700, color: "#334155", marginBottom: "0.6rem" }}>Vault Name</label>
                <input
                  type="text"
                  placeholder="e.g. School Fees Dec 2026"
                  value={vaultName}
                  onChange={(e) => setVaultName(e.target.value)}
                  required
                  style={{ width: "100%", padding: "1rem 1.2rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", fontSize: "1.3rem" }}
                />
              </div>

              <div style={{ marginBottom: "1.4rem" }}>
                <label style={{ display: "block", fontSize: "1.2rem", fontWeight: 700, color: "#334155", marginBottom: "0.6rem" }}>Target Amount (UGX)</label>
                <input
                  type="number"
                  placeholder="e.g. 1500000"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  required
                  style={{ width: "100%", padding: "1rem 1.2rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", fontSize: "1.3rem" }}
                />
              </div>

              <div style={{ marginBottom: "1.4rem" }}>
                <label style={{ display: "block", fontSize: "1.2rem", fontWeight: 700, color: "#334155", marginBottom: "0.6rem" }}>Category</label>
                <CustomSelect
                  value={category}
                  options={VAULT_CATEGORY_OPTIONS}
                  onChange={(val) => setCategory(val)}
                />
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", fontSize: "1.2rem", fontWeight: 700, color: "#334155", marginBottom: "0.6rem" }}>Target Maturity Date (Optional)</label>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  style={{ width: "100%", padding: "1rem 1.2rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", fontSize: "1.3rem" }}
                />
              </div>

              <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{ padding: "0.9rem 1.6rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", backgroundColor: "#ffffff", color: "#475569", fontWeight: 700, cursor: "pointer" }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: "0.9rem 1.8rem", borderRadius: "0.8rem", border: "none", backgroundColor: "#253b8e", color: "#ffffff", fontWeight: 700, cursor: "pointer" }}
                >
                  {submitting ? "Creating..." : "Save Vault"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Deposit to Vault */}
      {depositVault && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(15, 23, 42, 0.6)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999 }}>
          <div style={{ background: "#ffffff", padding: "2.5rem", borderRadius: "1.6rem", width: "90%", maxWidth: "400px", boxShadow: "0 1rem 3rem rgba(0,0,0,0.2)" }}>
            <h3 style={{ fontSize: "1.8rem", fontWeight: 800, color: "#0f172a", marginBottom: "0.6rem" }}>Deposit to Vault</h3>
            <p style={{ fontSize: "1.3rem", color: "#64748b", marginBottom: "1.5rem" }}>{depositVault.vault_name}</p>

            <form onSubmit={handleDeposit}>
              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", fontSize: "1.2rem", fontWeight: 700, color: "#334155", marginBottom: "0.6rem" }}>Deposit Amount (UGX)</label>
                <input
                  type="number"
                  placeholder="e.g. 50000"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  required
                  autoFocus
                  style={{ width: "100%", padding: "1rem 1.2rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", fontSize: "1.3rem" }}
                />
              </div>

              <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setDepositVault(null)}
                  style={{ padding: "0.9rem 1.6rem", borderRadius: "0.8rem", border: "1px solid #cbd5e1", backgroundColor: "#ffffff", color: "#475569", fontWeight: 700, cursor: "pointer" }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={depositing}
                  style={{ padding: "0.9rem 1.8rem", borderRadius: "0.8rem", border: "none", backgroundColor: "#10b981", color: "#ffffff", fontWeight: 700, cursor: "pointer" }}
                >
                  {depositing ? "Processing..." : "Confirm Deposit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
