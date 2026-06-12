import "../styles/summary-cards-row.css";
export default function UserSummaryCards() {
  return (
    <section className="summary-cards">
      <div className="card">
        <div className="card-header">
          <span className="card-title">Total SACCO Balance</span>
          <div
            className="card-icon"
            style={{
              color: "#ffffff",
              backgroundColor: "rgba(37, 59, 142, 0.1)",
            }}
          >
            <i className="fa-solid fa-sack-dollar"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> 2,450,000
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">My Shares Value</span>
          <div
            className="card-icon"
            style={{
              color: "#f59e0b",
              backgroundColor: "rgba(245, 158, 11, 0.1)",
            }}
          >
            <i className="fa-solid fa-chart-pie"></i>
          </div>
        </div>
        <div className="card-amount">
          <span>Ugx</span> 800,000
        </div>
        <div className="card-change">
          <span style={{ color: "#64748b" }}>160 Shares @ 5,000</span>
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
          <span>Ugx</span> 64,000
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Social Fund</span>
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
          <span>Ugx</span> 250,500
        </div>
      </div>
    </section>
  );
}
