import type { ReactNode } from "react";

/**
 * The page a member sees when something has gone wrong.
 *
 * Shared by error.tsx, global-error.tsx and not-found.tsx so a failure looks the same
 * wherever it is caught, and so the wording rules below are decided once.
 *
 * Styled inline, with no stylesheet import, on purpose. global-error.tsx replaces the root
 * layout entirely and does not receive the app's global styles at all -- a version of this
 * built on layout.css would render as unstyled text in exactly the situation where the app
 * has already failed once. Inline is also what src/app/offline/page.tsx does, for the same
 * reason.
 *
 * No hooks and no client directive, so both a Server Component (not-found) and a Client
 * Component (the two error boundaries) can render it. `action` is taken as a node rather than
 * a callback so the client-only parts -- an onClick that calls retry() -- stay in the files
 * that are already Client Components.
 *
 * WHAT THESE PAGES MUST NOT DO
 *
 * This is a savings app. A member who hits an error is looking at a screen where their money
 * should be, so the copy states that the records are intact and that nothing they did was
 * lost. Never show a raw error message: server errors are forwarded to the browser as a
 * generic message plus a digest precisely so internals do not leak, and a stack trace tells
 * a member nothing except that their SACCO's software is broken.
 */
export default function FailureNotice({
  icon,
  title,
  children,
  action,
  reference
}: {
  icon: string;
  title: string;
  children: ReactNode;
  action: ReactNode;
  reference?: string;
}) {
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
            fontSize: "2.8rem",
            color: "#253b8e"
          }}
        >
          {/* Font Awesome is loaded by the root layout, which global-error replaces -- so the
              glyph is a plain character that needs no icon font to render. */}
          {icon}
        </div>

        <h1 style={{ fontSize: "2.2rem", fontWeight: 800, color: "#0f172a", margin: "0 0 1rem" }}>
          {title}
        </h1>

        <div style={{ fontSize: "1.5rem", lineHeight: 1.6, color: "#475569", margin: "0 0 2.8rem" }}>
          {children}
        </div>

        {action}

        {/* The digest is the only thing that links what the member saw to the server log that
            explains it. Shown quietly rather than hidden, so it can be read out. */}
        {reference && (
          <p style={{ fontSize: "1.15rem", color: "#94a3b8", margin: "2.4rem 0 0", wordBreak: "break-all" }}>
            Reference: {reference}
          </p>
        )}
      </div>
    </main>
  );
}

/** The one button style these pages use, so the three files do not each invent one. */
export const failureActionStyle = {
  display: "inline-block",
  padding: "1.2rem 2.8rem",
  borderRadius: "0.8rem",
  background: "#253b8e",
  color: "#ffffff",
  fontSize: "1.4rem",
  fontWeight: 700,
  textDecoration: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit"
} as const;
