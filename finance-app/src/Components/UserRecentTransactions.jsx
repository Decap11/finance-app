import "../styles/UserRecentTransactionsTable.css";

export default function UserRecentTransactions() {
  return (
    <section className="recent-transactions-section">
      <div className="quick-actions" style={{ padding: "30px" }}>
        <div
          className="section-header"
          style={{ marginBottom: "25px", display: "flex" }}
        >
          <h3 className="section-title">Recent Transactions</h3>
          <a
            href="#"
            style={{
              color: "var(--primary-color)",
              textDecoration: "none",
              fontSize: "1.8rem",
              fontWeight: "600",
            }}
          >
            View All
            {/* <span>&#xfe40;</span> */}
          </a>
        </div>
        <div className="recent-transactions-table">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount </th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>May 20</td>
                <td>
                  <span className="transaction-badge deposit">
                    Share Purchase
                  </span>
                </td>
                <td className="amount-cell"> 5,000</td>
                <td>
                  <span className="status-badge success">Completed</span>
                </td>
              </tr>
              <tr>
                <td>May 15</td>
                <td>
                  <span className="transaction-badge withdrawal">
                    Social Fund
                  </span>
                </td>
                <td className="amount-cell"> 10,000</td>
                <td>
                  <span className="status-badge success">Completed</span>
                </td>
              </tr>
              <tr>
                <td>May 10</td>
                <td>
                  <span className="transaction-badge transfer">
                    Development
                  </span>
                </td>
                <td className="amount-cell"> 25,000</td>
                <td>
                  <span className="status-badge success">Completed</span>
                </td>
              </tr>
              <tr>
                <td>May 08</td>
                <td>
                  <span className="transaction-badge loan">Loan Request</span>
                </td>
                <td className="amount-cell"> 50,000</td>
                <td>
                  <span className="status-badge pending">Pending</span>
                </td>
              </tr>
              <tr>
                <td>May 05</td>
                <td>
                  <span className="transaction-badge deposit">
                    Share Purchase
                  </span>
                </td>
                <td className="amount-cell"> 2,500</td>
                <td>
                  <span className="status-badge success">Completed</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
