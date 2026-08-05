-- ====================================================================================
-- Which migrations have actually been applied to this database?
--
-- WHY THIS EXISTS
--
-- verify-schema.sql answers "is this database safe and correct". This answers the question
-- that comes first when it is not: "how far through the sequence did we get". They are
-- different questions, and the second one used to be answered by applying a migration and
-- reading the error -- which tells you about exactly one missing object per attempt, in an
-- arbitrary order, and leaves a half-applied file behind each time.
--
-- HOW IT WORKS
--
-- Each migration is identified by one durable object it leaves behind: a function, a
-- column, a table, a policy, a constraint. Durable meaning a LATER migration does not
-- remove it -- so a marker found now really does mean that file ran at some point.
--
-- Five files leave no durable marker and are reported as such rather than guessed at:
-- 0004 and 0006 replace a function and backfill data, and 0003 and 0007 create policies that
-- 0015 drops by design. For those, read the neighbours.
--
-- Getting a marker wrong is not a harmless inaccuracy. 0003 was first checked by one of its
-- policies, all three of which 0015 removes -- so it reported MISSING on a database where it
-- had in fact run, and the obvious response to that, re-running it, would have restored
-- three WITH CHECK (true) INSERT policies that 0015 exists to remove. A marker has to be
-- something no later migration undoes, or the report argues for re-opening what was closed.
--
-- Every lookup goes through pg_catalog or information_schema, and no column is ever named
-- where the parser would try to resolve it, so this runs to completion on a database at any
-- point in the sequence -- including an empty one.
--
-- HOW TO RUN
--   Supabase SQL Editor, paste, Run. It only reads.
--
-- READING THE RESULT
--   Rows come back in migration order. The first MISSING is where to resume, but read the
--   whole list: a MISSING between two APPLIED rows means the sequence was not run in order,
--   and applying the rest on top of that gap is what produces errors like
--   `column "onboarding_date" of relation "saccos" does not exist`.
-- ====================================================================================

with markers(version, subject, kind, obj, attr) as (
  values
    ('0001', 'core schema and signup trigger',        'function',   'initialize_member_accounts', null),
    ('0002', 'RLS and core RPCs',                     'function',   'get_sacco_total_balances',   null),
    ('0003', 'signup insert policies (undone by 0015)', 'none',     null,                         null),
    ('0004', 'signup trigger patch',                  'none',       null,                         null),
    ('0005', 'sacco_settings + saccos settings cols', 'column',     'saccos',                     'onboarding_date'),
    ('0006', 'backfill of missing saccos',            'none',       null,                         null),
    ('0007', 'permissive RLS era (undone by 0015)',   'none',       null,                         null),
    ('0008', 'saccos.meeting_day dropped',            'no_column',  'saccos',                     'meeting_day'),
    ('0009', 'register_new_sacco RPC',                'function',   'register_new_sacco',         null),
    ('0010', 'complete setup',                        'column',     'saccos',                     'is_locked'),
    ('0011', 'approval authorization fix',            'function',   'approve_member_transaction', null),
    ('0012', 'membership name sync',                  'function',   'sync_sacco_membership_names', null),
    ('0013', 'dividends and vaults',                  'table',      'dividend_cycles',            null),
    ('0014', 'peer guarantors',                       'table',      'loan_guarantors',            null),
    ('0015', 'SECURITY HARDENING -- restores RLS',    'policy',     'audit_events',               'audit_events_select_members'),
    ('0016', 'subscription holds',                    'column',     'saccos',                     'subscription_plan'),
    ('0017', 'member management RPCs',                'function',   'set_member_approval',        null),
    ('0018', 'demote sacco admin',                    'function',   'demote_sacco_admin',         null),
    ('0019', 'membership policy recursion fix',       'function',   'is_sacco_staff',             null),
    ('0020', 'realtime publication',                  'published',  'transactions',               null),
    ('0021', 'fines category repair',                 'constraint', 'transactions_category_check', 'fines'),
    ('0022', 'fines fund pool',                       'function',   'levy_member_fine',           null),
    ('0023', 'loan lifecycle',                        'function',   'confirm_loan_application_fee', null),
    ('0024', 'approval account mapping fix',          'function',   'account_type_for_category',  null),
    ('0025', 'concurrent loan types',                 'function',   'loan_is_open',               null),
    ('0026', 'loan numbers',                          'column',     'loans',                      'loan_number'),
    ('0027', 'capital weekly trend',                  'function',   'get_sacco_capital_trend',    null),
    ('0028', 'historical onboarding',                 'function',   'log_historical_record',      null),
    ('0029', 'transactions.reference',                'column',     'transactions',               'reference'),
    ('0030', 'week anchor cycles',                    'column',     'sacco_settings',             'week_anchor_date'),
    ('0031', 'member join dates',                     'column',     'profiles',                   'joined_on'),
    ('0032', 'migration ledger',                      'table',      'schema_migrations',          null),
    ('0033', 'share quantity integrity',              'constraint', 'transactions_share_amount_consistent', null),
    ('0034', 'lending draws capital',                 'function',   'get_sacco_capital_position', null),
    ('0035', 'close anonymous reads',                 'function',   'is_my_sacco',                null),
    ('0036', 'plan catalogue alignment',              'constraint', 'saccos_subscription_plan_check', 'standard')
),

found as (
  select
    m.version,
    m.subject,
    m.kind,
    case m.kind

      when 'function' then exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = m.obj
      )

      -- Named through information_schema rather than as an identifier, so a column that does
      -- not exist is a row that is not there rather than a parse error that stops the script.
      when 'column' then exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = m.obj and column_name = m.attr
      )

      -- 0008 DROPS a column, so its absence is the evidence it ran. Reported as applied only
      -- when the table itself exists -- on an empty database the column is equally absent and
      -- that means nothing at all.
      when 'no_column' then to_regclass('public.' || m.obj) is not null and not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = m.obj and column_name = m.attr
      )

      when 'table' then to_regclass('public.' || m.obj) is not null

      when 'policy' then exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = m.obj and policyname = m.attr
      )

      -- 0036 does not add a constraint, it redefines one, so the name alone proves nothing --
      -- 0016 created the same name with a different body. The definition has to be read.
      when 'constraint' then exists (
        select 1 from pg_constraint c
        where c.conname = m.obj
          and (m.attr is null or pg_get_constraintdef(c.oid) like '%' || m.attr || '%')
      )

      when 'published' then exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = m.obj
      )

      else null
    end as applied
  from markers m
)

select
  version,
  case
    when kind = 'none' then '  --  '
    when applied      then 'APPLIED'
    else                   'MISSING'
  end as status,
  subject,
  case
    when kind = 'none' then 'no durable marker -- infer from the migrations either side'
    when applied then 'marker present'
    else 'marker absent -- this file has not run, or was undone'
  end as detail
from found
order by version;
