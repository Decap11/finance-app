import PromoBanner from "../Components/PromoBanner";
export default function FundDistributionMix() {
  return (
    <div className="features-area">
      {/* Fund Pool Distribution Visual */}
      <div className="quick-actions">
        <div className="section-header">
          <h3 className="section-title">Fund Distribution Mix</h3>
        </div>
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            <span style={{ color: "#ff9800" }}>Shares (65%)</span>
            <span style={{ color: "#10b981" }}>Dev Fund (22%)</span>
            <span style={{ color: "#ef4444" }}>Social (13%)</span>
          </div>
          {/* Distribution Bar */}
          <div
            style={{
              width: "100%",
              height: 20,
              borderRadius: 20,
              display: "flex",
              overflow: "hidden",
              marginBottom: 30,
            }}
          >
            <div style={{ width: "65%", backgroundColor: "#ff9800" }} />
            <div style={{ width: "22%", backgroundColor: "#10b981" }} />
            <div style={{ width: "13%", backgroundColor: "#ef4444" }} />
          </div>

          <p
            style={{
              color: "var(--text-light)",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            The Shares Pool continues to represent the core driver of our SACCO
            capital, currently holding 8,400 active shares purchased by our 28
            registered members. Development and Social funds are actively being
            utilized for planned projects and member interventions.
          </p>
        </div>
      </div>
      <PromoBanner />
    </div>
  );
}
