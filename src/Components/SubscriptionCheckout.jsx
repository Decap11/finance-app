"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "../supabaseClient";
import { getPlan, PAYMENT_PROVIDERS } from "../utils/subscriptionPlans";
import "../styles/checkout.css";

/**
 * Checkout for a subscription plan.
 *
 * No payment gateway is connected to this application. Submitting records the request
 * against the SACCO and tells the admin what happens next -- it does not move money and
 * does not change `saccos.subscription_plan`, which migration 0016 made platform-controlled
 * precisely so a tenant cannot grant itself a tier. The copy on this page says so rather
 * than implying a charge has gone through.
 */
export default function SubscriptionCheckout() {
  const searchParams = useSearchParams();
  const planId = searchParams?.get("plan") || "standard";
  const plan = getPlan(planId);

  const [provider, setProvider] = useState("mtn");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // Pre-fill from the admin's own profile so the common case is one tap.
    async function loadPhone() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("phone")
          .eq("id", user.id)
          .maybeSingle();

        if (profile?.phone) setPhone(profile.phone);
      } catch {
        // Pre-filling is a convenience; the field is editable either way.
      }
    }
    loadPhone();
  }, []);

  if (!plan) {
    return (
      <section className="checkout-section">
        <div className="checkout-empty">
          <i className="fa-solid fa-circle-question" />
          <h2>That plan does not exist</h2>
          <p>The link may be out of date. Pick a plan from the subscription page.</p>
          <Link href="/payments" className="checkout-back-btn">
            Back to plans
          </Link>
        </div>
      </section>
    );
  }

  const isTrial = plan.isTrial;
  const selectedProvider = PAYMENT_PROVIDERS.find((p) => p.id === provider);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!isTrial) {
      // Deliberately loose: 9 to 13 digits after stripping formatting. Operators reassign
      // prefixes, and rejecting a valid number is worse than accepting an unusual one the
      // payment prompt will fail on anyway.
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 13) {
        setError("Enter the mobile money number that will approve this payment.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired. Sign in again.");

      const res = await fetch("/api/subscription-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        // The amount is deliberately not sent. The route reads it from the catalogue by
        // plan id, so a tampered request cannot buy Premium for a shilling.
        body: JSON.stringify({ planId: plan.id, provider, phone: phone.trim() })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not submit this request.");

      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <section className="checkout-section">
        <div className="checkout-done">
          <div className="checkout-done-icon">
            <i className="fa-solid fa-circle-check" />
          </div>
          <h2>{isTrial ? "Trial confirmed" : "Request received"}</h2>
          <p className="checkout-done-lead">{result.message}</p>

          <div className="checkout-done-summary">
            <div>
              <span>Plan</span>
              <strong>{plan.name}</strong>
            </div>
            <div>
              <span>Amount</span>
              <strong>UGX {plan.price.toLocaleString()}</strong>
            </div>
            {!isTrial && (
              <>
                <div>
                  <span>Method</span>
                  <strong>{selectedProvider?.name}</strong>
                </div>
                <div>
                  <span>Number</span>
                  <strong>{phone}</strong>
                </div>
              </>
            )}
            <div>
              <span>Reference</span>
              <strong className="checkout-ref">{result.reference}</strong>
            </div>
          </div>

          <Link href="/payments" className="checkout-back-btn">
            Back to plans
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="checkout-section">
      <Link href="/payments" className="checkout-breadcrumb">
        <i className="fa-solid fa-arrow-left" /> Back to plans
      </Link>

      <div className="checkout-grid">
        {/* Order summary */}
        <aside className="checkout-summary">
          <h3 className="checkout-summary-title">Order summary</h3>

          <div className="checkout-plan">
            <span className="checkout-plan-badge">{plan.badge}</span>
            <h4>{plan.name}</h4>
            <p>{plan.description}</p>
          </div>

          <ul className="checkout-features">
            {plan.features.map((feat, i) => (
              <li key={i}>
                <i className="fa-solid fa-circle-check" />
                {feat}
              </li>
            ))}
          </ul>

          <div className="checkout-lines">
            {plan.originalPrice && (
              <div className="checkout-line">
                <span>Standard price</span>
                <span className="checkout-strike">
                  UGX {plan.originalPrice.toLocaleString()}
                </span>
              </div>
            )}
            {plan.originalPrice && (
              <div className="checkout-line checkout-line-discount">
                <span>Discount</span>
                <span>
                  &minus; UGX {(plan.originalPrice - plan.price).toLocaleString()}
                </span>
              </div>
            )}
            <div className="checkout-line checkout-line-total">
              <span>Total due</span>
              <span>UGX {plan.price.toLocaleString()}</span>
            </div>
            <p className="checkout-billing-note">
              {isTrial
                ? "Free for your onboarding month. No payment details needed."
                : `Covers ${plan.billingCycle === "3 months" ? "three months" : "one month"} of service.`}
            </p>
          </div>
        </aside>

        {/* Payment */}
        <form className="checkout-payment" onSubmit={handleSubmit}>
          <h3 className="checkout-payment-title">
            {isTrial ? "Confirm your trial" : "Pay with mobile money"}
          </h3>

          {isTrial ? (
            <p className="checkout-trial-note">
              The Basic plan runs free for the month you onboard in. There is nothing to
              pay now — confirm below and it stays active for the rest of the month.
            </p>
          ) : (
            <>
              <p className="checkout-payment-lead">
                Choose the network holding the money. You will approve the payment on your
                handset.
              </p>

              <div className="checkout-providers" role="radiogroup" aria-label="Payment method">
                {PAYMENT_PROVIDERS.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    role="radio"
                    aria-checked={provider === p.id}
                    className={`checkout-provider ${provider === p.id ? "selected" : ""} provider-${p.id}`}
                    onClick={() => setProvider(p.id)}
                  >
                    <span className="checkout-provider-mark" aria-hidden="true">
                      {p.id === "mtn" ? "MTN" : "airtel"}
                    </span>
                    <span className="checkout-provider-text">
                      <strong>{p.name}</strong>
                      <small>{p.hint}</small>
                    </span>
                    <span className="checkout-provider-tick" aria-hidden="true">
                      <i className="fa-solid fa-circle-check" />
                    </span>
                  </button>
                ))}
              </div>

              <div className="checkout-field">
                <label htmlFor="checkout-phone">
                  {selectedProvider?.shortName} number
                </label>
                <input
                  id="checkout-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 0771 234 567"
                />
              </div>
            </>
          )}

          {error && (
            <div className="checkout-error">
              <i className="fa-solid fa-triangle-exclamation" /> {error}
            </div>
          )}

          <button type="submit" className="checkout-submit" disabled={submitting}>
            {submitting
              ? "Submitting…"
              : isTrial
                ? "Confirm free trial"
                : `Pay UGX ${plan.price.toLocaleString()}`}
          </button>

          {!isTrial && (
            <p className="checkout-disclaimer">
              <i className="fa-solid fa-circle-info" />
              Mobile money collection is not yet connected to this system. Submitting
              records your request and our team confirms activation — you will not be
              charged automatically.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
