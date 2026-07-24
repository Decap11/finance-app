import "../styles/summary-cards-row.css";

export default function ActionCards({ title, color, bgColor, iconColor, borderColor, icon, info, subInfo }) {
  const badgeBg = bgColor || color || "#f8fafc";
  const iconClr = iconColor || "var(--primary-color)";
  const borderClr = borderColor || "transparent";

  return (
    <div className="card" style={{ borderLeft: `4px solid ${borderClr}` }}>
      <div className="card-header">
        <span className="card-title">{title}</span>
        <div className="card-icon" style={{ backgroundColor: badgeBg, color: iconClr }}>
          <i className={icon} style={{ color: iconClr }}></i>
        </div>
      </div>
      <div className="card-amount">{info}</div>
      <div className="card-change">
        <i className="fa-solid fa-circle-info" style={{ color: iconClr, marginRight: "0.6rem" }}></i>
        <span>{subInfo}</span>
      </div>
    </div>
  );
}
