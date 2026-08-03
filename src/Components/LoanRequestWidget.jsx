import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import CustomSelect from "./CustomSelect";
import "../styles/loans.css";

const loanTypeOptions = [
  { value: "normal", label: "Normal Loan (5% p.m.)" },
  { value: "social_fund", label: "Social Fund Emergency (0%)" }
];

const periodOptions = [
  { value: "1", label: "1 Month" },
  { value: "2", label: "2 Months" },
  { value: "3", label: "3 Months" }
];

const socialPeriodOptions = [
  { value: "2w", label: "2 Weeks (Interest-Free)" }
];

const reasonOptions = [
  { value: "business", label: "Business Expansion" },
  { value: "emergency", label: "Emergency / Healthcare" },
  { value: "school_fees", label: "School Fees" },
  { value: "agriculture", label: "Agricultural / Farm Inputs" },
  { value: "personal", label: "Personal Needs" }
];

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

  // Peer Guarantors State
  const [groupMembers, setGroupMembers] = useState([]);
  const [selectedGuarantors, setSelectedGuarantors] = useState([]);

  // Loan rules come from the SACCO's settings, not from constants here, so a committee
  // can change the fee or the guarantor minimum without a deploy. The defaults below
  // only apply until the fetch lands.
  const [rules, setRules] = useState({ applicationFee: 0, minGuarantors: 3, lateFeeAmount: 0 });

  const INTEREST_RATE = 0.05; // 5% per month for normal loan

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

  useEffect(() => {
    loadSharesBalance();

    const channel = supabase
      .channel('loan-widget-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, loadSharesBalance)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, loadSharesBalance)
      .subscribe();

    function handleTransactionUpdate() {
      loadSharesBalance();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("sacco_transaction_updated", handleTransactionUpdate);
      window.addEventListener("manual_contribution_logged", handleTransactionUpdate);
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("sacco_transaction_updated", handleTransactionUpdate);
        window.removeEventListener("manual_contribution_logged", handleTransactionUpdate);
      }
    };
  }, []);

  useEffect(() => {
    async function loadMembers() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("group_id")
          .eq("id", session.user.id)
          .single();

        if (profile?.group_id) {
          const res = await fetch(`/api/group-members?groupId=${encodeURIComponent(profile.group_id)}`);
          const data = await res.json();
          if (data.success && data.members) {
            const peers = data.members.filter(m => String(m.id).toLowerCase() !== String(session.user.id).toLowerCase());
            setGroupMembers(peers);
          }
        }
      } catch (err) {
        console.warn("Failed to load group members for guarantors:", err);
      }
    }

    async function loadRules() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch("/api/loans", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store"
        });
        const data = await res.json();
        if (res.ok && data.rules) setRules(data.rules);
      } catch (err) {
        console.warn("Failed to load loan rules:", err);
      }
    }

    loadMembers();
    loadRules();
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

  const handleTypeChange = (selectedType) => {
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

  const handlePeriodChange = (selectedPeriod) => {
    setRepaymentPeriod(selectedPeriod);
    calculateLoan(parseFloat(loanAmount) || "", loanType, selectedPeriod);
  };

  const handleReasonChange = (selectedReason) => {
    setLoanReason(selectedReason);
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

    // request_loan rejects this too -- a rule about who carries someone else's debt is
    // not something the browser gets the final say on. Checked here so the member is
    // told before a round trip.
    if (selectedGuarantors.length < rules.minGuarantors) {
      setMessage(
        `Select at least ${rules.minGuarantors} guarantors from your SACCO. ` +
        `You have selected ${selectedGuarantors.length}.`
      );
      return;
    }


    setIsLoading(true);
    setMessage("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("You must be logged in.");

      const isSocial = loanType === "social_fund";
      // A social fund loan runs two weeks, which the term is expressed in months as 1 --
      // request_loan needs a term to derive the installment and the due date from, and
      // null would be rejected. dueDate still carries the real two-week deadline.
      const termMonths = isSocial ? 1 : Number(repaymentPeriod);

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
          dueDate: dbDueDate,
          guarantors: selectedGuarantors
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit loan request.");

      // The API's message names the fee that is now due and what happens next, which is
      // more use than a generic acknowledgement.
      setMessage("success: " + (data.message || "Loan request submitted successfully!"));
      
      // Reset form
      setLoanAmount("");
      setLoanReason("");
      setTotalRepayment(0);
      setDueDateText("Select amount to calculate");
      setDbDueDate("");
      setSelectedGuarantors([]);
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
          <div className="input-wrapper input-wrapper-icon">
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

        {groupMembers.length > 0 && (
          <div className="form-group">
            <label style={{ fontWeight: 700, fontSize: "1.2rem", color: "var(--text-dark)", marginBottom: "0.6rem", display: "block" }}>
              Select Peer Guarantors
              <span
                style={{
                  marginLeft: "0.6rem",
                  fontWeight: 700,
                  color: selectedGuarantors.length >= rules.minGuarantors ? "#059669" : "#dc2626"
                }}
              >
                {selectedGuarantors.length} of {rules.minGuarantors} required
              </span>
            </label>
            {rules.applicationFee > 0 && (
              <p style={{ fontSize: "1.15rem", color: "#64748b", margin: "0 0 0.8rem", lineHeight: 1.5 }}>
                A non-refundable application fee of{" "}
                <strong>UGX {rules.applicationFee.toLocaleString()}</strong> applies. An
                admin confirms it before your guarantors are asked to sign.
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "160px", overflowY: "auto", padding: "0.4rem" }}>
              {groupMembers.map((m) => {
                const isSelected = selectedGuarantors.includes(m.id);
                return (
                  <label key={m.id} style={{ display: "flex", alignItems: "center", gap: "0.8rem", fontSize: "1.2rem", color: "#334155", cursor: "pointer", background: isSelected ? "#e0e7ff" : "#f8fafc", padding: "0.8rem 1rem", borderRadius: "0.6rem", border: "1px solid #cbd5e1" }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedGuarantors([...selectedGuarantors, m.id]);
                        } else {
                          setSelectedGuarantors(selectedGuarantors.filter(id => id !== m.id));
                        }
                      }}
                      style={{ width: "1.5rem", height: "1.5rem" }}
                    />
                    <span>{m.full_name || "SACCO Member"} ({m.member_number || "MEM-000"})</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

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
