import React, { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "../layout/layout.css";
import "../layout/responsive.css";
import GlobalErrorHandler from "../Components/GlobalErrorHandler";
import ServiceWorkerRegistrar from "../Components/ServiceWorkerRegistrar";
import PwaInstallBanner from "../Components/PwaInstallBanner";
import { ToastProvider } from "../context/ToastContext";
import { siteMetadata, siteViewport } from "../utils/siteMetadata";

export const metadata: Metadata = siteMetadata;
export const viewport: Viewport = siteViewport;

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <head>
        {/* The icon <link> tags are emitted from `metadata.icons` in siteMetadata.ts -- they
            were hand-written here and pointed at a favicon.svg that did not exist. */}
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
        <ServiceWorkerRegistrar />
        <PwaInstallBanner />
        {/* Every route sits inside this. ToastProvider was written, styled and imported by
            three components, but never actually mounted anywhere -- so useToast() always
            hit its missing-provider fallback and every toast in the app, including error
            messages, went to the console instead of the screen.

            It wraps #root rather than sitting inside it so the fixed-position toast
            container cannot be clipped or re-stacked by anything the page renders. */}
        <ToastProvider>
          <div id="root">{children}</div>
        </ToastProvider>
      </body>
    </html>
  );
}
