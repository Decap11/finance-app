import type { MetadataRoute } from "next";
import { siteName, siteDescription } from "../utils/siteMetadata";

/**
 * The web app manifest, served by Next at /manifest.webmanifest.
 *
 * Written as a route rather than a static public/manifest.json so the name and description
 * come from the same place as the Open Graph tags -- those drifted apart once already, and a
 * manifest is the one copy of the app's name a member sees every day on their home screen.
 *
 * `export const dynamic = "force-static"` is deliberately NOT set: this reads only module
 * constants, so Next prerenders it at build time anyway.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteName,
    // What actually fits under a home screen icon. Android truncates around 12 characters,
    // so the long form is left to `name` (used in the install prompt and the app switcher).
    short_name: "PEWOSA",
    description: siteDescription,

    start_url: "/",
    // Members reach the app from an icon, not a URL bar, so `standalone` is what makes it
    // feel like an app. `id` pins the install identity: without it the browser derives one
    // from start_url, and later changing start_url would register as a second, separate app
    // rather than an update to this one.
    id: "/",
    display: "standalone",
    scope: "/",
    orientation: "portrait",

    // theme_color tints the status bar; background_color paints the splash screen while the
    // first render happens. background_color is white to match the app's light UI -- a navy
    // splash followed by a white app is a visible flash on every cold start.
    theme_color: "#253b8e",
    background_color: "#ffffff",

    lang: "en",
    dir: "ltr",
    categories: ["finance", "productivity", "business"],

    icons: [
      // `any` and `maskable` are separate entries on purpose. A single icon declared as both
      // gets the launcher's mask applied to artwork that was not padded for it, which crops
      // the logo; and the same icon shown unmasked elsewhere then looks over-padded.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
