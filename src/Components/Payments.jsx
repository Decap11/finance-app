import "../styles/payment.css";
export default function PaymentPlans() {
  return (
    <section className="payment-plans-section">
      <div className="plans-grid">
        <article className="plan-card plan-basic">
          <div className="plan-badge">Basic</div>
          <h2>Free Access</h2>
          <p>Free for the very first month of onboarding for every tenant / SACCO group.</p>
          <div className="plan-price">Shs 0</div>
          <ul>
            <li>Basic contribution tracking</li>
            <li>Access to savings and loans overview</li>
            <li>Email notifications</li>
          </ul>
          <button>Activate Basic</button>
        </article>

        <article className="plan-card plan-standard">
          <div className="plan-badge">Standard</div>
          <h2>Standard</h2>
          <p>Best for active members with regular savings.</p>
          <div className="plan-price">Shs 75,000 / month</div>
          <ul>
            <li>Enhanced payment reminders</li>
            <li>Priority support</li>
            <li>Loan eligibility alerts</li>
          </ul>
          <button>Choose Standard</button>
        </article>

        <article className="plan-card plan-premium">
          <div className="plan-badge">Premium</div>
          <h2>Premium</h2>
          <p>For members who want full control and advanced insights.</p>
          <div className="plan-price">Shs 200,000 / 3 months</div>
          <ul>
            <li>Custom savings goals</li>
            <li>Real-time payment history</li>
            <li>Dedicated account support</li>
            <li>Valid for 3 months</li>
          </ul>
          <button>Choose Premium</button>
        </article>
      </div>

      <div className="plan-note">
        <p>
          All plans include secure SACCO transaction support and mobile-friendly
          access.
        </p>
      </div>
    </section>
  );
}
