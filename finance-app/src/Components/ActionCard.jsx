import "../styles/summary-cards-row.css";

//As we render the cards as a list, we shall pass the data/ entire object as props to the card component and then destructure it in the component to access the individual properties

// const cardData = [
//   {
//     title: "Total Savings",
//     value: dashboard?.totalSavings,
//     icon: "fa-solid fa-piggy-bank",
//     color: "#4CAF50",
//     subtitle: "Accumulated savings",
//   },

//   {
//     title: "Weekly Contributions",
//     value: `${dashboard?.weeklyContributions.completed}/${dashboard?.weeklyContributions.required}`,
//     icon: "fa-solid fa-money-bill",
//     color: "#2196F3",
//     subtitle: "Completed this week",
//   },

//   {
//     title: "Active Loan",
//     value: dashboard?.activeLoan.amount,
//     icon: "fa-solid fa-hand-holding-dollar",
//     color: "#FF9800",
//     subtitle: `Balance: UGX ${dashboard?.activeLoan.balance}`,
//   },

//   {
//     title: "Pending Approvals",
//     value: dashboard?.pendingApprovals,
//     icon: "fa-solid fa-clock",
//     color: "#F44336",
//     subtitle: "Awaiting approval",
//   },

//   {
//     title: "Members",
//     value: dashboard?.activeMembers,
//     icon: "fa-solid fa-users",
//     color: "#9C27B0",
//     subtitle: "Registered members",
//   },
// ];

export default function ActionCards({ title, color, icon, info, subInfo }) {
  // console.log(title, color, icon);
  return (
    <div className="card card-pending-approvals">
      <div className="card-header">
        <span className="card-title">{title}</span>
        <div className="card-icon" style={{ backgroundColor: color }}>
          <i className={icon}></i>
        </div>
      </div>
      <div className="card-amount card-amount-pending-approvals">{info}</div>
      <div className="card-change">
        <i className="fa-solid fa-circle-exclamation card-exclamation-pending-approvals"></i>
        <span>{subInfo}</span>
      </div>
    </div>
  );
}
