import type { Metadata, Viewport } from "next";

/**
 * Resolves the public origin the site is served from.
 *
 * Order matters. NEXT_PUBLIC_SITE_URL wins so a custom domain can always be
 * pinned. VERCEL_PROJECT_PRODUCTION_URL is next because it is the *stable*
 * production domain; VERCEL_URL is deliberately last since it changes on every
 * single deployment and is often behind deployment protection, which makes it
 * useless to a link crawler.
 */
function resolveSiteUrl(): string {
  const candidate =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3001");

  const withProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  return withProtocol.replace(/\/+$/, "");
}

export const siteUrl = resolveSiteUrl();

export const siteName = "PEWOSA SACCO";

export const siteTitle =
  "PEWOSA SACCO - Smart SACCO Financial Management Platform";

export const siteDescription =
  "Empower members to apply, manage, and track loans effortlessly. Handle weekly share contributions, savings and approvals in one place.";

/**
 * Must stay in sync with the real dimensions of public/og-preview.jpg.
 * Crawlers trust these numbers to lay out the card before the image finishes
 * downloading, so a mismatch produces a broken or downgraded preview.
 */
export const ogImage = {
  path: "/og-preview.jpg",
  width: 1200,
  height: 630,
  type: "image/jpeg",
  alt: "PEWOSA SACCO - instant loans, contributions and savings on mobile",
} as const;

export const ogImageUrl = `${siteUrl}${ogImage.path}`;

export const siteMetadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName,
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: ogImage.path,
        secureUrl: ogImageUrl,
        width: ogImage.width,
        height: ogImage.height,
        type: ogImage.type,
        alt: ogImage.alt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [ogImage.path],
  },

  // Points the browser at /manifest.webmanifest, which src/app/manifest.ts serves. Without
  // this link the manifest is never fetched and the app is not installable, however correct
  // its contents.
  manifest: "/manifest.webmanifest",

  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    // iOS does not read the manifest for this. Declared here or the home screen icon is a
    // blurry screenshot of the page.
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },

  appleWebApp: {
    capable: true,
    title: "PEWOSA",
    // "default" keeps the iOS status bar legible against the app's light background;
    // "black-translucent" would let the white page run under the clock.
    statusBarStyle: "default",
  },

  // Safari otherwise turns anything that looks like an account or member number into a
  // tap-to-call link, which in this app means member numbers and amounts.
  formatDetection: { telephone: false },
};

/**
 * Next requires themeColor and viewport settings in their own export -- returning them from
 * `metadata` is silently ignored, which is how an app ends up installed with a white status
 * bar nobody chose.
 */
export const siteViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewportFit: "cover" lets the app paint into the safe areas on a notched phone, which is
  // what stops a standalone install from showing letterbox bars top and bottom.
  viewportFit: "cover",
  themeColor: "#253b8e",
};
