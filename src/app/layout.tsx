import React, { ReactNode } from "react";
import type { Metadata } from "next";
import "../layout/layout.css";
import "../layout/responsive.css";
import GlobalErrorHandler from "../Components/GlobalErrorHandler";
import { siteMetadata } from "../utils/siteMetadata";

export const metadata: Metadata = siteMetadata;

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
