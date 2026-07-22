import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import CustomSelect from "./CustomSelect.jsx";
import "../styles/loans.css";

export default function LoanRepaymentWidget() {
  const [repayAmount, setRepayAmount] = useState("");
  const [paymentSource, setPaymentSource] = useState("");
  
  const [activeLoan, setActiveLoan] = useState(null);
  const [savingsBalance, setSavingsBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch("/api/loans", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (data.activeLoan) {
          setActiveLoan(data.activeLoan);
        }
        setSavingsBalance(data.savingsBalance || 0);
      } catch (err) {
        console.warn("Error loading loan data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const totalLoan = activeLoan ? activeLoan.amount_approved : 0;
  const remainingAmount = activeLoan ? activeLoan.outstanding_balance : 0;
  const paidAmount = totalLoan - remainingAmount;
  const repaymentPercentage = totalLoan > 0 ? (paidAmount / totalLoan) * 100 : 0;

  const handleAmountChange = (e) => {
    setRepayAmount(e.target.value);
  };

  const handleSourceChange = (e) => {
    setPaymentSource(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!repayAmount || !paymentSource) {
      setMessage("Please fill in all fields");
      return;
    }

    const amount = parseFloat(repayAmount);

    if (isNaN(amount) || amount <= 0) {
      setMessage("Please enter a valid amount greater than 0");
      return;
    }

    if (amount < 1000) {
      setMessage("Minimum repayment amount is Shs 1,000");
      return;
    }

    if (amount > remainingAmount) {
      setMessage(`Cannot repay more than remaining amount: Shs ${remainingAmount.toLocaleString()}`);
      return;
    }
    setLoading(true);
    setMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be logged in.");

      const res = await fetch("/api/loans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "repay_loan",
          amount: amount,
          paymentSource: paymentSource
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit repayment request.");

      setMessage("success: Repayment requested successfully (pending approval).");
      setRepayAmount("");
      setPaymentSource("");
    } catch (err) {
      console.warn("Failed to request repayment:", err);
      setMessage(err.message || "An error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="loan-request-widget">
      <div className="section-header" style={{ marginBottom: "1rem" }}>
        <h3 className="section-title">Repay Loan</h3>
      </div>
      
      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem', borderRadius: '4px', background: message.includes('success') ? '#d1fae5' : '#fee2e2', color: message.includes('success') ? '#065f46' : '#991b1b', textAlign: 'center' }}>
          {message}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem" }}>Loading your loan details...</div>
      ) : !activeLoan ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-light)" }}>
          <i className="fa-solid fa-check-circle" style={{ fontSize: "3rem", color: "var(--success)", marginBottom: "1rem" }}></i>
          <p>You have no active loans to repay.</p>
        </div>
      ) : (
        <form className="loan-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="repay-amount">Amount to Repay (Shs)</label>
            <div className="input-wrapper">
              <i className="fa-solid fa-money-bill-wave"></i>
              <input
                type="number"
                id="repay-amount"
                placeholder="e.g. 50000"
                min="1000"
                step="1000"
                value={repayAmount}
                onChange={handleAmountChange}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="payment-source">Payment Source</label>
            <div className="input-wrapper">
              <CustomSelect
                value={paymentSource}
                options={[
                  { value: "", label: "Select source..." },
                  { value: "mobile_money", label: "Mobile Money" },
                  { value: "bank", label: "Bank Transfer" }
                ]}
                onChange={(val) => setPaymentSource(val)}
                placeholder="Select source..."
              />
            </div>
          </div>

          <div className="repayment-progress-visual">
            <div className="progress-labels">
              <div className="label-item">
                <span className="dot paid-dot"></span> Paid: Shs {paidAmount.toLocaleString()}
              </div>
              <div className="label-item" style={{ color: "var(--text-light)" }}>
                <span className="dot remaining-dot"></span> Remaining: Shs {remainingAmount.toLocaleString()}
              </div>
            </div>

            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{ width: `${repaymentPercentage}%` }}
              ></div>
            </div>

            <div className="progress-footer">
              <span style={{ color: "var(--success)", fontWeight: 700 }}>
                {repaymentPercentage.toFixed(1)}% Repaid
              </span>
              <span>Total Loan: Shs {totalLoan.toLocaleString()}</span>
            </div>
          </div>

          <button
            type="submit"
            className="btn-submit-loan"
            style={{ backgroundColor: "var(--success)" }}
          >
            Make Payment
          </button>
        </form>
      )}
    </div>
  );
}
