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
      <div className="plans-grid">
        {loading ? (
          <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "4rem", color: "var(--text-light)" }}>
            Loading subscription options...
          </div>
        ) : (
          plans.map((plan) => {
            const isBasic = plan.id === "basic";
            const isStandard = plan.id === "standard";
            const isPremium = plan.id === "premium" || plan.id === "enterprise";

            const cardClass = isBasic
              ? "plan-card plan-basic"
              : isStandard
              ? "plan-card plan-standard"
              : "plan-card plan-premium";

            return (
              <article key={plan.id} className={cardClass}>
                <div className="plan-badge">{plan.name}</div>
                <h2>{plan.name}</h2>
                <p>{plan.description}</p>
                <div className="plan-price">
                  {plan.price === 0 ? "Shs 0" : `Shs ${Number(plan.price).toLocaleString()} / ${plan.billing_cycle}`}
                </div>
                <ul>
                  {Array.isArray(plan.features) &&
                    plan.features.map((feat, idx) => <li key={idx}>{feat}</li>)}
                </ul>
                <button>
                  {isBasic ? "Activate Basic" : `Choose ${plan.name}`}
                </button>
              </article>
            );
          })
        )}
      </div>

      <div className="plan-note">
        <p>
          All plans include secure SACCO transaction support, multi-tenant database protection, and mobile-friendly access.
        </p>
      </div>
    </section>
  );
}
