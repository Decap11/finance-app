import "../styles/summary-cards-row.css";

import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";

export default function UserSummaryCards() {
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState({
    shares: 0,
    development_fund: 0,
    social_fund: 0,
  });

  useEffect(() => {
    async function fetchBalances() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch("/api/user-balances", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.accounts) {
          const newBalances = {
            shares: 0,
            development_fund: 0,
            social_fund: 0,
          };
          data.accounts.forEach((acc) => {
            if (newBalances[acc.account_type] !== undefined) {
              newBalances[acc.account_type] = acc.balance;
            }
          });
          setBalances(newBalances);
        }
      } catch (err) {
        console.warn("Error loading user balances:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchBalances();
  }, []);

  const totalCapital =
    balances.shares +
    balances.development_fund +
    balances.social_fund;

  return (
    <section className="summary-cards">
      <Card
        title="My Total SACCO Capital"
        backgroundColor={"#f59e0b1a"}
        color={"#f59e0b"}
        icon="fa-solid fa-chart-pie"
        info={loading ? "..." : totalCapital.toLocaleString()}
        subInfo="Total capital value"
      />
      <Card
        title="My Shares Value"
        backgroundColor="#ebf0fe"
        color="#253b8e"
        icon="fa-solid fa-chart-pie"
        info={loading ? "..." : balances.shares.toLocaleString()}
        subInfo="Total shares value"
      />

      <Card
        title="Development Fund"
        backgroundColor="#10b9811a"
        color="#10b981"
        icon="fa-solid fa-seedling"
        info={loading ? "..." : balances.development_fund.toLocaleString()}
        subInfo="Total Development funds"
      />
      <Card
        title="Social Fund"
        backgroundColor="#ef44441a"
        color="#ef4444"
        icon="fa-solid fa-handshake-angle"
        info={loading ? "..." : balances.social_fund.toLocaleString()}
        subInfo="Total Social funds"
      />
    </section>
  );
}
function Card({ title, icon, info, subInfo, color, backgroundColor }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        <div
          className="card-icon"
          style={{
            color: color,
            backgroundColor: backgroundColor,
          }}
        >
          <i className={icon}></i>
        </div>
      </div>
      <div className="card-amount">
        <span>Ugx </span>
        {info}
      </div>
      <p className="subInfo">{subInfo}</p>
    </div>
  );
}
