import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import "../styles/UserRecentTransactionsTable.css";

export default function UserRecentTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTransactions() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('profile_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (data && !error) {
        setTransactions(data);
      }
      setLoading(false);
    }
    fetchTransactions();
  }, []);

  return (
    <section className="recent-transactions-section">
      <div className="quick-actions">
        <div
          className="section-header"
          style={{ marginBottom: "25px", display: "flex" }}
        >
          <h3 className="section-title">Recent Transactions</h3>
          <a
            href="/transactions"
            style={{
              color: "var(--primary-color)",
              textDecoration: "none",
              fontSize: "1.8rem",
              fontWeight: "600",
            }}
          >
            View All
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
              {loading ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: "center", padding: "1rem" }}>
                    Loading transactions...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: "center", padding: "1rem" }}>
                    No recent transactions.
                  </td>
                </tr>
              ) : (
                transactions.map((transaction) => {
                  const dateObj = new Date(transaction.created_at);
                  const formattedDate = dateObj.toLocaleDateString();
                  
                  // Map category to a friendly display string
                  let displayType = transaction.category;
                  if (displayType === "social_fund") displayType = "Social Fund";
                  if (displayType === "development_fund") displayType = "Development";
                  if (displayType === "shares") displayType = "Shares";
                  if (displayType === "savings") displayType = "Savings";

                  return (
                    <tr key={transaction.id}>
                      <td>
                        {formattedDate}
                        <br></br>
                      </td>
                      <TransactionTypeBadge type={displayType} />
                      <td className="amount-cell">{Number(transaction.amount).toLocaleString()}</td>
                      <td>
                        <span
                          className={`status-badge ${
                            transaction.status === "completed" || transaction.status === "approved"
                              ? "success"
                              : transaction.status === "pending" ? "pending" : "danger"
                          }`}
                        >
                          {transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
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
    Shares: { color: "#253b8e", backgroundColor: "#ebf0fe" },
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
