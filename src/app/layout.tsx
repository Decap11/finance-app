import React, { ReactNode } from "react";
import type { Metadata } from "next";
import "../layout/layout.css";
import "../layout/responsive.css";
import GlobalErrorHandler from "../Components/GlobalErrorHandler";

const defaultSiteUrl = process.env.NEXT_PUBLIC_SITE_URL 
  ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
  : process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`
    : "https://finance-app-decap11.vercel.app";

const ogImageUrl = `${defaultSiteUrl}/og-preview.jpg`;

export const metadata: Metadata = {
  title: "PEWOSA SACCO - Smart SACCO Financial Management Platform",
  description: "Approve requests, manage permissions, track weekly share contributions, and oversee SACCO system activity with PEWOSA.",
  metadataBase: new URL(defaultSiteUrl),
  openGraph: {
    title: "PEWOSA SACCO - Smart SACCO Financial Management Platform",
    description: "Approve requests, manage permissions, track weekly share contributions, and oversee SACCO system activity with PEWOSA.",
    url: defaultSiteUrl,
    siteName: "PEWOSA SACCO",
    images: [
      {
        url: "/og-preview.jpg",
        secureUrl: ogImageUrl,
        width: 1200,
        height: 630,
        type: "image/jpeg",
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
        {/* Direct Open Graph Meta Tags for WhatsApp Crawler Compatibility */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="PEWOSA SACCO - Smart SACCO Financial Management Platform" />
        <meta property="og:description" content="Approve requests, manage permissions, track weekly share contributions, and oversee SACCO system activity with PEWOSA." />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:image:secure_url" content={ogImageUrl} />
        <meta property="og:image:type" content="image/jpeg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="PEWOSA SACCO - Smart SACCO Financial Management Platform" />
        <meta name="twitter:description" content="Approve requests, manage permissions, track weekly share contributions, and oversee SACCO system activity with PEWOSA." />
        <meta name="twitter:image" content={ogImageUrl} />
      </head>
      <body>
        <GlobalErrorHandler />
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
