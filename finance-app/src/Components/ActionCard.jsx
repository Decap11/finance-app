import "../styles/summary-cards-row.css";

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
