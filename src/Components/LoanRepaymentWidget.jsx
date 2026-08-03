import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import CustomSelect from "./CustomSelect";
import "../styles/loans.css";

export default function LoanRepaymentWidget() {
  const [repayAmount, setRepayAmount] = useState("");
  const [paymentSource, setPaymentSource] = useState("");
  
  // A member can hold a normal loan and a Social Fund emergency loan at once, so this
  // tracks the whole set and which of them the form is currently pointed at.
  const [loans, setLoans] = useState([]);
  const [selectedLoanId, setSelectedLoanId] = useState("");
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

        const open = data.activeLoans || (data.activeLoan ? [data.activeLoan] : []);
        setLoans(open);
        // Keep whatever the member was looking at across a refresh; fall back to the
        // first loan, and to nothing once they have none.
        setSelectedLoanId((current) =>
          open.some((l) => l.id === current) ? current : (open[0]?.id || "")
        );
        setSavingsBalance(data.savingsBalance || 0);
      } catch (err) {
        console.warn("Error loading loan data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();

    const channel = supabase
      .channel('repayment-widget-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeLoan = loans.find((l) => l.id === selectedLoanId) || null;
  const repayments = activeLoan?.repayments || [];

  const loanLabel = (loan) =>
    loan.loan_type === "social_fund" ? "Social Fund Emergency" : "Normal Loan";

  const loanOptions = loans.map((loan) => ({
    value: loan.id,
    // The number leads: it is what an admin will ask for, and what distinguishes two
    // loans of the same type more precisely than the type name can.
    label: `${loan.loan_number ? loan.loan_number + " · " : ""}${loanLabel(loan)} — Shs ${Number(
      loan.outstanding_balance ?? loan.total_repayable ?? loan.amount_approved ?? 0
    ).toLocaleString()} left`
  }));

  // What is actually owed, interest included, is total_repayable. amount_approved is only
  // the principal, so paying that off would leave the interest unaccounted for.
  const totalLoan = activeLoan
    ? (Number(activeLoan.total_repayable) || Number(activeLoan.amount_approved) || 0)
    : 0;
  const remainingAmount = activeLoan
    ? (activeLoan.outstanding_balance !== null && activeLoan.outstanding_balance !== undefined
        ? Number(activeLoan.outstanding_balance)
        : totalLoan)
    : 0;
  const paidAmount = Math.max(0, totalLoan - remainingAmount);
  const isOverdue = Boolean(
    activeLoan &&
    remainingAmount > 0 &&
    (activeLoan.status === "overdue" ||
      (activeLoan.due_date && new Date(activeLoan.due_date) < new Date()))
  );
  const repaymentPercentage = totalLoan > 0 ? (paidAmount / totalLoan) * 100 : 0;

  const handleAmountChange = (e) => {
    setRepayAmount(e.target.value);
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

    if (remainingAmount > 0 && amount > remainingAmount) {
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
          // Named explicitly. With two loans open the server refuses to guess, and it
          // is right to -- an installment credited to the wrong debt is real money in
          // the wrong place.
          loanId: selectedLoanId,
          amount: amount,
          paymentSource: paymentSource
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit repayment request.");

      setMessage("success: " + (data.message || "Installment submitted (pending approval)."));
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

      {/* Only when there is a choice to make. A member with one loan should not have to
          pick it out of a list of one. */}
      {!loading && loans.length > 1 && (
        <div className="form-group">
          <label htmlFor="repay-loan">Which loan are you repaying?</label>
          <div className="input-wrapper">
            <CustomSelect
              value={selectedLoanId}
              options={loanOptions}
              onChange={(val) => {
                setSelectedLoanId(val);
                setRepayAmount("");
                setMessage("");
              }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem" }}>Loading your loan details...</div>
      ) : !activeLoan ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-light)" }}>
          <i className="fa-solid fa-check-circle" style={{ fontSize: "3rem", color: "var(--success)", marginBottom: "1rem" }}></i>
          <p>You have no active loans to repay.</p>
        </div>
      ) : ["pending", "pending_guarantors", "pending_fee", "approved"].includes(activeLoan.status) ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "#334155" }}>
          <i className="fa-solid fa-clock" style={{ fontSize: "3rem", color: "#eab308", marginBottom: "1rem" }}></i>
          <h4 style={{ fontSize: "1.6rem", fontWeight: 700, margin: "0 0 0.6rem" }}>
            {loanLabel(activeLoan)} Application Pending
          </h4>
          <p style={{ fontSize: "1.2rem", color: "#64748b", margin: 0 }}>
            Your loan request of <strong>UGX {totalLoan.toLocaleString()}</strong> is waiting on{" "}
            {activeLoan.status === "pending_fee"
              ? <>the <strong>UGX {Number(activeLoan.application_fee || 0).toLocaleString()}</strong> application fee to be confirmed by an admin</>
              : activeLoan.status === "pending_guarantors"
                ? "your guarantors to sign"
                : "admin review"}.
          </p>
        </div>
      ) : (
        <form className="loan-form" onSubmit={handleSubmit}>
          <div className="loan-schedule">
            <div className="loan-schedule-row">
              <span>Loan</span>
              <strong>
                {loanLabel(activeLoan)}
                {activeLoan.loan_number && (
                  <span className="loan-reference"> {activeLoan.loan_number}</span>
                )}
              </strong>
            </div>
            <div className="loan-schedule-row">
              <span>Installment</span>
              <strong>
                Shs {Number(activeLoan.installment_amount || 0).toLocaleString()}
                {activeLoan.term_months ? ` × ${activeLoan.term_months}` : ""}
              </strong>
            </div>
            <div className="loan-schedule-row">
              <span>Paid so far</span>
              <strong>
                Shs {paidAmount.toLocaleString()}
                {repayments.length > 0 ? ` (${repayments.length} installment${repayments.length === 1 ? "" : "s"})` : ""}
              </strong>
            </div>
            <div className="loan-schedule-row">
              <span>Due by</span>
              <strong>
                {activeLoan.due_date
                  ? new Date(activeLoan.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                  : "—"}
              </strong>
            </div>
          </div>

          {isOverdue && (
            <div className="loan-overdue-note">
              <i className="fa-solid fa-triangle-exclamation"></i>
              <span>
                This loan passed its due date. A late charge is added for every whole month
                it stays unpaid — pay it off to stop them accruing.
              </span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="repay-amount">Amount to Repay (Shs)</label>
            <div className="input-wrapper input-wrapper-icon">
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
