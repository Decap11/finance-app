import "../styles/savingsLatestMemberTransactions.css";
export default function SavingsLatestMemberTransactions() {
  return (
    <div className="recent-transactions">
      <div className="section-header">
        <h3 className="section-title">Latest Member Contributions</h3>
        <a href="#">See All</a>
      </div>

      <div className="transaction-list">
        {/* Transaction 1 */}
        <div className="transaction-item">
          <div className="tx-info">
            <div
              className="tx-icon"
              style={{
                backgroundColor: "#ebf0fe",
                color: "#253b8e",
              }}
            >
              <i className="fa-solid fa-chart-pie"></i>
            </div>
            <div className="tx-details">
              <h4>Sarah N. (Mem. 0014)</h4>
              <p>Shares Pool - 4 Shares</p>
            </div>
          </div>
          <div className="tx-right">
            <div className="tx-amount positive">+ Shs 20,000</div>
            <div className="tx-status status-completed">Completed</div>
          </div>
        </div>

        {/* Transaction 2 */}
        <div className="transaction-item">
          <div className="tx-info">
            <div
              className="tx-icon"
              style={{
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                color: "#10b981",
              }}
            >
              <i className="fa-solid fa-seedling"></i>
            </div>
            <div className="tx-details">
              <h4>David K. (Mem. 0005)</h4>
              <p>Development Fund</p>
            </div>
          </div>
          <div className="tx-right">
            <div className="tx-amount positive">+ Shs 1,000</div>
            <div className="tx-status status-completed">Completed</div>
          </div>
        </div>

        {/* Transaction 3 */}
        <div className="transaction-item">
          <div className="tx-info">
            <div
              className="tx-icon"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
              }}
            >
              <i className="fa-solid fa-handshake-angle"></i>
            </div>
            <div className="tx-details">
              <h4>Peter L. (Mem. 0021)</h4>
              <p>Social Fund</p>
            </div>
          </div>
          <div className="tx-right">
            <div className="tx-amount positive">+ Shs 15,000</div>
            <div className="tx-status status-completed">Completed</div>
          </div>
        </div>

        {/* Transaction 4 */}
        <div className="transaction-item">
          <div className="tx-info">
            <div
              className="tx-icon"
              style={{
                backgroundColor: "#ebf0fe",
                color: "#253b8e",
              }}
            >
              <i className="fa-solid fa-chart-pie"></i>
            </div>
            <div className="tx-details">
              <h4>Joseph S. (Mem. 0042)</h4>
              <p>Shares Pool - 10 Shares</p>
            </div>
          </div>
          <div className="tx-right">
            <div className="tx-amount positive">+ Shs 50,000</div>
            <div className="tx-status status-completed">Completed</div>
          </div>
        </div>
      </div>
    </div>
  );
}
