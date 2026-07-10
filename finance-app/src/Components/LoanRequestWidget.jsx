import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/loans.css";

export default function LoanRequestWidget() {
  const [loanAmount, setLoanAmount] = useState("");
  const [loanReason, setLoanReason] = useState("");
  const [totalRepayment, setTotalRepayment] = useState(0);
  const [dueDate, setDueDate] = useState("Select amount to calculate");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  const INTEREST_RATE = 0.05; // 5% per month
  const LOAN_DURATION_MONTHS = 12; // Default 12 months

  const calculateLoan = (amount) => {
    if (!amount || amount < 50000) {
      setTotalRepayment(0);
      setDueDate("Select amount to calculate");
      return;
    }

    const interest = amount * INTEREST_RATE * LOAN_DURATION_MONTHS;
    const total = amount + interest;
    setTotalRepayment(total);

    // Calculate due date (12 months from today)
    const today = new Date();
    const dueDateTime = new Date(
      today.setMonth(today.getMonth() + LOAN_DURATION_MONTHS),
    );
    const formattedDate = dueDateTime.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    setDueDate(formattedDate);
  };

  const handleAmountChange = (e) => {
    const amount = parseFloat(e.target.value) || "";
    setLoanAmount(amount);
    calculateLoan(amount);
  };

  const handleReasonChange = (e) => {
    setLoanReason(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!loanAmount || !loanReason) {
      setMessage("Please fill in all fields.");
      return;
    }
    
    setIsLoading(true);
    setMessage("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in.");

      // Fetch the user's SACCO ID
      const { data: membershipData, error: membershipError } = await supabase
        .from('sacco_memberships')
        .select('sacco_id')
        .eq('profile_id', user.id)
        .limit(1)
        .single();

      if (membershipError || !membershipData) {
        throw new Error("Could not find your SACCO membership.");
      }

      // Call the RPC to request loan
      const { error: rpcError } = await supabase.rpc('request_loan', {
        p_sacco_id: membershipData.sacco_id,
        p_amount: Number(loanAmount),
        p_term_months: LOAN_DURATION_MONTHS,
        p_purpose: loanReason
      });

      if (rpcError) throw rpcError;

      setMessage("Loan request submitted successfully!");
      
      // Reset form
      setLoanAmount("");
      setLoanReason("");
      setTotalRepayment(0);
      setDueDate("Select amount to calculate");
    } catch (err) {
      setMessage(err.message || "An error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="loan-request-widget" style={{ marginTop: 0 }}>
      <div className="section-header" style={{ marginBottom: "1rem" }}>
        <h3 className="section-title">Request a Loan</h3>
      </div>
      
      {message && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem', borderRadius: '4px', background: message.includes('success') ? '#d1fae5' : '#fee2e2', color: message.includes('success') ? '#065f46' : '#991b1b', textAlign: 'center' }}>
          {message}
        </div>
      )}

      <form className="loan-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="loan-amount">Loan Amount (Shs)</label>
          <div className="input-wrapper">
            <i className="fa-solid fa-money-bill-wave"></i>
            <input
              type="number"
              id="loan-amount"
              placeholder="e.g. 500000"
              min="50000"
              step="10000"
              value={loanAmount}
              onChange={handleAmountChange}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="loan-reason">Reason for Loan</label>
          <div className="input-wrapper">
            <i className="fa-solid fa-pen-to-square"></i>
            <select
              id="loan-reason"
              value={loanReason}
              onChange={handleReasonChange}
              required
            >
              <option value="" disabled>
                Select a reason...
              </option>
              <option value="business">Business / Development</option>
              <option value="education">Education / School Fees</option>
              <option value="medical">Medical Emergency</option>
              <option value="personal">Personal / Home</option>
              <option value="other">Other</option>
            </select>
            <i
              className="fa-solid fa-chevron-down"
              style={{ left: "auto", right: "1.5rem", pointerEvents: "none" }}
            ></i>
          </div>
        </div>

        <div className="loan-details">
          <div className="detail-row">
            <span>Interest Rate</span>
            <span className="highlight">5% per month</span>
          </div>
          <div className="detail-row">
            <span>Total Repayment</span>
            <span className="highlight bold">
              Shs {totalRepayment.toLocaleString()}
            </span>
          </div>
          <div className="detail-row">
            <span>Due Date</span>
            <span
              className="highlight due-date"
              style={{ color: "var(--text-light)" }}
            >
              {dueDate}
            </span>
          </div>
        </div>

        <button type="submit" className="btn-submit-loan" disabled={isLoading}>
          {isLoading ? "Submitting..." : "Submit Request"}
        </button>
      </form>
    </div>
  );
}
