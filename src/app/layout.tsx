import React, { ReactNode } from "react";
import type { Metadata } from "next";
import "../layout/layout.css";
import "../layout/responsive.css";
import GlobalErrorHandler from "../Components/GlobalErrorHandler";

export const metadata: Metadata = {
  title: "PEWOSA SACCO - Smart SACCO Financial Management Platform",
  description: "Approve requests, manage permissions, track weekly share contributions, and oversee SACCO system activity with PEWOSA.",
  metadataBase: new URL("https://finance-app-decap11.vercel.app"),
  openGraph: {
    title: "PEWOSA SACCO - Smart SACCO Financial Management Platform",
    description: "Approve requests, manage permissions, track weekly share contributions, and oversee SACCO system activity with PEWOSA.",
    url: "https://finance-app-decap11.vercel.app",
    siteName: "PEWOSA SACCO",
    images: [
      {
        url: "/og-preview.jpg",
        width: 1200,
        height: 630,
        alt: "PEWOSA SACCO Admin Control and Financial Management Platform",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PEWOSA SACCO - Smart SACCO Financial Management Platform",
    description: "Approve requests, manage permissions, track weekly share contributions, and oversee SACCO system activity with PEWOSA.",
    images: ["/og-preview.jpg"],
  },
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
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
        <GlobalErrorHandler />
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
