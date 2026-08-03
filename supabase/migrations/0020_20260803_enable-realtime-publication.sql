-- ====================================================================================
-- MIGRATION 0020: Put the tables the app subscribes to into the realtime publication
-- ====================================================================================
--
-- Symptom: an admin sitting on the dashboard does not see the Pending Approvals count go
-- up when a member files a contribution, and does not see it go down when another admin
-- approves one. Only a page reload moves the number.
--
-- Cause: `supabase.channel(...).on('postgres_changes', ...)` only ever delivers rows for
-- tables that belong to the `supabase_realtime` publication. Nothing in migrations 0001
-- through 0019 adds any table to it, so unless someone toggled Replication on in the
-- Dashboard, every one of those subscriptions is a silent no-op -- `.subscribe()` reports
-- SUBSCRIBED and then no event ever arrives.
--
-- These six are the tables the client actually subscribes to (adminDashboardPage,
-- ContributionApprovals, userSummaryCards, UserRecentTransactions, LoanRequestWidget,
-- LoanRepaymentWidget, UserProgressTracker, UserLoanEligibity, fundDistributionMix,
-- calendarHeatMap, savingsSummarycards, SavingsLatestMemberTransactions,
-- userweeklycontributions, manualContributionlog, saccoSettings, transactions/page).
--
-- Realtime still applies RLS per subscriber, so this grants no visibility that a plain
-- SELECT would not already give: after 0019 a member receives only their own rows and
-- staff receive only their own SACCO's.
--
-- Safe to re-run: each table is added only if it is not already published.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: REPLICA IDENTITY FULL
--
-- Without it an UPDATE or DELETE ships only the primary key as the old row, and Realtime
-- cannot evaluate RLS against a record it does not have -- so those events get dropped
-- for every non-service-role subscriber. The dashboard depends on UPDATE events
-- specifically (pending -> completed / rejected is an UPDATE, not an INSERT).
--
-- The cost is a larger WAL record per write. These tables carry a few rows per member per
-- week, so it is not a consideration here.
-- ====================================================================================
DO $$
DECLARE
  t TEXT;
  wanted TEXT[] := ARRAY[
    'transactions',
    'loans',
    'profiles',
    'accounts',
    'saccos',
    'sacco_settings'
  ];
BEGIN
  FOREACH t IN ARRAY wanted LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    END IF;
  END LOOP;
END $$;


-- ====================================================================================
-- STEP 2: Add them to the publication
--
-- ALTER PUBLICATION requires ownership of the publication. In the Supabase SQL Editor you
-- are `postgres`, which owns `supabase_realtime`, so this succeeds. If it is ever run as a
-- lesser role the block reports what to do by hand instead of aborting the file.
-- ====================================================================================
DO $$
DECLARE
  t TEXT;
  wanted TEXT[] := ARRAY[
    'transactions',
    'loans',
    'profiles',
    'accounts',
    'saccos',
    'sacco_settings'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Publication supabase_realtime does not exist -- Realtime is not provisioned on this database. Skipping.';
    RETURN;
  END IF;

  FOREACH t IN ARRAY wanted LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      RAISE NOTICE 'public.% is already published for realtime.', t;
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Added public.% to supabase_realtime.', t;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Not permitted to add public.% to supabase_realtime. Enable it by hand: Dashboard -> Database -> Replication -> supabase_realtime.', t;
    END;
  END LOOP;
END $$;
