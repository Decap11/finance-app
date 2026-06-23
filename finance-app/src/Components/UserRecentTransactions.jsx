import "../styles/UserRecentTransactionsTable.css";
const transactionsData = [
  {
    id: "T001",
    type: "Development",
    txAmount: 2000,
    status: "Completed",
    period: "Week 5",
    date: "2026-06-21",
  },

  {
    id: "T002",
    type: "Shares Purchase",
    txAmount: 20000,
    status: "Pending",
    period: "Week 5",
    date: "2026-06-20",
  },

  {
    id: "T003",
    type: "Social Fund",
    txAmount: 2000,
    status: "Completed",
    period: "Week 2",
    date: "2026-06-15",
  },

  {
    id: "T004",
    type: "Shares Purchase",
    txAmount: 5000,
    status: "Completed",
    period: "Week 4",
    date: "2026-06-18",
  },

  {
    id: "T005",
    type: "Development",
    txAmount: 3000,
    status: "Pending",
    period: "Week 5",
    date: "2026-06-22",
  },
];
export default function UserRecentTransactions() {
  // const [transactionWeek, setTransactionWeek] = useState([]);
  // const [transactionType, setTransactionype] = useState([]);

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
              {/* 2. Map through the data array to render rows dynamically */}
              {transactionsData.map((transaction) => (
                <tr key={transaction.id}>
                  <div>
                    <td>{transaction.date}</td>
                    <br></br>
                    <span className="period">{transaction.period}</span>
                  </div>

                  {/* Pass only the type; the component handles the styling */}
                  <TransactionTypeBadge type={transaction.type} />
                  <td className="amount-cell">{transaction.txAmount}</td>
                  <td>
                    {/* Render status dynamically based on the string */}
                    <span
                      className={`status-badge ${
                        transaction.status === "Completed"
                          ? "success"
                          : "pending"
                      }`}
                    >
                      {transaction.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

//Updating the badge component to handle conditional rendering
function TransactionTypeBadge({ type }) {
  const typeStyles = {
    "Social Fund": { color: "#ef4444", backgroundColor: "#ef44441a" },
    Development: { color: "#10b981", backgroundColor: "#10b9811a" },
    "Loan Request": { color: "#d97706", backgroundColor: "#fef3c7" }, // Extrapolated colors for the loan badge
    "Shares Purchase": { color: "#253b8e", backgroundColor: "#ebf0fe" },
  };
  // Fallback styling just in case a type comes back that isn't in the map above
  const defaultStyle = { color: "#4b5563", backgroundColor: "#f3f4f6" };

  // Select the style based on the type, or use the default
  const currentStyle = typeStyles[type] || defaultStyle;

  return (
    <td>
      <span
        className="transaction-badge transfer"
        style={{
          color: currentStyle.color,
          backgroundColor: currentStyle.backgroundColor,
        }}
      >
        {type}
      </span>
    </td>
  );
}
