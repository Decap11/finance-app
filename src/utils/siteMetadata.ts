import type { Metadata } from "next";

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
};
