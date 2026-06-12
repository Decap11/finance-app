import { useState } from "react";
import "../styles/loans.css";

export default function LoanRepaymentWidget() {
  const [repayAmount, setRepayAmount] = useState("");
  const [paymentSource, setPaymentSource] = useState("");

  // Loan data - typically this would come from props or API
  const loanData = {
    totalLoan: 800000,
    paidAmount: 350000,
    savingsBalance: 1200000,
  };

  const remainingAmount = loanData.totalLoan - loanData.paidAmount;
  const repaymentPercentage = (loanData.paidAmount / loanData.totalLoan) * 100;

  const handleAmountChange = (e) => {
    setRepayAmount(e.target.value);
  };

  const handleSourceChange = (e) => {
    setPaymentSource(e.target.value);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!repayAmount || !paymentSource) {
      alert("Please fill in all fields");
      return;
    }

    const amount = parseFloat(repayAmount);

    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid amount greater than 0");
      return;
    }

    if (amount < 1000) {
      alert("Minimum repayment amount is Shs 1,000");
      return;
    }

    if (amount > remainingAmount) {
      alert(
        `Cannot repay more than remaining amount: Shs ${remainingAmount.toLocaleString()}`,
      );
      return;
    }

    if (paymentSource === "savings" && amount > loanData.savingsBalance) {
      alert(
        `Insufficient savings balance. Available: Shs ${loanData.savingsBalance.toLocaleString()}`,
      );
      return;
    }

    alert("Repayment successful!");
    // Reset form
    setRepayAmount("");
    setPaymentSource("");
  };

  return (
    <div className="loan-request-widget">
      <div className="section-header" style={{ marginBottom: "2.5rem" }}>
        <h3 className="section-title">Repay Loan</h3>
      </div>
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
            <i className="fa-solid fa-wallet"></i>
            <select
              id="payment-source"
              value={paymentSource}
              onChange={handleSourceChange}
              required
            >
              <option value="">Select source...</option>
              <option value="savings">
                My Savings (Balance: Shs{" "}
                {loanData.savingsBalance.toLocaleString()})
              </option>
              <option value="mobile_money">Mobile Money</option>
              <option value="bank">Bank Transfer</option>
            </select>
            <i
              className="fa-solid fa-chevron-down"
              style={{ left: "auto", right: "1.5rem", pointerEvents: "none" }}
            ></i>
          </div>
        </div>

        <div className="repayment-progress-visual">
          <div className="progress-labels">
            <div className="label-item">
              <span className="dot paid-dot"></span> Paid: Shs{" "}
              {loanData.paidAmount.toLocaleString()}
            </div>
            <div className="label-item" style={{ color: "var(--text-light)" }}>
              <span className="dot remaining-dot"></span> Remaining: Shs{" "}
              {remainingAmount.toLocaleString()}
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
            <span>Total Loan: Shs {loanData.totalLoan.toLocaleString()}</span>
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
    </div>
  );
}
