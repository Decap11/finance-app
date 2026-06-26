import "../styles/summary-cards-row.css";
export default function SavingsSummaryCards() {
  return (
    <section className="summary-cards">
      <div className="card">
        <div className="card-header">
          <span className="card-title">Total SACCO Assets</span>
          <div
            className="card-icon"
            style={{ color: "#ff9800", backgroundColor: "#ff98001a" }}
          >
            <i className="fa-solid fa-building-columns"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> 64,500,000
        </div>
        <div className="card-change">
          <i className="fa-solid fa-arrow-trend-up change-positive"></i>
          <span className="change-positive">+2.4%</span>
          <span>this week</span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Shares Pool Total</span>
          <div
            className="card-icon"
            style={{
              color: "#253b8e",
              backgroundColor: "#ebf0fe",
            }}
          >
            <i className="fa-solid fa-chart-pie"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> 42,000,000
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>
            8,400 Total Shares Distributed
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Development Fund</span>
          <div
            className="card-icon"
            style={{
              color: "#10b981",
              backgroundColor: "rgba(16, 185, 129, 0.1)",
            }}
          >
            <i className="fa-solid fa-seedling"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> 14,500,000
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>Steady weekly growth</span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Social Fund Pool</span>
          <div
            className="card-icon"
            style={{
              color: "#ef4444",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
            }}
          >
            <i className="fa-solid fa-handshake-angle"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> 8,000,000
        </div>
        <div className="card-change">
          <span style={{ color: "#8893a7" }}>Available for member support</span>
        </div>
      </div>
    </section>
  );
}
