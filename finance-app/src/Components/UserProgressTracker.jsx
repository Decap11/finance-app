import "../styles/UserProgressTracker.css";
export default function UserProgressTracker() {
  return (
    <>
      {/* Contribution Progress Tracker */}
      <div className="progress-tracker">
        <div className="section-header" style={{ marginBottom: "20px" }}>
          <h3 className="section-title" style={{ fontSize: "16px" }}>
            Contribution Progress
          </h3>
        </div>
        <div className="progress-content">
          <div className="progress-item">
            <div className="progress-header">
              <span className="progress-name">Shares Pool</span>
              <span className="progress-percent">60%</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: "60%", backgroundColor: "#253b8e" }}
              ></div>
            </div>
            <p className="progress-info">Shs 30,000 / Shs 50,000 target</p>
          </div>

          <div className="progress-item">
            <div className="progress-header">
              <span className="progress-name">Development Fund</span>
              <span className="progress-percent">90%</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: "90%", backgroundColor: "#10b981" }}
              ></div>
            </div>
            <p className="progress-info">Shs 9,000 / Shs 10,000 target</p>
          </div>

          <div className="progress-item">
            <div className="progress-header">
              <span className="progress-name">Social Fund</span>
              <span className="progress-percent">45%</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: "45%", backgroundColor: "#ef4444" }}
              ></div>
            </div>
            <p className="progress-info">Shs 4,500 / Shs 10,000 target</p>
          </div>

          <div className="progress-summary">
            <div className="summary-item">
              <span>Total Contributed</span>
              <strong>Shs 43,500</strong>
            </div>
            <div className="summary-item">
              <span>Remaining Target</span>
              <strong>Shs 6,500</strong>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
