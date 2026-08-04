-- ====================================================================================
-- 0032: a record of which migrations have been applied.
--
-- Migrations here are run by hand in the SQL editor. Until now nothing recorded that, so the
-- only way to know whether a file had been applied was to go looking for the objects it
-- creates -- which is how 0028 came to be re-run repeatedly with no effect while the actual
-- problem was a column 0029 had not yet added.
--
-- WHAT THIS IS NOT
--
-- It is not proof. A ledger records what somebody said they ran. It cannot see a migration
-- that half-applied before erroring, an object dropped by hand afterwards, or a file marked
-- applied by mistake. `supabase/verify-schema.sql` reads the system catalog and reports what
-- is actually true; that script is the authority, and this table is a convenience beside it.
--
-- The backfill below reflects that. Rather than asserting 0001-0031 all ran, it records only
-- the ones whose handiwork is present in the catalog right now -- so the starting contents
-- are an observation rather than a claim.
--
-- Re-runnable: every statement is IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING.
-- ====================================================================================

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT NOT NULL DEFAULT current_user,
  note        TEXT
);

COMMENT ON TABLE public.schema_migrations IS
  'Which migration files have been applied. Written by record_migration(). Not authoritative '
  'on its own -- run supabase/verify-schema.sql to check the database against the repo.';

-- No policy is created, deliberately. With RLS enabled and no policy, the table is invisible
-- to anon and authenticated while remaining fully readable by the service role and by the
-- SQL editor. Deployment metadata is nobody's business from a browser.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;


-- ====================================================================================
-- record_migration('0033', 'optional note')
--
-- Call this as the LAST statement of every migration from here on, so the ledger is written
-- by the same transaction that did the work and cannot record a file that errored partway.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.record_migration(p_version TEXT, p_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.schema_migrations (version, note)
  VALUES (p_version, p_note)
  ON CONFLICT (version) DO UPDATE
    SET applied_at = now(),
        applied_by = current_user,
        note = COALESCE(EXCLUDED.note, public.schema_migrations.note);
END;
$$;

REVOKE ALL ON FUNCTION public.record_migration(TEXT, TEXT) FROM PUBLIC, anon, authenticated;


-- ====================================================================================
-- Backfill, by evidence rather than by assumption.
--
-- Each entry names one object that only its migration creates. Present means the file ran;
-- absent means it did not, and the row is left out rather than guessed at. Files that leave
-- no distinctive trace (data repairs, trigger rewrites) are not listed at all -- an absent
-- row here means "not established", never "did not run".
-- ====================================================================================
DO $$
DECLARE
  evidence CONSTANT TEXT[][] := ARRAY[
    ['0005', 'table',    'sacco_settings',                 ''],
    ['0013', 'table',    'dividend_cycles',                ''],
    ['0014', 'table',    'loan_guarantors',                ''],
    ['0015', 'policy',   'sacco_settings_write_admin_only', ''],
    ['0016', 'function', 'enforce_sacco_access_state',     ''],
    ['0017', 'function', 'admin_sacco_for_member',         ''],
    ['0018', 'function', 'demote_sacco_admin',             ''],
    ['0019', 'function', 'can_transact_in_sacco',          ''],
    ['0021', 'column',   'transactions',                   'week_number'],
    ['0022', 'column',   'transactions',                   'fine_type'],
    ['0023', 'function', 'record_loan_repayment',          ''],
    ['0024', 'function', 'account_type_for_category',      ''],
    ['0025', 'function', 'loan_is_open',                   ''],
    ['0026', 'column',   'loans',                          'loan_number'],
    ['0027', 'function', 'get_sacco_capital_trend',        ''],
    ['0028', 'function', 'get_member_open_loans',          ''],
    ['0029', 'column',   'transactions',                   'reference'],
    ['0030', 'column',   'sacco_settings',                 'week_anchor_date'],
    ['0031', 'column',   'profiles',                       'joined_on']
  ];
  i INT;
  found BOOLEAN;
BEGIN
  FOR i IN 1 .. array_length(evidence, 1) LOOP
    found := CASE evidence[i][2]
      WHEN 'table' THEN
        to_regclass('public.' || evidence[i][3]) IS NOT NULL
      WHEN 'column' THEN
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = evidence[i][3]
                   AND column_name = evidence[i][4])
      WHEN 'function' THEN
        EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = evidence[i][3])
      WHEN 'policy' THEN
        EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND policyname = evidence[i][3])
      ELSE FALSE
    END;

    IF found THEN
      INSERT INTO public.schema_migrations (version, note)
      VALUES (evidence[i][1], 'backfilled 0032: inferred from ' || evidence[i][2] || ' '
                              || evidence[i][3]
                              || CASE WHEN evidence[i][4] <> '' THEN '.' || evidence[i][4] ELSE '' END)
      ON CONFLICT (version) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;


SELECT public.record_migration('0032', 'migration ledger and record_migration()');
