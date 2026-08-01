import React from "react";
import type { Metadata } from "next";
import LandingPage from "../views/LandingPage";

const SITE_URL = "https://finance-app-decap11.vercel.app";
const OG_IMAGE_URL = `${SITE_URL}/og-preview.jpg`;

export const metadata: Metadata = {
  title: "PEWOSA SACCO - Smart SACCO Financial Management Platform",
  description: "Approve requests, manage permissions, track weekly share contributions, and oversee SACCO system activity with PEWOSA.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: "PEWOSA SACCO - Smart SACCO Financial Management Platform",
    description: "Approve requests, manage permissions, track weekly share contributions, and oversee SACCO system activity with PEWOSA.",
    url: SITE_URL,
    siteName: "PEWOSA SACCO",
    images: [
      {
        url: OG_IMAGE_URL,
        secureUrl: OG_IMAGE_URL,
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
    images: [OG_IMAGE_URL],
  },
};

export default function Page() {
  return <LandingPage />;
}
