/**
 * Request rate limiting, counted in Postgres.
 *
 * The counter cannot live in this process. Route handlers run on serverless instances that
 * are created and discarded per request, so a Map at module scope resets constantly and a
 * limit built on one never trips -- it would read as implemented and do nothing, which is
 * worse than having none, because nobody re-checks a control they believe is there. The
 * shared state is migration 0037's `check_rate_limit`, which counts and answers in a single
 * statement so two simultaneous requests cannot both read the same number.
 *
 * @see supabase/migrations/0037_20260806_rate-limiting.sql
 */

/** Roughly one call in a hundred also prunes. There is no cron in this project. */
const PRUNE_PROBABILITY = 0.01;

/**
 * Best available identifier for an anonymous caller.
 *
 * x-forwarded-for is a list appended to by each proxy, so the client is the FIRST entry --
 * taking the last yields the CDN's own address and buckets every visitor together, which
 * turns a per-caller limit into a global one that locks out the whole app at peak.
 *
 * A caller can put anything in this header, so this is not identity and must not be used as
 * such. On Vercel the platform overwrites it at the edge, which is what makes it usable
 * here; behind a different proxy, confirm that before trusting it. Callers with no
 * recoverable address share the 'unknown' bucket -- deliberately, since the alternative is
 * exempting exactly the requests most likely to be automated.
 */
export function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Counts this request and says whether it is within the limit.
 *
 * FAILS OPEN. If 0037 has not been applied, or the database is unreachable, the request is
 * admitted and a message is logged. That is the deliberate choice: the alternative is a
 * signup page that refuses everyone the moment the database hiccups, and admitting the
 * request is no worse than the unlimited behaviour this replaces. `degraded` is returned so
 * a caller can tell "within limit" from "not actually checked" -- and so the tests can
 * assert the distinction rather than inferring it.
 *
 * @param {object} admin        A service-role Supabase client.
 * @param {object} opts
 * @param {string} opts.bucket  Names the endpoint, so limits do not bleed across routes.
 * @param {string} opts.identifier
 * @param {number} opts.limit
 * @param {number} opts.windowSeconds
 * @returns {Promise<{allowed: boolean, degraded: boolean}>}
 */
export async function checkRateLimit(admin, { bucket, identifier, limit, windowSeconds }) {
  try {
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_bucket: bucket,
      p_identifier: identifier,
      p_limit: limit,
      p_window_seconds: windowSeconds
    });

    if (error) {
      console.error(
        `[rate-limit] ${bucket}: check_rate_limit failed, admitting the request. `
        + 'If this says the function does not exist, migration 0037 has not been applied '
        + 'and there is no rate limiting in force.',
        error.message
      );
      return { allowed: true, degraded: true };
    }

    if (Math.random() < PRUNE_PROBABILITY) {
      // Fire and forget. A failed prune is not worth delaying or failing a request over.
      Promise.resolve(admin.rpc('prune_rate_limit_hits', {})).catch(() => {});
    }

    // Only an explicit false refuses. A null -- which is what a function returning nothing
    // would give -- is treated as "could not tell", and this fails open.
    return { allowed: data !== false, degraded: data === null || data === undefined };
  } catch (err) {
    console.error(
      `[rate-limit] ${bucket}: could not reach the limiter, admitting the request.`,
      err?.message
    );
    return { allowed: true, degraded: true };
  }
}

/** The 429 body, shared so every limited endpoint answers in the same shape. */
export function tooManyRequests(retryAfterSeconds) {
  return Response.json(
    {
      error: 'Too many requests. Please wait a moment and try again.',
      retry_after_seconds: retryAfterSeconds
    },
    {
      status: 429,
      // Without this a client has no way to know how long to back off, and retries
      // immediately -- which is the behaviour the limit exists to dampen.
      headers: { 'Retry-After': String(retryAfterSeconds) }
    }
  );
}
