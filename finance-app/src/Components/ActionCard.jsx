import "../styles/summary-cards-row.css";

//As we render the cards as a list, we shall pass the data/ entire object as props to the card component and then destructure it in the component to access the individual properties

export default function ActionCards({ title, color, icon }) {
  // console.log(title, color, icon);
  return (
    <div className="card card-pending-approvals">
      <div className="card-header">
        <span className="card-title">{title}</span>
        <div className="card-icon" style={{ backgroundColor: color }}>
          <i className={icon}></i>
        </div>
      </div>
      <div className="card-amount card-amount-pending-approvals">
        14 Requests
      </div>
      <div className="card-change">
        <i className="fa-solid fa-circle-exclamation card-exclamation-pending-approvals"></i>
        <span>Require Immediate Action</span>
      </div>
    </div>
  );
}
