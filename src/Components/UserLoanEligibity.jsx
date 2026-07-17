import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../supabaseClient.js";
import "../styles/UserLoanEligibity.css";

export default function UserLoanEligibity() {
  const [loading, setLoading] = useState(true);
  const [sharesBalance, setSharesBalance] = useState(0);

  useEffect(() => {
    async function fetchSharesBalance() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch("/api/user-balances", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();
        if (res.ok && data.accounts) {
          const sharesAcc = data.accounts.find(acc => acc.account_type === "shares");
          if (sharesAcc) {
            setSharesBalance(Number(sharesAcc.balance) || 0);
          }
        }
      } catch (err) {
        console.warn("Error loading shares balance for loan widget:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchSharesBalance();

    // Reload on transaction changes to keep it updated in real-time
    const channel = supabase
      .channel('loan-eligibility-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions'
        },
        () => {
          fetchSharesBalance();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const maxLoanAmount = sharesBalance * 2;
  const isEligible = sharesBalance > 0;
  const scorePercent = isEligible ? 100 : 0;
  const scoreLabel = isEligible ? "Excellent" : "Ineligible";

  return (
    <div className="loan-widget">
      <div className="section-header" style={{ marginBottom: "20px" }}>
        <h3 className="section-title" style={{ fontSize: "16px" }}>
          Loan Eligibility
        </h3>
      </div>
      <div className="eligibility-content">
        <div className="eligibility-score">
          <div 
            className="score-circle" 
            style={{ 
              borderColor: isEligible ? "#10b981" : "#ef4444",
              background: isEligible ? "linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)" : "linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(239, 68, 68, 0.05) 100%)",
              boxShadow: isEligible ? "inset 0 0.4rem 1rem rgba(16, 185, 129, 0.08)" : "inset 0 0.4rem 1rem rgba(239, 68, 68, 0.08)"
            }}
          >
            <span className="score-value" style={{ color: isEligible ? "#10b981" : "#ef4444" }}>
              {loading ? "..." : `${scorePercent}%`}
            </span>
          </div>
          <p className="score-label" style={{ color: isEligible ? "#10b981" : "#ef4444" }}>
            {loading ? "..." : scoreLabel}
          </p>
        </div>
        <div className="eligibility-details">
          <div className="detail-item">
            <span className="detail-label">Max Loan Amount</span>
            <span className="detail-value">
              Shs {loading ? "..." : maxLoanAmount.toLocaleString()}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Interest Rate</span>
            <span className="detail-value">5% p.m</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Repayment Period</span>
            <span className="detail-value">Up to 3 months</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Current Status</span>
            <span
              className="detail-value"
              style={{ color: isEligible ? "#10b981" : "#ef4444", fontWeight: 700 }}
            >
              {loading ? "..." : (isEligible ? "Eligible" : "Not Eligible")}
            </span>
          </div>
        </div>
      </div>
      <Link href="/loans" style={{ width: "100%", textDecoration: "none", display: "block" }}>
        <button className="btn-loan" style={{ width: "100%", marginTop: "15px", cursor: "pointer" }}>
          Apply for Loan
        </button>
      </Link>
    </div>
  );
}
