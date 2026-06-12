export default function ShareContributionHabits() {
  return (
    <div className="features-area">
      <div className="quick-actions">
        <div className="section-header">
          <h3 className="section-title">Contribution Habits</h3>
        </div>
        <div style={{ marginTop: 15, paddingBottom: 5 }}>
          <h4
            style={{
              fontSize: 14,
              color: "var(--text-dark)",
              marginBottom: 8,
            }}
          >
            Shares Pool Consistency
            <span style={{ float: "right", color: "var(--success)" }}>
              100%
            </span>
          </h4>
          <div
            style={{
              width: "100%",
              height: 8,
              backgroundColor: "#f1f5f9",
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                backgroundColor: "var(--success)",
              }}
            />
          </div>

          <h4
            style={{
              fontSize: 14,
              color: "var(--text-dark)",
              marginBottom: 8,
            }}
          >
            Dev Fund Obligations
            <span style={{ float: "right", color: "var(--success)" }}>96%</span>
          </h4>
          <div
            style={{
              width: "100%",
              height: 8,
              backgroundColor: "#f1f5f9",
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: "96%",
                height: "100%",
                backgroundColor: "var(--success)",
              }}
            />
          </div>

          <h4
            style={{
              fontSize: 14,
              color: "var(--text-dark)",
              marginBottom: 8,
            }}
          >
            Social Fund Activity
            <span style={{ float: "right", color: "#ff9800" }}>45%</span>
          </h4>
          <div
            style={{
              width: "100%",
              height: 8,
              backgroundColor: "#f1f5f9",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "45%",
                height: "100%",
                backgroundColor: "#ff9800",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
