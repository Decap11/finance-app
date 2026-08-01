import React from "react";
import type { Metadata } from "next";
import LandingPage from "../views/LandingPage";

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

export default function Page() {
  return <LandingPage />;
}
