import { useState } from "react";
import "../styles/loans.css";

export default function RecentLoansTransactions() {
  const [transactions] = useState([
    {
      id: 1,
      title: "Savings Deposit",
      time: "Today, 09:41 AM",
      amount: 50000,
      type: "deposit",
      status: "completed",
      icon: "fa-solid fa-arrow-down",
      isPositive: true,
    },
    {
      id: 2,
      title: "Loan Repayment",
      time: "Yesterday, 02:15 PM",
      amount: 120000,
      type: "withdraw",
      status: "completed",
      icon: "fa-solid fa-arrow-up",
      isPositive: false,
    },
    {
      id: 3,
      title: "Shares Purchase",
      time: "Oct 21, 11:30 AM",
      amount: 100000,
      type: "transfer",
      status: "pending",
      icon: "fa-solid fa-money-bill-transfer",
      isPositive: false,
    },
    {
      id: 4,
      title: "Dividends Payout",
      time: "Oct 15, 08:00 AM",
      amount: 35000,
      type: "deposit",
      status: "completed",
      icon: "fa-solid fa-arrow-down",
      isPositive: true,
    },
  ]);

  const getStatusClass = (status) => {
    switch (status) {
      case "completed":
        return "status-completed";
      case "pending":
        return "status-pending";
      default:
        return "";
    }
  };

  const formatAmount = (amount, isPositive) => {
    const sign = isPositive ? "+" : "-";
    return `${sign} Shs ${amount.toLocaleString()}`;
  };

  return (
    <div className="recent-transactions">
      <div className="section-header">
        <h3 className="section-title">Recent Activity</h3>
        <a href="#/">See All</a>
      </div>

      <div className="transaction-list">
        {transactions.map((transaction) => (
          <div key={transaction.id} className="transaction-item">
            <div className="tx-info">
              <div className={`tx-icon ${transaction.type}`}>
                <i className={transaction.icon}></i>
              </div>
              <div className="tx-details">
                <h4>{transaction.title}</h4>
                <p>{transaction.time}</p>
              </div>
            </div>
            <div className="tx-right">
              <div
                className={`tx-amount ${transaction.isPositive ? "positive" : "negative"}`}
              >
                {formatAmount(transaction.amount, transaction.isPositive)}
              </div>
              <div
                className={`tx-status ${getStatusClass(transaction.status)}`}
              >
                {transaction.status.charAt(0).toUpperCase() +
                  transaction.status.slice(1)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
