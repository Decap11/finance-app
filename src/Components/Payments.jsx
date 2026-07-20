"use client";

import { useEffect, useState } from "react";
import "../styles/payment.css";

export default function PaymentPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await fetch("/api/subscription-plans");
        const data = await res.json();
        if (data.plans) {
          setPlans(data.plans);
        }
      } catch (err) {
        console.warn("Failed to load subscription plans from API:", err);
      } finally {
        setLoading(false);
      }
    }

    loadPlans();
  }, []);

  return (
    <section className="payment-plans-section">
      <div className="plans-header">
        <div className="plans-header-title">
          <i className="fa-solid fa-crown" />
          <h2>Subscription & License Tiers</h2>
        </div>
        <p className="plans-header-subtitle">
          Manage your SACCO subscription tier, unlock higher member limits, and enable advanced automated financial reporting.
        </p>
      </div>

      <div className="plans-grid">
        {loading ? (
          <div className="plans-loading">
            <i className="fa-solid fa-circle-notch fa-spin" />
            <span>Loading subscription options...</span>
          </div>
        ) : (
          plans.map((plan) => {
            const isBasic = plan.id === "basic";
            const isStandard = plan.id === "standard";
            const isPremium = plan.id === "premium" || plan.id === "enterprise";

            const cardClass = isStandard
              ? "plan-card plan-standard popular"
              : isPremium
              ? "plan-card plan-premium"
              : "plan-card plan-basic";

            return (
              <article key={plan.id} className={cardClass}>
                {isStandard && <div className="popular-tag">MOST POPULAR</div>}
                
                <div className="plan-card-header">
                  <span className="plan-badge">
                    {isBasic ? "STARTER" : isStandard ? "PRO SACCO" : "ENTERPRISE"}
                  </span>
                  <h3 className="plan-title">{plan.name}</h3>
                  <p className="plan-desc">{plan.description}</p>
                </div>

                <div className="plan-price-wrapper">
                  <span className="currency">UGX</span>
                  <span className="price-amount">
                    {plan.price === 0 ? "0" : Number(plan.price).toLocaleString()}
                  </span>
                  <span className="billing-period">/ {plan.billing_cycle || "month"}</span>
                </div>

                <ul className="plan-features-list">
                  {Array.isArray(plan.features) &&
                    plan.features.map((feat, idx) => (
                      <li key={idx}>
                        <i className="fa-solid fa-circle-check" />
                        <span>{feat}</span>
                      </li>
                    ))}
                </ul>

                <button className={`plan-action-btn ${isStandard ? "btn-primary" : "btn-secondary"}`}>
                  {isBasic ? "Current Active Plan" : `Upgrade to ${plan.name}`}
                </button>
              </article>
            );
          })
        )}
      </div>

      <div className="plan-note">
        <i className="fa-solid fa-shield-halved" />
        <p>
          All subscription plans include multi-tenant database protection, SSL encryption, and 24/7 financial ledger availability.
        </p>
      </div>
    </section>
  );
}
