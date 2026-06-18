export default function PromoBanner() {
  return (
    <div
      className="promo-banner"
      style={{
        marginTop: "2.4rem",
        background: "linear-gradient(135deg, #253b8e 0%, #1a2a68 100%)",
        borderRadius: 16,
        padding: 30,
        color: "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "0 10px 20px rgba(37, 59, 142, 0.2)",
      }}
    >
      <div>
        <h3 style={{ fontSize: 20, marginBottom: 10 }}>End of Year Target</h3>
        <p style={{ fontSize: 14, opacity: 0.9, marginBottom: 15 }}>
          We are currently at 80% to our 80,000,000 Shs collective goal!
        </p>
      </div>
      <i
        className="fa-solid fa-bullseye"
        style={{ fontSize: 60, opacity: 0.2 }}
      />
    </div>
  );
}
