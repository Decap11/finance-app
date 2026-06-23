import { useState } from "react";
import "../styles/weeklyContributions.css";
export default function WeeklyContributions() {
  const [shares, setShares] = useState(0);
  //State to be lifted to parent component
  //   const [weeklyContributions, setWeeklyContributions] = useState({

  //    shares:{
  //       quantity:0,
  //       amount:0
  //    },

  //    developmentFund:{
  //       amount:1000
  //    },

  //    socialFund:{
  //       amount:0
  //    },

  //    totalWeeklyContribution:0,

  //    completedContributions:0,

  //    status:"due"

  // });
  const sharePrice = 5000;

  const handleSharesChange = (e) => {
    const val = Number(e.target.value) || 0;
    // constrain between 1 and 10
    if (val < 0) return;
    setShares(val);
  };
  function handleSharesPush() {
    alert("contributed a share");
  }
  function handleDevelopmentPush() {
    alert("contributed a Development Fund");
  }
  function handleSocialPush() {
    alert("Contributed a social fund");
  }

  return (
    <section className="contributions-section">
      <div className="quick-actions" style={{ padding: "30px" }}>
        <div
          className="section-header"
          style={{
            marginBottom: "25px",
            display: "flex",
            justifyContent: "space-around",
            width: "100%",
          }}
        >
          <h3 className="section-title">Weekly Contributions</h3>
          <span
            className="badge badge-pending"
            style={{
              backgroundColor: "rgba(245, 158, 11, 0.1)",
              color: "#f59e0b",
              padding: "0.6rem 1.2rem",
              borderRadius: "2rem",
              fontWeight: 700,
              fontSize: "1.2rem",
            }}
          >
            DUE THIS WEEK
          </span>
        </div>

        <div className="contribution-card">
          <div className="fund-info">
            <div
              className="fund-icon"
              style={{
                backgroundColor: "#ebf0fe",
                color: "#253b8e",
              }}
            >
              <i className="fa-solid fa-chart-pie"></i>
            </div>
            <div>
              <h4 className="fund-title">Shares Pool</h4>
              <p className="fund-desc">
                Contribute 1 to 10 shares (Shs 5,000 per share)
              </p>
            </div>
          </div>
          <div className="fund-input-area">
            <input
              type="number"
              id="sharesInput"
              className="number-input"
              min={1}
              max={10}
              placeholder="No. of Shares"
              value={shares || ""}
              onChange={handleSharesChange}
            />
            <div className="calculated-total" id="sharesTotal">
              Shs {shares ? shares * sharePrice : 0}
            </div>
            <button className="btn-pay" onClick={handleSharesPush}>
              Contribute
            </button>
          </div>
        </div>

        {/* 2. Development Fund */}
        <div className="contribution-card">
          <div className="fund-info">
            <div
              className="fund-icon"
              style={{
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                color: "#10b981",
              }}
            >
              <i className="fa-solid fa-seedling"></i>
            </div>
            <div>
              <h4 className="fund-title">Development Fund</h4>
              <p className="fund-desc">Fixed weekly contribution</p>
            </div>
          </div>
          <div className="fund-input-area">
            <input
              type="text"
              className="number-input"
              defaultValue="1,000"
              disabled
              style={{
                backgroundColor: "#f8fafc",
                color: "#64748b",
                cursor: "not-allowed",
                textAlign: "center",
              }}
            />
            <div className="calculated-total">Shs 1000</div>
            <button className="btn-pay" onClick={handleDevelopmentPush}>
              Contribute
            </button>
          </div>
        </div>

        {/* 3. Social Fund */}
        <div className="contribution-card">
          <div className="fund-info">
            <div
              className="fund-icon"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
              }}
            >
              <i className="fa-solid fa-handshake-angle"></i>
            </div>
            <div>
              <h4 className="fund-title">Social Fund</h4>
              <p className="fund-desc">Contribute any amount of your choice</p>
            </div>
          </div>
          <div className="fund-input-area">
            <input
              type="number"
              className="number-input"
              placeholder="Amount (Shs)"
              min={0}
            />
            <div className="calculated-total" style={{ visibility: "hidden" }}>
              -
            </div>
            <button className="btn-pay" onClick={handleSocialPush}>
              Contribute
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
// function ContribtionCard(
//   icon,
//   color,
//   backgroundColor,
//   fundTitle,
//   fundDesc,
//   shares,
//   sharePrice,
// ) {
//   <div className="contribution-card">
//     <div className="fund-info">
//       <div
//         className="fund-icon"
//         style={{
//           backgroundColor: backgroundColor,
//           color: color,
//         }}
//       >
//         <i className={icon}></i>
//       </div>
//       <div>
//         <h4 className="fund-title">{fundTitle}</h4>
//         <p className="fund-desc">{fundDesc}</p>
//       </div>
//     </div>
//     <div className="fund-input-area">
//       <input
//         type="number"
//         id="sharesInput"
//         className="number-input"
//         min={1}
//         max={10}
//         placeholder="No. of Shares"
//         value={shares || ""}
//         onChange={handleSharesChange}
//       />
//       <div className="calculated-total" id="sharesTotal">
//         Shs {shares ? shares * sharePrice : 0}
//       </div>
//       <button className="btn-pay">Contribute</button>
//     </div>
//   </div>;
// }
