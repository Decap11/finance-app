import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/loans.css";

export default function LoanRequestWidget() {
  const [loanType, setLoanType] = useState("normal"); // "normal" or "social_fund"
  const [loanAmount, setLoanAmount] = useState("");
  const [loanReason, setLoanReason] = useState("");
  const [repaymentPeriod, setRepaymentPeriod] = useState("1"); // term months (1-3) or "2w" for social
  
  const [sharesBalance, setSharesBalance] = useState(0);
  const [loadingBalance, setLoadingBalance] = useState(true);
  
  const [totalRepayment, setTotalRepayment] = useState(0);
  const [dueDateText, setDueDateText] = useState("Select amount to calculate");
  const [dbDueDate, setDbDueDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  const INTEREST_RATE = 0.05; // 5% per month for normal loan

  useEffect(() => {
    async function loadSharesBalance() {
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
        console.warn("Failed to load shares balance:", err);
      } finally {
        setLoadingBalance(false);
      }
    }
    loadSharesBalance();
  }, []);

  const calculateLoan = (amount, type, period) => {
    if (!amount || amount <= 0) {
      setTotalRepayment(0);
      setDueDateText("Select amount to calculate");
      setDbDueDate("");
      return;
    }

    let total = amount;
    const today = new Date();
    let dueDateTime = new Date();

    if (type === "social_fund") {
      // Social Fund: 0% Interest, 2 weeks repayment period
      total = amount;
      dueDateTime.setDate(today.getDate() + 14); // 2 weeks
    } else {
      // Normal Loan: 5% p.m. Interest, period is months (1-3)
      const months = parseInt(period, 10) || 1;
      const interest = amount * INTEREST_RATE * months;
      total = amount + interest;
      dueDateTime.setMonth(today.getMonth() + months);
    }

    setTotalRepayment(total);

    // Format for display
    const formattedDate = dueDateTime.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    setDueDateText(formattedDate);

    // Format for Database (YYYY-MM-DD)
    const yyyy = dueDateTime.getFullYear();
    const mm = String(dueDateTime.getMonth() + 1).padStart(2, '0');
    const dd = String(dueDateTime.getDate()).padStart(2, '0');
    setDbDueDate(`${yyyy}-${mm}-${dd}`);
  };

  const handleTypeChange = (e) => {
    const selectedType = e.target.value;
    setLoanType(selectedType);
    
    // Set default periods
    const defaultPeriod = selectedType === "social_fund" ? "2w" : "1";
    setRepaymentPeriod(defaultPeriod);
    
    calculateLoan(parseFloat(loanAmount) || "", selectedType, defaultPeriod);
  };

  const handleAmountChange = (e) => {
    const amount = parseFloat(e.target.value) || "";
    setLoanAmount(amount);
    calculateLoan(amount, loanType, repaymentPeriod);
  };

  const handlePeriodChange = (e) => {
    const selectedPeriod = e.target.value;
    setRepaymentPeriod(selectedPeriod);
    calculateLoan(parseFloat(loanAmount) || "", loanType, selectedPeriod);
  };

  const handleReasonChange = (e) => {
    setLoanReason(e.target.value);
  };

  const maxAllowedAmount = loanType === "social_fund" ? 50000 : sharesBalance * 2;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!loanAmount || !loanReason) {
      setMessage("Please fill in all fields.");
      return;
    }

    const amt = Number(loanAmount);
    if (amt > maxAllowedAmount) {
      setMessage(
        loanType === "social_fund"
          ? "Social Fund loan amount cannot exceed Shs 50,000."
          : `Loan amount exceeds your maximum eligible borrowing limit of Shs ${maxAllowedAmount.toLocaleString()}.`
      );
      return;
    }
    
    setIsLoading(true);
    setMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be logged in.");

      const isSocial = loanType === "social_fund";
      const termMonths = isSocial ? null : Number(repaymentPeriod);

      const res = await fetch("/api/loans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          action: "request_loan",
          amount: amt,
          purpose: loanReason,
          loanType: loanType,
          termMonths: termMonths,
          interestRate: isSocial ? 0.00 : 5.00,
          dueDate: dbDueDate
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit loan request.");

      setMessage("success: Loan request submitted successfully!");
      
      // Reset form
      setLoanAmount("");
      setLoanReason("");
      setTotalRepayment(0);
      setDueDateText("Select amount to calculate");
      setDbDueDate("");
    } catch (err) {
      setMessage(err.message || "An error occurred.");
    } finally {
      setIsLoading(false);
      setSubmitting(false);
    }
  };

  return (
    <div className="loan-request-widget" style={{ marginTop: 0 }}>
      <div className="section-header" style={{ marginBottom: "1rem" }}>
        <h3 className="section-title">Request a Loan</h3>
      </div>
      
      {message && (
        <div style={{ 
          marginBottom: '1rem', 
          padding: '0.8rem', 
          borderRadius: '8px', 
          background: message.startsWith('success') ? '#d1fae5' : '#fee2e2', 
          color: message.startsWith('success') ? '#065f46' : '#991b1b', 
          textAlign: 'center',
          fontWeight: 600,
          fontSize: '1.3rem'
        }}>
          {message.startsWith('success') ? message.replace('success: ', '') : message}
        </div>
      )}

      <form className="loan-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="loan-type">Loan Type</label>
          <div className="input-wrapper">
            <CustomSelect
              value={loanType}
              options={loanTypeOptions}
              onChange={handleTypeChange}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="loan-amount">
            Loan Amount (Shs) 
            <span style={{ fontSize: '1.2rem', color: 'var(--text-light)', marginLeft: '1rem' }}>
              (Max Limit: Shs {loadingBalance ? "..." : maxAllowedAmount.toLocaleString()})
            </span>
          </label>
          <div className="input-wrapper">
            <i className="fa-solid fa-money-bill-wave"></i>
            <input
              type="number"
              id="loan-amount"
              placeholder="Enter amount"
              value={loanAmount}
              onChange={handleAmountChange}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="repayment-period">Repayment Period</label>
          <div className="input-wrapper">
            <CustomSelect
              value={loanType === "social_fund" ? "2w" : repaymentPeriod}
              options={loanType === "social_fund" ? socialPeriodOptions : periodOptions}
              onChange={(val) => setRepaymentPeriod(val)}
              disabled={loanType === "social_fund"}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="loan-reason">Reason for Loan</label>
          <div className="input-wrapper">
            <CustomSelect
              value={loanReason}
              options={reasonOptions}
              onChange={(val) => setLoanReason(val)}
              placeholder="Select a reason..."
            />
          </div>
        </div>

        <div className="loan-details">
          <div className="detail-row">
            <span>Interest Rate</span>
            <span className="highlight">
              {loanType === "social_fund" ? "0% (Interest-free)" : "5% per month"}
            </span>
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
              {dueDateText}
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
