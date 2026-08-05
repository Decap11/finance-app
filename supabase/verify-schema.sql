-- ====================================================================================
-- Does the deployed database actually match this repository?
--
-- Migrations here are applied BY HAND. There is no tool tracking what ran, and several
-- mid-sequence files (0003, 0007, 0009, 0010) deliberately leave the database wide open --
-- 0009 disables Row Level Security outright -- with 0015 being the file that reverses all of
-- it. A sequence stopped at 0014, or a 0015 applied without 0019, or a single file skipped
-- because the browser tab was closed, produces a database that looks completely normal from
-- the application and is readable and writable by anyone holding the public anon key.
--
-- This script answers the question the README cannot: not "which files did somebody say they
-- ran", but "what is actually true of this database right now". It reads the system catalog,
-- so it cannot be fooled by a ledger that was updated optimistically, by a migration that
-- half-applied before erroring, or by an object dropped by hand months later.
--
-- HOW TO RUN
--   Open the Supabase SQL Editor, paste this whole file, Run. It only reads. It returns one
--   row per check, FAIL first.
--
-- WHEN TO RUN
--   After applying any migration; before trusting a database with real members' money; and
--   whenever the app behaves as though a feature "has never worked", which in this project
--   has three times turned out to be an unapplied file rather than a bug.
--
-- READING THE RESULT
--   FAIL  something the app depends on is absent, or something dangerous is present.
--   WARN  true, known, and accepted -- but you should know it. Not drift.
--   PASS  verified against the catalog.
-- ====================================================================================

with

-- The tables every check below draws on.
core_tables(t) as (
  values ('profiles'), ('saccos'), ('sacco_memberships'), ('accounts'), ('transactions'),
         ('loans'), ('loan_repayments'), ('loan_guarantors'), ('audit_events'),
         ('sacco_settings'), ('dividend_cycles'), ('dividend_allocations'), ('savings_vaults')
),

-- Policy names created by 0007 and 0010. Any of these still present means the permissive
-- era was never reversed: 0015 drops every one of them by name.
forbidden_policies(p) as (
  values ('profiles_select_policy'), ('profiles_insert_policy'), ('profiles_update_policy'),
         ('saccos_select_policy'), ('saccos_insert_policy'), ('saccos_update_policy'),
         ('sacco_memberships_select_policy'), ('sacco_memberships_all_policy'),
         ('accounts_select_policy'), ('accounts_all_policy'),
         ('sacco_settings_select_policy'), ('sacco_settings_all_policy'),
         ('Authenticated users access profiles'), ('Authenticated users access saccos'),
         ('Authenticated users access memberships'), ('Authenticated users access accounts'),
         ('Authenticated users access sacco_settings')
),

-- The policy set that should be live once 0015, 0019 and 0022 have all run. Note
-- transactions_insert_staff_fines is deliberately absent: 0015 creates it and 0022 drops it.
required_policies(p, mig) as (
  values ('profiles_select_all','0015'), ('profiles_insert_own','0015'),
         ('profiles_update_own','0015'), ('saccos_select_all','0015'),
         ('saccos_update_admin_only','0015'), ('accounts_select_own_or_staff','0015'),
         ('sacco_settings_select_all','0015'), ('sacco_settings_write_admin_only','0015'),
         ('loan_repayments_select_own_or_staff','0015'),
         ('loan_guarantors_select_involved','0015'), ('loan_guarantors_insert_by_borrower','0015'),
         ('audit_events_select_members','0015'), ('audit_events_insert_staff','0015'),
         ('dividend_cycles_select_members','0015'),
         ('dividend_allocations_select_own_or_staff','0015'),
         ('savings_vaults_owner_all','0015'),
         ('sacco_memberships_select_own_or_staff','0019'),
         ('sacco_memberships_insert_self_or_admin','0019'),
         ('sacco_memberships_update_admin_only','0019'),
         ('transactions_select_own_or_staff','0019'),
         ('transactions_insert_own_pending_contribution','0019'),
         ('loans_select_own_or_staff','0019')
),

