import "../styles/UserLoanEligibity.css";
export default function UserLoanEligibity() {
  return (
    <div className="loan-widget">
      <div className="section-header" style={{ marginBottom: "20px" }}>
        <h3 className="section-title" style={{ fontSize: "16px" }}>
          Loan Eligibility
        </h3>
      </div>
      <div className="eligibility-content">
        <div className="eligibility-score">
          <div className="score-circle">
            <span className="score-value">85%</span>
          </div>
          <p className="score-label">Excellent</p>
        </div>
        <div className="eligibility-details">
          <div className="detail-item">
            <span className="detail-label">Max Loan Amount</span>
            <span className="detail-value">Shs 500,000</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Interest Rate</span>
            <span className="detail-value">8.5% p.a</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Repayment Period</span>
            <span className="detail-value">Up to 24 months</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Current Status</span>
            <span
              className="detail-value"
              style={{ color: "#10b981", fontWeight: 700 }}
            >
              Eligible
            </span>
          </div>
        </div>
      </div>
      <button className="btn-loan" style={{ width: "100%", marginTop: "15px" }}>
        Apply for Loan
      </button>
    </div>
  );
}
