import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/summary-cards-row.css";

export default function SavingsSummaryCards() {
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState({
    shares: 0,
    development_fund: 0,
    social_fund: 0,
    savings: 0,
  });

  useEffect(() => {
    async function fetchBalances() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('accounts')
        .select('account_type, balance')
        .eq('profile_id', user.id);

      if (data && !error) {
        const newBalances = { ...balances };
        data.forEach((acc) => {
          newBalances[acc.account_type] = acc.balance;
        });
        setBalances(newBalances);
      }
      setLoading(false);
    }
    fetchBalances();
  }, []);

  const totalCapital = balances.shares + balances.development_fund + balances.social_fund + balances.savings;

  return (
    <section className="summary-cards">
      <div className="card">
        <div className="card-header">
          <span className="card-title">My Total SACCO Assets</span>
          <div
            className="card-icon"
            style={{ color: "#ff9800", backgroundColor: "#ff98001a" }}
          >
            <i className="fa-solid fa-building-columns"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> {loading ? "..." : totalCapital.toLocaleString()}
        </div>
        <div className="card-change">
          <i className="fa-solid fa-arrow-trend-up change-positive"></i>
          <span className="change-positive">+0.0%</span>
          <span>this week</span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">My Shares Total</span>
          <div
            className="card-icon"
            style={{
              color: "#253b8e",
              backgroundColor: "#ebf0fe",
            }}
          >
            <i className="fa-solid fa-chart-pie"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> {loading ? "..." : balances.shares.toLocaleString()}
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>
            Total Shares Value
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">My Development Fund</span>
          <div
            className="card-icon"
            style={{
              color: "#10b981",
              backgroundColor: "rgba(16, 185, 129, 0.1)",
            }}
          >
            <i className="fa-solid fa-seedling"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> {loading ? "..." : balances.development_fund.toLocaleString()}
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>Steady weekly growth</span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">My Social Fund</span>
          <div
            className="card-icon"
            style={{
              color: "#ef4444",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
            }}
          >
            <i className="fa-solid fa-handshake-angle"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> {loading ? "..." : balances.social_fund.toLocaleString()}
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>Available for member support</span>
        </div>
      </div>
    </section>
  );
}