-- Every function the app calls, against the migration that defines it. A missing name tells
-- you which file to run, not merely that something is wrong.
required_functions(fn, mig) as (
  values ('handle_new_user','0015'), ('register_new_sacco','0015'),
         ('execute_dividend_payout','0015'), ('calculate_dividend_preview','0015'),
         ('process_guarantor_response','0015'), ('reject_member_transaction','0015'),
         ('enforce_sacco_access_state','0016'),
         ('admin_sacco_for_member','0017'), ('make_member_admin','0017'),
         ('set_member_approval','0018'), ('delete_member_entirely','0018'),
         ('demote_sacco_admin','0018'),
         ('is_sacco_member','0019'), ('is_sacco_staff','0019'), ('is_sacco_admin','0019'),
         ('can_transact_in_sacco','0019'),
         ('initialize_member_accounts','0021'),
         ('get_sacco_total_balances','0022'), ('levy_member_fine','0022'),
         ('waive_member_fine','0022'),
         ('confirm_loan_application_fee','0023'), ('record_loan_repayment','0023'),
         ('apply_loan_late_fees','0023'), ('sync_loan_on_transaction_approval','0023'),
         ('account_type_for_category','0024'), ('approve_member_transaction','0024'),
         ('loan_is_open','0025'), ('request_loan','0026'), ('next_loan_number','0026'),
         ('get_sacco_capital_trend','0027'),
         ('log_historical_record','0030'), ('get_member_open_loans','0028'),
         ('meeting_week_of','0030'), ('meeting_dow','0030'),
         ('meeting_day_on_or_after','0030'), ('sacco_week_of','0030'),
         ('sacco_active_week','0030'), ('sacco_week_config','0030'),
         ('staff_sacco_for_caller','0030'), ('apply_sacco_week_anchor','0030'),
         ('finalize_historical_onboarding','0030'), ('start_new_sacco_cycle','0030'),
         ('set_member_join_date','0031'), ('set_all_member_join_dates','0031'),
         ('sacco_capital_on_hand','0034'), ('get_sacco_capital_position','0034'),
         ('my_group_code','0035'), ('is_my_sacco','0035'),
         ('shares_sacco_with','0035'), ('is_sacco_admin_or_founder','0035'),
         ('lookup_sacco_for_signup','0035')
),

-- Columns whose absence has actually broken a feature in production. 0029 exists solely
-- because transactions.reference was missing while every other column 0028 writes was there.
required_columns(tbl, col, mig) as (
  values ('transactions','week_number','0021'), ('transactions','fine_type','0022'),
         ('transactions','reference','0029'),
         ('saccos','late_fine_amount','0022'), ('sacco_settings','late_fine_amount','0022'),
         ('saccos','loan_application_fee','0023'),
         ('sacco_settings','loan_application_fee','0023'),
         ('loans','closed_at','0023'), ('loans','application_fee','0023'),
         ('loans','loan_number','0026'),
         ('sacco_settings','week_anchor_date','0030'), ('saccos','week_anchor_date','0030'),
         ('profiles','joined_on','0031'),
         ('transactions','share_count','0033'), ('transactions','unit_price','0033')
),

