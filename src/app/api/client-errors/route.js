import { createClient } from '@supabase/supabase-js';
import { clientIp, checkRateLimit, tooManyRequests } from '../../../utils/rateLimit';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * Where client-side failures go.
 *
 * The gap this closes: the error boundaries added in 822f71f show a member a digest and
 * tell them their records are safe. Next.js writes the matching server-side entry for
 * errors thrown while rendering on the server -- but an error thrown in the browser, which
 * is most of them in an app this client-heavy, never left the browser at all. So the member
 * has a reference number and the operator has nothing to look it up in. That is the state
 * the production readiness report called being blind to the first "my balance is wrong".
 *
 * Deliberately console.error and not a database table. On Vercel these become function log
 * entries, which are searchable by digest immediately and cost nothing to operate; a table
 * would need a migration, a retention policy, and a screen to read it. If this outgrows the
 * log, the shape below is already what a Sentry beforeSend receives, so the swap is local
 * to this file.
 *
 * Unauthenticated on purpose. An error on the login page is exactly the kind worth hearing
 * about, and requiring a session would filter out the failures that matter most. That makes
 * it a public write endpoint, so it is rate limited and everything it records is bounded
 * and truncated -- an endpoint that logs unbounded attacker-supplied text is a way to fill
 * a log budget.
 */

const REPORT_LIMIT = 60;
const REPORT_WINDOW_SECONDS = 3600;

/** Nothing recorded here needs to be long. Truncation is per-field and unconditional. */
const LIMITS = {
  digest: 128,
  message: 512,
  source: 256,
  stack: 2048,
  userAgent: 256
};

/**
 * Anything shaped like a credential is dropped rather than truncated.
 *
 * A stack trace or a URL can carry an access token -- supabase-js puts them in query
 * strings during the OAuth exchange, and this app keeps them in localStorage where an error
 * serialiser may well reach them. Logging one would turn an error reporter into the
 * credential leak the CSP is there to prevent.
 */
const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // a JWT
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g,
  /(access_token|refresh_token|apikey|api_key|password)=[^&\s"']+/gi
];

function scrub(value, max) {
  if (typeof value !== 'string') return null;
  let out = value;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out.slice(0, max);
}

export async function POST(request) {
  try {
    if (supabaseServiceKey) {
      const limiter = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false }
      });

      const { allowed } = await checkRateLimit(limiter, {
        bucket: 'client-errors',
        identifier: clientIp(request),
        limit: REPORT_LIMIT,
        windowSeconds: REPORT_WINDOW_SECONDS
      });

      if (!allowed) return tooManyRequests(REPORT_WINDOW_SECONDS);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      // A report that cannot be parsed is not worth a 400 the browser will never read.
      return new Response(null, { status: 204 });
    }

    // next.config.js points the CSP report-uri here. Browsers post those under their own
    // envelope and content type, so they arrive looking nothing like a boundary report.
    const cspReport = body?.['csp-report'];
    if (cspReport) {
      console.error('[csp-report]', JSON.stringify({
        blocked: scrub(cspReport['blocked-uri'], LIMITS.source),
        directive: scrub(cspReport['violated-directive'], LIMITS.source),
        document: scrub(cspReport['document-uri'], LIMITS.source)
      }));
      return new Response(null, { status: 204 });
    }

    const record = {
      at: new Date().toISOString(),
      // The join between what the member reads off the screen and this entry. Everything
      // else here is context; without this the report cannot be matched to a complaint.
      digest: scrub(body?.digest, LIMITS.digest),
      boundary: body?.boundary === 'global' ? 'global' : 'segment',
      message: scrub(body?.message, LIMITS.message),
      path: scrub(body?.path, LIMITS.source),
      stack: scrub(body?.stack, LIMITS.stack),
      userAgent: scrub(request.headers.get('user-agent'), LIMITS.userAgent)
    };

    console.error('[client-error]', JSON.stringify(record));

    // 204 rather than an echo. The reporter is a failure path -- it should never give the
    // page something new to fail on, and there is nothing useful to say back.
    return new Response(null, { status: 204 });
  } catch (err) {
    // The error reporter must not itself become an error. Swallowed, logged, 204.
    console.error('[client-error] intake failed', err?.message);
    return new Response(null, { status: 204 });
  }
}
