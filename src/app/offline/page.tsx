import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline - PEWOSA SACCO",
  description: "You are offline. Reconnect to see your SACCO records."
};

/**
 * Shown when a navigation is attempted with no connection and nothing cached for that URL.
 *
 * Says plainly that no figures are being shown, rather than showing a zero or a spinner that
 * never resolves. A member who sees "Shs 0" while offline has been told something false about
 * their savings; a member who sees this has been told the truth.
 *
 * Deliberately static and styled inline: it has to render from cache with no data, and it
 * cannot assume any stylesheet beyond the global one survived the network failure.
 */
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2.4rem",
        background: "#f8fafc",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif"
      }}
    >
      <div
        style={{
          maxWidth: "42rem",
          width: "100%",
          textAlign: "center",
          background: "#ffffff",
          border: "0.1rem solid #e2e8f0",
          borderRadius: "1.6rem",
          padding: "4rem 2.4rem",
          boxShadow: "0 0.4rem 1.6rem rgba(15, 23, 42, 0.06)"
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "6.4rem",
            height: "6.4rem",
            margin: "0 auto 2rem",
            borderRadius: "50%",
            background: "#eef2ff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2.8rem"
          }}
        >
          <i className="fa-solid fa-wifi" style={{ color: "#253b8e" }} />
        </div>

        <h1
          style={{
            fontSize: "2.2rem",
            fontWeight: 800,
            color: "#0f172a",
            margin: "0 0 1rem"
          }}
        >
          You&rsquo;re offline
        </h1>

        <p
          style={{
            fontSize: "1.5rem",
            lineHeight: 1.6,
            color: "#475569",
            margin: "0 0 1.2rem"
          }}
        >
          PEWOSA needs a connection to show your balances, contributions and loans.
        </p>

        <p
          style={{
            fontSize: "1.3rem",
            lineHeight: 1.6,
            color: "#64748b",
            margin: "0 0 2.8rem"
          }}
        >
          Nothing is shown here rather than a saved copy, because a figure from an earlier
          session could have changed since. Your records are safe and will be exactly as you
          left them.
        </p>

        <a
          href="/"
          style={{
            display: "inline-block",
            padding: "1.2rem 2.8rem",
            borderRadius: "0.8rem",
            background: "#253b8e",
            color: "#ffffff",
            fontSize: "1.4rem",
            fontWeight: 700,
            textDecoration: "none"
          }}
        >
          Try again
        </a>
      </div>
    </main>
  );
}