results(sort_key, check_name, status, detail) as (

  -- 1 -----------------------------------------------------------------------------------
  select 1, 'Core tables exist',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0 then 'all 13 present'
         else 'MISSING: ' || string_agg(t, ', ') end
  from core_tables where to_regclass('public.' || t) is null

  -- 2 -- the single most dangerous drift: 0009 turns RLS off, only 0015 turns it back on.
  union all
  select 2, 'Row Level Security is enabled everywhere',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0 then 'RLS on for every core table'
         else 'RLS IS OFF -- THE DATABASE IS OPEN: ' || string_agg(c.relname, ', ')
              || '. Apply 0015, then 0019.' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not c.relrowsecurity
    and c.relname in (select t from core_tables)

  -- 3 -----------------------------------------------------------------------------------
  union all
  select 3, 'Permissive pre-0015 policies are gone',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0 then 'none of 0007/0010''s open policies remain'
         else 'OPEN POLICY STILL LIVE (0015 never ran, or ran before 0010): '
              || string_agg(tablename || '.' || policyname, ', ') end
  from pg_policies
  where schemaname = 'public' and policyname in (select p from forbidden_policies)

  -- 4 -----------------------------------------------------------------------------------
  union all
  select 4, 'The 0015/0019 policy set is complete',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0 then 'all 22 policies present'
         else 'MISSING: ' || string_agg(p || ' (run ' || mig || ')', ', ') end
  from required_policies rp
  where not exists (
    select 1 from pg_policies
    where schemaname = 'public' and policyname = rp.p
  )

  -- 5 -- without 0019, every staff check aborts with infinite recursion.
  union all
  select 5, '0019''s recursion helpers exist',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0 then 'is_sacco_member / _staff / _admin / can_transact_in_sacco'
         else 'MISSING ' || string_agg(fn, ', ')
              || ' -- 0015 without 0019 leaves the app unusable (infinite recursion '
              || 'detected in policy for relation "sacco_memberships")' end
  from required_functions rf
  where rf.mig = '0019'
    and not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = rf.fn
    )

  -- 6 -----------------------------------------------------------------------------------
  union all
  select 6, 'Every function the app calls exists',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0 then 'all present'
         else 'MISSING: ' || string_agg(fn || ' -> run ' || mig, ', ' order by mig, fn) end
  from required_functions rf
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = rf.fn
  )

  -- 7 -----------------------------------------------------------------------------------
  union all
  select 7, 'Every column the app writes exists',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0 then 'all present'
         else 'MISSING: ' || string_agg(tbl || '.' || col || ' -> run ' || mig, ', ' order by mig) end
  from required_columns rc
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = rc.tbl and column_name = rc.col
  )

  -- 8 -- 0015 revokes UPDATE on profiles and re-grants only the harmless columns. Without
  --      that, a member can UPDATE their own row and set role = 'admin'.
  union all
  select 8, 'A member cannot promote themselves',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0 then '0015''s column-level REVOKE on profiles holds'
         else 'SELF-PROMOTION IS POSSIBLE -- authenticated may UPDATE profiles.'
              || string_agg(column_name, ', profiles.') || '. Apply 0015.' end
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'profiles'
    and grantee = 'authenticated' and privilege_type = 'UPDATE'
    and column_name in ('role', 'status', 'group_id', 'member_number')

  -- 9 -----------------------------------------------------------------------------------
  union all
  select 9, 'transactions.category accepts ''fines'' (0021)',
    case
      when to_regclass('public.transactions') is null then 'FAIL'
      when exists (
        select 1 from pg_constraint
        where conrelid = to_regclass('public.transactions') and contype = 'c'
          and pg_get_constraintdef(oid) like '%''fines''%'
      ) then 'PASS'
      else 'FAIL'
    end,
    case
      when to_regclass('public.transactions') is null then 'no transactions table'
      when exists (
        select 1 from pg_constraint
        where conrelid = to_regclass('public.transactions') and contype = 'c'
          and pg_get_constraintdef(oid) like '%''fines''%'
      ) then 'the check constraint lists ''fines'''
      else 'the CHECK still says ''fine'' while every caller writes ''fines'' -- '
           || 'levying a fine fails silently. Apply 0021.'
    end

  -- 10 -- without this, every postgres_changes subscription connects and then never fires.
  union all
  select 10, 'Realtime publication covers the subscribed tables (0020)',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    case when count(*) = 0 then 'all six tables published'
         else 'NOT PUBLISHED: ' || string_agg(t, ', ')
              || ' -- live counters will never update. Apply 0020.' end
  from (values ('transactions'), ('loans'), ('profiles'),
               ('accounts'), ('saccos'), ('sacco_settings')) as rt(t)
  where not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = rt.t
  )

  -- 11 -- known and accepted, but it decides what "secure" means above.
  union all
  select 11, 'Tables readable by anyone with the anon key',
    case when count(*) = 0 then 'PASS' else 'WARN' end,
    case when count(*) = 0 then 'no unconditional SELECT policies'
         else 'SELECT is unconditional on: ' || string_agg(distinct tablename, ', ')
              || '. These rows come back from PostgREST with the anon key that ships in the '
              || 'browser bundle, regardless of what the API routes enforce. Accepted as of '
              || '0015; see "Known gaps" in ai-context.md.' end
  from pg_policies
  where schemaname = 'public' and cmd = 'SELECT' and qual = 'true'

  -- 12 -- a search_path a caller controls is how a SECURITY DEFINER function gets hijacked.
  union all
  select 12, 'SECURITY DEFINER functions pin their search_path',
    case when count(*) = 0 then 'PASS' else 'WARN' end,
    case when count(*) = 0 then 'all pinned'
         else count(*) || ' of ' || (
                select count(*) from pg_proc p2
                join pg_namespace n2 on n2.oid = p2.pronamespace
                where n2.nspname = 'public' and p2.prosecdef
              ) || ' SECURITY DEFINER functions do not SET search_path. Known outstanding '
                || 'hardening item, not drift: ' || string_agg(proname, ', ' order by proname) end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and (p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))

  -- 13 -- the ledger, if 0032 has been applied. Convenience, not evidence.
  --
  -- Deliberately does NOT select from schema_migrations. Postgres resolves table references
  -- when it plans the statement, not when it runs the branch, so naming the table inside an
  -- untaken CASE arm would abort this entire script on every database that has not applied
  -- 0032 yet -- which is the exact situation the check exists to report.
  union all
  select 13, 'Migration ledger',
    case when to_regclass('public.schema_migrations') is null then 'WARN' else 'PASS' end,
    case when to_regclass('public.schema_migrations') is null
         then 'no schema_migrations table -- apply 0032 to start recording what runs'
         else 'present; read it with: select * from public.schema_migrations order by version. '
              || 'The checks above are the authority -- a ledger records what somebody said '
              || 'they ran, the catalog records what is true.'
    end

  -- 14 -- a shares amount must be a whole number of shares at the price actually agreed.
  --
  -- Three states, and the middle one is the reason this is checked separately from the
  -- columns in 7: a constraint left NOT VALID still governs every new write but means 0033
  -- found existing rows whose stated share count and stored amount are different claims
  -- about the same money. That is a real discrepancy sitting in the ledger, and it is
  -- invisible unless something asks.
  union all
  select 14, 'Shares amounts reconcile to a count and a price (0033)',
    case
      when not exists (
        select 1 from pg_constraint
        where conrelid = to_regclass('public.transactions')
          and conname = 'transactions_share_amount_consistent'
      ) then 'FAIL'
      when exists (
        select 1 from pg_constraint
        where conrelid = to_regclass('public.transactions')
          and conname = 'transactions_share_amount_consistent'
          and not convalidated
      ) then 'WARN'
      else 'PASS'
    end,
    case
      when not exists (
        select 1 from pg_constraint
        where conrelid = to_regclass('public.transactions')
          and conname = 'transactions_share_amount_consistent'
      ) then 'nothing stops a shares transaction being an amount that is not a multiple of '
             || 'any share price. Apply 0033.'
      when exists (
        select 1 from pg_constraint
        where conrelid = to_regclass('public.transactions')
          and conname = 'transactions_share_amount_consistent'
          and not convalidated
      ) then 'constraint present but NOT VALID -- it governs new writes, but existing rows '
             || 'disagree with it. List them: select id, profile_id, amount, share_count, '
             || 'unit_price from public.transactions where category = ''shares'' and '
             || 'share_count is not null and amount <> share_count * unit_price;'
      else 'every shares row with a stated count multiplies back to its amount'
    end

  -- 15 -- 0034 replaces two functions it does not create, so their presence proves
  --       nothing. Check 6 sees sacco_capital_on_hand and stops there; a file that
  --       errored after STEP 2 would leave the new functions defined, the dashboard
  --       reporting a capital figure that falls when a loan is approved, and the
  --       approval itself still willing to hand out money the SACCO does not hold.
  --       That is the worst of the three states and the only one nothing else detects.
  union all
  select 15, 'Approving a loan is checked against the money (0034)',
    case
      when not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'sacco_capital_on_hand'
      ) then 'FAIL'
      when not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'approve_member_transaction'
          and pg_get_functiondef(p.oid) like '%sacco_capital_on_hand%'
      ) then 'FAIL'
      when exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_sacco_capital_trend'
          and pg_get_functiondef(p.oid) not like '%loan_disbursement%'
      ) then 'FAIL'
      else 'PASS'
    end,
    case
      when not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'sacco_capital_on_hand'
      ) then 'lending is invisible to every capital figure and an admin can approve a '
             || 'loan the SACCO cannot fund. Apply 0034.'
      when not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'approve_member_transaction'
          and pg_get_functiondef(p.oid) like '%sacco_capital_on_hand%'
      ) then 'HALF-APPLIED 0034: the capital figure now falls when a loan is '
             || 'approved, but approve_member_transaction is still the 0024 version and '
             || 'will disburse past zero. Re-run 0034 from STEP 4.'
      when exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_sacco_capital_trend'
          and pg_get_functiondef(p.oid) not like '%loan_disbursement%'
      ) then 'HALF-APPLIED 0034: the trend still ignores lending, so the percentage on '
             || 'the card contradicts the figure above it. Re-run 0034 from STEP 3.'
      else 'a disbursement is measured against sacco_capital_on_hand, and the weekly '
           || 'trend counts lending on the same basis'
    end

  -- 16 -- The check that would have caught 0015. A policy with no TO clause applies to
  --       PUBLIC, which includes anon -- so "Users can view all profiles" USING (true)
  --       read as members seeing each other and behaved as the whole internet reading
  --       27 people's names, phones and emails. Presence of the right policy proves
  --       nothing here; what matters is that no policy on these tables reaches anon.
  --       pg_policies renders a policy with no TO clause as roles = {public}, which is
  --       the spelling that actually shows up -- 'anon' only appears when named outright.
  union all
  select 16, 'Member data is not readable by anonymous callers (0035)',
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename in ('profiles','saccos','sacco_memberships','sacco_settings')
          and ('anon' = any(roles) or 'public' = any(roles))
      ) then 'FAIL'
      when exists (
        select 1 from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('profiles','saccos','sacco_memberships','sacco_settings')
          and grantee = 'anon'
      ) then 'FAIL'
      when not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'lookup_sacco_for_signup'
      ) then 'FAIL'
      else 'PASS'
    end,
    case
      when exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename in ('profiles','saccos','sacco_memberships','sacco_settings')
          and ('anon' = any(roles) or 'public' = any(roles))
      ) then 'a policy on one of these tables still applies to anon or to PUBLIC -- every '
             || 'member''s name, phone and email is readable with the publishable key. '
             || 'List them: select tablename, policyname, roles, cmd from pg_policies where '
             || 'schemaname = ''public'' and tablename in (''profiles'',''saccos'','
             || '''sacco_memberships'',''sacco_settings''); then apply 0035.'
      when exists (
        select 1 from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('profiles','saccos','sacco_memberships','sacco_settings')
          and grantee = 'anon'
      ) then 'policies are scoped but anon still holds a table-level GRANT on one of these '
             || 'tables, so only the policy stands between the public and the data. '
             || 'Re-run 0035 from STEP 9.'
      when not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'lookup_sacco_for_signup'
      ) then 'HALF-APPLIED 0035: anonymous access is closed but lookup_sacco_for_signup is '
             || 'missing, so signup can no longer identify the group being joined and every '
             || 'new member auto-creates a duplicate SACCO. Re-run 0035 from STEP 8.'
      else 'no policy or grant on profiles, saccos, sacco_memberships or sacco_settings '
           || 'reaches anon, and signup can still find its SACCO'
    end

  -- 17 -- The database and the price list have to name the same plans. 0016 constrained
  --       subscription_plan to ('basic','premium','enterprise') while the catalogue in
  --       src/utils/subscriptionPlans.js sells basic, standard and premium -- so the plan
  --       most SACCOs belong on could not be stored, and a tier nothing sells could.
  --       The amount default matters for the same reason: 150,000 is not the price of any
  --       plan, and register_new_sacco sets no amount, so every tenant inherited it.
  --
  --       Nothing below names subscription_plan as a column. Postgres resolves every column
  --       in a statement before running any of it, so `where subscription_plan = ...` does
  --       not evaluate to false on a database that lacks the column -- it aborts the whole
  --       script with a parse error, taking the other sixteen checks with it. That is the
  --       exact database this check exists to describe, and the failure it must survive:
  --       the RLS checks above are the ones you cannot afford to lose. The row is read
  --       through to_jsonb instead, which resolves the name at run time and yields NULL for
  --       a key that is not there, and the table is reached through to_regclass, which
  --       returns NULL rather than throwing the way '...'::regclass does.
  union all
  select 17, 'Subscription plans match the price list (0016, 0036)',
    case
      when to_regclass('public.saccos') is null then 'FAIL'
      when not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'saccos'
          and column_name = 'subscription_plan'
      ) then 'FAIL'
      when not exists (
        select 1 from pg_constraint
        where conrelid = to_regclass('public.saccos')
          and conname = 'saccos_subscription_plan_check'
          and pg_get_constraintdef(oid) like '%standard%'
      ) then 'FAIL'
      when exists (
        select 1 from public.saccos s where to_jsonb(s) ->> 'subscription_plan' = 'enterprise'
      ) then 'FAIL'
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'saccos'
          and column_name = 'subscription_amount'
          and column_default like '150000%'
      ) then 'WARN'
      else 'PASS'
    end,
    case
      when to_regclass('public.saccos') is null then 'no saccos table'
      when not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'saccos'
          and column_name = 'subscription_plan'
      ) then '0016 NEVER RAN: saccos has no subscription_plan column at all, so nothing '
             || 'about billing exists on this database -- no plan, status, amount, start or '
             || 'expiry. Every tenant reads as an expired trial, the developer portal cannot '
             || 'price anybody, and 0036 has nothing to correct. Apply 0016, then 0036.'
      when not exists (
        select 1 from pg_constraint
        where conrelid = to_regclass('public.saccos')
          and conname = 'saccos_subscription_plan_check'
          and pg_get_constraintdef(oid) like '%standard%'
      ) then 'subscription_plan cannot hold ''standard'' -- the recommended plan on the '
             || 'payments page -- so activating it fails the CHECK constraint. Apply 0036.'
      when exists (
        select 1 from public.saccos s where to_jsonb(s) ->> 'subscription_plan' = 'enterprise'
      ) then 'HALF-APPLIED 0036: rows are still on the retired ''enterprise'' plan, which '
             || 'the catalogue does not sell and the developer portal cannot price. '
             || 'Re-run 0036 from STEP 1.'
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'saccos'
          and column_name = 'subscription_amount'
          and column_default like '150000%'
      ) then 'the constraint is right but subscription_amount still defaults to 150000, a '
             || 'price no plan charges, so every newly registered SACCO inherits it. '
             || 'Re-run 0036 from STEP 3.'
      else 'subscription_plan lists the same plans as the catalogue, nothing is on the '
           || 'retired enterprise tier, and new tenants no longer inherit a 150000 rate'
    end
)

select
  status,
  check_name,
  detail
from results
order by
  case status when 'FAIL' then 0 when 'WARN' then 1 else 2 end,
  sort_key;
