import "../styles/summary-cards-row.css";

export default function UserSummaryCards() {
  return (
    <section className="summary-cards">
      <Card
        title="My Total SACCO Capital"
        backgroundColor={"#f59e0b1a"}
        color={"#f59e0b"}
        icon="fa-solid fa-chart-pie"
        info=" 2,450,000"
        subInfo="Total shares value due week 4"
      />
      <Card
        title="My Shares Value"
        backgroundColor="#ebf0fe"
        color="#253b8e"
        icon="fa-solid fa-chart-pie"
        info=" 2,450,000"
        subInfo="Total shares value due week 4"
      />

      <Card
        title="Development Fund"
        backgroundColor="#10b9811a"
        color="#10b981"
        icon="fa-solid fa-seedling"
        info=" 450,000"
        subInfo="Total Development funds"
      />
      <Card
        title="Social Fund"
        backgroundColor="#ef44441a"
        color="#ef4444"
        icon="fa-solid fa-handshake-angle"
        info=" 50,000"
        subInfo="Total Development funds"
      />
    </section>
  );
}
function Card({ title, icon, info, subInfo, color, backgroundColor }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        <div
          className="card-icon"
          style={{
            color: color,
            backgroundColor: backgroundColor,
          }}
        >
          <i className={icon}></i>
        </div>
      </div>
      <div className="card-amount">
        <span>Ugx</span>
        {info}
      </div>
      <p className="subInfo">{subInfo}</p>
    </div>
  );
}
