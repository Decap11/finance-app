import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { useToast } from "../context/ToastContext";
import "../styles/UserProgressTracker.css";

export default function UserProgressTracker() {
  const [loading, setLoading] = useState(true);
  const { showError, showSuccess } = useToast();
  const [balances, setBalances] = useState({
    shares: 0,
    development_fund: 0,
    social_fund: 0,
  });

  const [settings, setSettings] = useState({
    sharePrice: 5000,
    devtFund: 1000,
    socialFund: 2000,
  });

  // Custom saving targets state
  const [customTargets, setCustomTargets] = useState({
    shares: 50000,
    devt: 10000,
    social: 10000,
  });

  // Form edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editShares, setEditShares] = useState("");
  const [editDevt, setEditDevt] = useState("");
  const [editSocial, setEditSocial] = useState("");
  const [savingTargets, setSavingTargets] = useState(false);

  async function loadData() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Fetch balances
      const balanceRes = await fetch("/api/user-balances", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`
        }
      });
      const balanceData = await balanceRes.json();
      
      let fetchedBalances = { shares: 0, development_fund: 0, social_fund: 0 };
      if (balanceRes.ok && balanceData.accounts) {
        balanceData.accounts.forEach((acc) => {
          if (acc.account_type in fetchedBalances) {
            fetchedBalances[acc.account_type] = Number(acc.balance) || 0;
          }
        });
      }

      // Fetch settings
      const settingsRes = await fetch("/api/sacco-settings");
      const settingsData = await settingsRes.json();
      
      let currentSharePrice = 5000;
      let currentDevtFund = 1000;
      let currentSocialFund = 2000;

      if (settingsRes.ok && settingsData) {
        currentSharePrice = Number(settingsData.sharePrice) || 5000;
        currentDevtFund = Number(settingsData.devtFund) || 1000;
        currentSocialFund = Number(settingsData.socialFund) || 2000;
        setSettings({
          sharePrice: currentSharePrice,
          devtFund: currentDevtFund,
          socialFund: currentSocialFund,
        });
      }

      // Fetch custom targets from profile table
      const { data: profileData } = await supabase
        .from('profiles')
        .select('shares_target, devt_target, social_target')
        .eq('id', session.user.id)
        .single();

      if (profileData) {
        setCustomTargets({
          shares: profileData.shares_target !== null ? Number(profileData.shares_target) : (10 * currentSharePrice),
          devt: profileData.devt_target !== null ? Number(profileData.devt_target) : (10 * currentDevtFund),
          social: profileData.social_target !== null ? Number(profileData.social_target) : (5 * currentSocialFund),
        });
      } else {
        setCustomTargets({
          shares: 10 * currentSharePrice,
          devt: 10 * currentDevtFund,
          social: 5 * currentSocialFund,
        });
      }

      setBalances(fetchedBalances);
    } catch (err) {
      console.warn("Error loading progress tracker data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();

    // Subscribe to transactions real-time channel to reload progress tracker on approvals
    const channel = supabase
      .channel('progress-tracker-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        () => {
          loadData();
        }
      )
      .subscribe();

    function handleUpdate() {
      loadData();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_transaction_updated", handleUpdate);
      window.addEventListener("manual_contribution_logged", handleUpdate);
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_transaction_updated", handleUpdate);
        window.removeEventListener("manual_contribution_logged", handleUpdate);
      }
    };
  }, []);

  const handleStartEdit = () => {
    setEditShares(customTargets.shares.toString());
    setEditDevt(customTargets.devt.toString());
    setEditSocial(customTargets.social.toString());
    setIsEditing(true);
  };

  const handleSaveTargets = async (e) => {
    e.preventDefault();
    setSavingTargets(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const newSharesTarget = Number(editShares) || 0;
      const newDevtTarget = Number(editDevt) || 0;
      const newSocialTarget = Number(editSocial) || 0;

      const { error } = await supabase
        .from('profiles')
        .update({
          shares_target: newSharesTarget,
          devt_target: newDevtTarget,
          social_target: newSocialTarget,
          updated_at: new Date().toISOString()
        })
        .eq('id', session.user.id);

      if (error) throw error;

      setCustomTargets({
        shares: newSharesTarget,
        devt: newDevtTarget,
        social: newSocialTarget,
      });
      setIsEditing(false);
      showSuccess("Financial goal targets updated successfully!");
    } catch (err) {
      showError("Failed to save targets: " + err.message);
    } finally {
      setSavingTargets(false);
    }
  };

  // Compute values
  const sharesTarget = customTargets.shares;
  const devtTarget = customTargets.devt;
  const socialTarget = customTargets.social;

  const sharesPercent = sharesTarget > 0 ? Math.round((balances.shares / sharesTarget) * 100) : 0;
  const devtPercent = devtTarget > 0 ? Math.round((balances.development_fund / devtTarget) * 100) : 0;
  const socialPercent = socialTarget > 0 ? Math.round((balances.social_fund / socialTarget) * 100) : 0;

  const totalContributed = balances.shares + balances.development_fund + balances.social_fund;
  const totalTarget = sharesTarget + devtTarget + socialTarget;
  const remainingTarget = Math.max(0, totalTarget - totalContributed);

  return (
    <>
      {/* Contribution Progress Tracker */}
      <div className="progress-tracker">
        <div className="section-header" style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="section-title" style={{ fontSize: "16px", margin: 0 }}>
            Contribution Progress
          </h3>
          {!loading && !isEditing && (
            <button className="targets-edit-btn" onClick={handleStartEdit}>
              <i className="fa-solid fa-pen-to-square"></i> Set Targets
            </button>
          )}
        </div>

        {isEditing ? (
          <form className="targets-edit-form" onSubmit={handleSaveTargets}>
            <div className="target-input-group">
              <label>Shares Pool Target (UGX)</label>
              <input
                type="number"
                placeholder="e.g. 50000"
                value={editShares}
                onChange={(e) => setEditShares(e.target.value)}
                required
              />
            </div>
            <div className="target-input-group">
              <label>Development Fund Target (UGX)</label>
              <input
                type="number"
                placeholder="e.g. 10000"
                value={editDevt}
                onChange={(e) => setEditDevt(e.target.value)}
                required
              />
            </div>
            <div className="target-input-group">
              <label>Social Fund Target (UGX)</label>
              <input
                type="number"
                placeholder="e.g. 10000"
                value={editSocial}
                onChange={(e) => setEditSocial(e.target.value)}
                required
              />
            </div>
            <div className="targets-form-actions">
              <button type="button" className="targets-cancel-btn" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
              <button type="submit" className="targets-save-btn" disabled={savingTargets}>
                {savingTargets ? "Saving..." : "Save Targets"}
              </button>
            </div>
          </form>
        ) : (
          <div className="progress-content">
            <div className="progress-item">
              <div className="progress-header">
                <span className="progress-name">Shares Pool</span>
                <span className="progress-percent">{loading ? "..." : `${sharesPercent}%`}</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.min(100, sharesPercent)}%`, backgroundColor: "#253b8e" }}
                ></div>
              </div>
              <p className="progress-info">
                Shs {loading ? "..." : balances.shares.toLocaleString()} / Shs {loading ? "..." : sharesTarget.toLocaleString()} target
              </p>
            </div>

            <div className="progress-item">
              <div className="progress-header">
                <span className="progress-name">Development Fund</span>
                <span className="progress-percent">{loading ? "..." : `${devtPercent}%`}</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.min(100, devtPercent)}%`, backgroundColor: "#10b981" }}
                ></div>
              </div>
              <p className="progress-info">
                Shs {loading ? "..." : balances.development_fund.toLocaleString()} / Shs {loading ? "..." : devtTarget.toLocaleString()} target
              </p>
            </div>

            <div className="progress-item">
              <div className="progress-header">
                <span className="progress-name">Social Fund</span>
                <span className="progress-percent">{loading ? "..." : `${socialPercent}%`}</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.min(100, socialPercent)}%`, backgroundColor: "#ef4444" }}
                ></div>
              </div>
              <p className="progress-info">
                Shs {loading ? "..." : balances.social_fund.toLocaleString()} / Shs {loading ? "..." : socialTarget.toLocaleString()} target
              </p>
            </div>

            <div className="progress-summary">
              <div className="summary-item">
                <span>Total Contributed</span>
                <strong>Shs {loading ? "..." : totalContributed.toLocaleString()}</strong>
              </div>
              <div className="summary-item">
                <span>Remaining Target</span>
                <strong>Shs {loading ? "..." : remainingTarget.toLocaleString()}</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
