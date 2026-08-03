"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "../styles/payment.css";

export default function PaymentPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await fetch("/api/subscription-plans");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load plans");
        if (data.plans) {
          setPlans(data.plans);
        }
      } catch (err) {
        // This used to fail silently into an empty grid, which read as "no plans are
        // available to this SACCO" rather than "the list did not load".
        setError(err.message || "Could not load subscription plans.");
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
          <h2>Subscription &amp; License Tiers</h2>
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
        ) : error ? (
          <div className="plans-loading plans-error">
            <i className="fa-solid fa-triangle-exclamation" />
            <span>{error}</span>
          </div>
        ) : (
          plans.map((plan) => {
            const isStandard = plan.recommended;
            const isPremium = plan.id === "premium" || plan.id === "enterprise";

            const cardClass = isStandard
              ? "plan-card plan-standard popular"
              : isPremium
              ? "plan-card plan-premium"
              : "plan-card plan-basic";

            // The whole card is the link rather than only the button: a pricing card
            // reads as clickable, and a real <button> nested inside an <a> would be a
            // second interactive control inside the same target. The action element below
            // is a span carrying the button styling for that reason.
            return (
              <Link
                key={plan.id}
                href={`/payments/checkout?plan=${encodeURIComponent(plan.id)}`}
                className={`${cardClass} plan-card-link`}
                aria-label={`Choose the ${plan.name} plan`}
              >
                {isStandard && <div className="popular-tag">MOST POPULAR</div>}

                <div className="plan-card-header">
                  <span className="plan-badge">{plan.badge}</span>
                  <h3 className="plan-title">{plan.name}</h3>
                  <p className="plan-desc">{plan.description}</p>
                </div>

                <div className="plan-price-wrapper">
                  <span className="currency">UGX</span>
                  <span className="price-amount">
                    {plan.price === 0 ? "0" : Number(plan.price).toLocaleString()}
                  </span>
                  {plan.original_price && (
                    <span
                      className="price-was"
                      aria-label={`Normally ${Number(plan.original_price).toLocaleString()} shillings`}
                    >
                      {Number(plan.original_price).toLocaleString()}
                    </span>
                  )}
                  <span className="billing-period">/ {plan.billing_cycle || "month"}</span>
                </div>

                {plan.original_price && (
                  <p className="plan-saving">
                    <i className="fa-solid fa-tag" />
                    Save UGX {(Number(plan.original_price) - Number(plan.price)).toLocaleString()} a month
                  </p>
                )}

                <ul className="plan-features-list">
                  {Array.isArray(plan.features) &&
                    plan.features.map((feat, idx) => (
                      <li key={idx}>
                        <i className="fa-solid fa-circle-check" />
                        <span>{feat}</span>
                      </li>
                    ))}
                </ul>

                <span className={`plan-action-btn ${isStandard ? "btn-primary" : "btn-secondary"}`}>
                  {plan.is_trial ? "Start Free Trial" : `Choose ${plan.name}`}
                  <i className="fa-solid fa-arrow-right" />
                </span>
              </Link>
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
