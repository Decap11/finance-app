-- ====================================================================================
-- MIGRATION 0037: A place to count requests, so public endpoints can be rate limited
-- ====================================================================================
--
-- The app has no rate limiting anywhere. A case-insensitive search of src/ for
-- rateLimit|throttle returns nothing, next.config.js sets no limits, and there is no
-- vercel.json, so no platform firewall rule either.
--
-- The endpoint that makes this worth fixing is POST /api/register-sacco. It is
-- unauthenticated by necessity -- it is the route that creates the session -- and it
-- calls supabaseAdmin.auth.admin.createUser() with the SERVICE ROLE key. Anyone who can
-- POST can create auth users and SACCO rows as fast as they can send requests. The cost
-- lands on the operator twice: junk tenants in the developer portal, and auth users are
-- a billed metric on paid Supabase tiers. It costs the sender close to nothing.
--
-- Why this lives in Postgres rather than in the route.
--
-- The obvious implementation -- a Map of ip -> count at module scope -- does not work on
-- serverless. Each invocation may land on a fresh instance, so the counter resets
-- constantly and the limit never trips. It would look implemented, pass a code review,
-- and do nothing, which is worse than leaving it out, because nobody checks a control
-- they believe is already there. A limiter needs state shared across invocations, and
-- the only shared state this app already has is this database.
--
-- The counting is done inside a function rather than by the caller because
-- read-then-write from the route would race: two simultaneous requests both read 4,
-- both write 5, and the fifth request through a limit of 5 is admitted. INSERT ... ON
-- CONFLICT DO UPDATE ... RETURNING settles it in one statement per request.
--
-- Re-runnable, as required. The table is created IF NOT EXISTS and the function is
-- CREATE OR REPLACE.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: The counter table
-- ====================================================================================
--
-- One row per (bucket, identifier, window). `bucket` names the thing being limited so
-- one table can serve several endpoints without them interfering -- 'register-sacco'
-- and 'client-errors' count separately for the same IP.
--
-- No foreign keys and no reference to profiles on purpose: this has to work for callers
-- who have no account, which is the entire population it is defending against.
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  bucket        text        NOT NULL,
  identifier    text        NOT NULL,
  window_start  timestamptz NOT NULL,
  hits          integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, identifier, window_start)
);

-- Supports the prune in STEP 3. The primary key already covers the lookup path.
CREATE INDEX IF NOT EXISTS rate_limit_hits_window_idx
  ON public.rate_limit_hits (window_start);

-- RLS on, and deliberately no policy. Nothing but the service role touches this table,
-- and the service role bypasses RLS -- so "no policy" is the correct configuration
-- rather than an omission. It means an anon or authenticated caller holding the
-- publishable key can neither read how close they are to a limit nor insert rows to
-- exhaust somebody else's.
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;


-- ====================================================================================
-- STEP 2: Ask, and count, in one statement
-- ====================================================================================
--
-- Returns TRUE when the request is allowed, FALSE when it is over the limit. The call
-- itself is what increments, so a caller cannot check without being counted.
--
-- SECURITY DEFINER so it can write to a table with no policies. It reads no user data
-- and takes no identity from auth.uid() -- the identifier is passed in by the route,
-- which is the only component in a position to know the caller's IP.
--
-- search_path is pinned. A SECURITY DEFINER function without it can be redirected by a
-- caller-controlled search_path to a table of their own choosing.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket          text,
  p_identifier      text,
  p_limit           integer,
  p_window_seconds  integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start timestamptz;
  v_hits         integer;
BEGIN
  IF p_bucket IS NULL OR p_identifier IS NULL OR p_limit IS NULL OR p_window_seconds IS NULL THEN
    RAISE EXCEPTION 'check_rate_limit: every argument is required';
  END IF;

  IF p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'check_rate_limit: limit and window must both be positive';
  END IF;

  -- Fixed windows rather than a sliding log: one row per caller per window instead of one
  -- row per request. A fixed window admits up to 2x the limit across a boundary, which is
  -- an acceptable trade for an abuse control that must not itself become a write amplifier.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limit_hits (bucket, identifier, window_start, hits)
  VALUES (p_bucket, p_identifier, v_window_start, 1)
  ON CONFLICT (bucket, identifier, window_start)
  DO UPDATE SET hits = public.rate_limit_hits.hits + 1
  RETURNING hits INTO v_hits;

  RETURN v_hits <= p_limit;
END;
$$;

-- Only the service role calls this. Revoking the public grant matters more than usual:
-- the function is SECURITY DEFINER and takes its own limit as an argument, so a caller
-- able to invoke it directly could pass a limit of 2000000000 and count themselves as
-- always-allowed, or inflate somebody else's bucket to lock them out.
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM public;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM authenticated;


-- ====================================================================================
-- STEP 3: Keep the table from growing forever
-- ====================================================================================
--
-- Nothing here runs on a schedule -- this project has no cron -- so the prune is folded
-- into the write path and fires roughly one call in a hundred. random() is fine for
-- this: it needs to happen eventually, not predictably.
CREATE OR REPLACE FUNCTION public.prune_rate_limit_hits(p_older_than interval DEFAULT '1 day')
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.rate_limit_hits WHERE window_start < now() - p_older_than;
$$;

REVOKE ALL ON FUNCTION public.prune_rate_limit_hits(interval) FROM public;
REVOKE ALL ON FUNCTION public.prune_rate_limit_hits(interval) FROM anon;
REVOKE ALL ON FUNCTION public.prune_rate_limit_hits(interval) FROM authenticated;


-- ====================================================================================
-- STEP 4: Record it
-- ====================================================================================
SELECT public.record_migration(
  '0037',
  'Adds rate_limit_hits plus check_rate_limit() and prune_rate_limit_hits(), giving '
  'public endpoints -- register-sacco first -- a request counter that survives across '
  'serverless invocations. An in-process counter cannot, which is why there was none.'
);


-- ====================================================================================
-- Verify, after running:
--
--   -- Allowed three times, refused on the fourth:
--   SELECT public.check_rate_limit('verify', 'tester', 3, 60);   -- t
--   SELECT public.check_rate_limit('verify', 'tester', 3, 60);   -- t
--   SELECT public.check_rate_limit('verify', 'tester', 3, 60);   -- t
--   SELECT public.check_rate_limit('verify', 'tester', 3, 60);   -- f
--
--   -- Then clean up the test rows:
--   DELETE FROM public.rate_limit_hits WHERE bucket = 'verify';
--
-- The app fails OPEN if this migration has not been applied: the route logs loudly and
-- admits the request, because a signup page that refuses everyone is a worse outcome
-- than the unlimited signup page that exists today. Until this runs, there is no limit.
-- ====================================================================================
