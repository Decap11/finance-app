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

  async function fetchBalances() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("/api/user-balances", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`
        },
        cache: "no-store"
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
          let cat = (acc.account_type || '').toLowerCase();
          if (cat === 'devt' || cat === 'devt_fund' || cat === 'development') cat = 'development_fund';
          if (cat === 'social' || cat === 'social_fund') cat = 'social_fund';
          if (cat === 'savings' || cat === 'shares_pool') cat = 'shares';

          if (newBalances[cat] !== undefined) {
            newBalances[cat] = Number(acc.balance) || 0;
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

  useEffect(() => {
    fetchBalances();

    // Subscribe to real-time database changes on the transactions and accounts tables
    const channel = supabase
      .channel('user-summary-cards-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        () => {
          fetchBalances();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'accounts'
        },
        () => {
          fetchBalances();
        }
      )
      .subscribe();

    function handleTransactionUpdate() {
      fetchBalances();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_transaction_updated", handleTransactionUpdate);
      window.addEventListener("manual_contribution_logged", handleTransactionUpdate);
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_transaction_updated", handleTransactionUpdate);
        window.removeEventListener("manual_contribution_logged", handleTransactionUpdate);
      }
    };
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
