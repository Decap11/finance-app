import "../layout/layout.css";
import "../layout/responsive.css";
import GlobalErrorHandler from "../Components/GlobalErrorHandler";
import { ToastProvider } from "../context/ToastContext";

export const viewport = {
  width: "device-width",
  initialScale: 1.0,
  maximumScale: 1.0,
};

export const metadata = {
  title: "PEWOSA SACCO - Multi-Tenant Cooperative & Financial Management Platform",
  description: "Enterprise SaaS platform for SACCO cooperatives, savings management, member loans, and financial tracking.",
  keywords: ["SACCO", "Savings", "Loans", "Cooperative Management", "Financial Software", "Uganda SACCO"],
  authors: [{ name: "PEWOSA Engineering" }],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
      </head>
      <body>
        <ToastProvider>
          <GlobalErrorHandler />
          <div id="root">{children}</div>
        </ToastProvider>
      </body>
    </html>
  );
}
