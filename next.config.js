import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Where the app legitimately talks to. Read at build time, because the Supabase project
 * differs between deployments and a hardcoded host would silently block every request in
 * whichever environment it did not match.
 *
 * Realtime runs over a websocket on the same host, which connect-src treats as a separate
 * scheme -- omit the wss:// entry and every live counter in the app stops updating while
 * looking, from the UI, exactly like a table that is simply not changing.
 */
const supabaseOrigin = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseSocket = supabaseOrigin.replace(/^https:/, 'wss:');

/**
 * Content Security Policy, deliberately shipped in report-only mode first.
 *
 * The reason this is worth having at all is specific to how sessions are stored here.
 * src/supabaseClient.ts builds the client with no storage option, so supabase-js keeps the
 * access AND refresh token in localStorage, where any script on the origin can read them.
 * There is no httpOnly to fall back on: an XSS does not merely act as the user for the life
 * of the page, it exfiltrates a refresh token that keeps working from the attacker's own
 * machine afterwards. Bounding which scripts may run is the compensating control for that,
 * and it is why script-src matters more here than the usual boilerplate argument suggests.
 *
 * Report-only because two things in this codebase will violate a strict policy immediately:
 *
 *   - Server-rendered inline styles. ProtectedRoute and FailureNotice use large style={{}}
 *     objects; React sets those through the CSSOM on the client, but during SSR it emits
 *     them as style="..." attributes, which style-src governs.
 *   - Next's own hydration bootstrap, which is an inline script.
 *
 * Both are covered by 'unsafe-inline' below, which is a real weakening of script-src and
 * the thing to remove once nonces are wired up. Enforce this only after the report stream
 * is quiet -- switching the header name before then breaks the app in ways that look random.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline' is carrying Next's hydration bootstrap. See above.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  // placehold.co backs the logo onError fallback; data: and blob: cover generated content.
  "img-src 'self' data: blob: https://placehold.co",
  `connect-src 'self' ${supabaseOrigin} ${supabaseSocket}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'report-uri /api/client-errors'
].join('; ');

/**
 * Applied to every response. None of these depend on the request, so they belong here
 * rather than in a proxy: this is static configuration, and Next serves it without running
 * any code per request.
 */
const securityHeaders = [
  // Clickjacking. The admin screens carry "Mark Paid", "Waive" and "Confirm Shs ..." buttons
  // that move real money, which is exactly what an invisible overlay is worth building.
  // frame-ancestors in the CSP above is the modern equivalent, but that policy is still
  // report-only, so this is the one actually enforcing it today.
  { key: 'X-Frame-Options', value: 'DENY' },

  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // Full URL to same-origin, origin only to third parties. Group codes and member ids show
  // up in query strings on this app, and those should not ride along to fonts.googleapis.com.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // Nothing here uses a camera, microphone or location, so none of it should be reachable
  // by injected script either.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  },

  // Two years, subdomains included. No `preload` -- that submits the domain to a browser
  // list that is slow and awkward to reverse, which is a decision for whoever owns the
  // domain rather than a side effect of adding headers.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains'
  },

  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
