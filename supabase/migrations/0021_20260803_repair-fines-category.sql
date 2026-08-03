-- ====================================================================================
-- MIGRATION 0021: Make the fines category storable
-- ====================================================================================
--
-- Symptom: an admin marks a member absent, saves the week, and is told the fine was
-- assessed. No fine ever appears -- not in the member's fine banner, not in the weekly
-- report, not anywhere. Confirmed against the live database on 2026-08-03: two
-- attendance weeks were saved, each recording one absentee and UGX 1,000 assessed in
-- their `audit_events` snapshot, while `transactions` held 62 rows and not one of them
-- was a fine of either spelling.
--
-- Cause: `transactions.category` has carried a CHECK constraint since 0001 listing
-- 'fine' (singular). Every line of application code writes 'fines' (plural) -- the
-- attendance manager, the clear-fine route, the member fine banner, and the INSERT
-- policy 0015 added specifically to let staff log them. So the policy allows the write
-- and the CHECK constraint then rejects it. The attendance manager wraps its insert in
-- try/catch, but supabase-js reports failures by returning `{ error }` rather than
-- throwing, so nothing was caught and nothing was logged.
--
-- 'fines' is the spelling that wins here: it is what every caller already uses, and it
-- matches how the other pools are named.
--
-- The same insert carries a second, independent fault: it sends `week_number`, and no
-- such column exists on `transactions`. PostgREST rejects an unknown column outright, so
-- that write could never have succeeded even with the category spelled 'fine'. The
-- column is added here because the readers already prefer it -- saccoSettings.jsx asks
-- for `tx.week_number` first and only falls back to parsing "| Week N" out of the
-- description, a pattern the fine descriptions ("... - Week 4") do not even match.
--
-- And a third: `accounts.account_type` has no 'fines' member, so even once the row
-- inserts, approving it aborts -- approve_member_transaction resolves the destination
-- account by `account_type = category` and creates it when missing.
--
-- Safe to re-run: constraints are dropped by lookup rather than by name, the column is
-- added IF NOT EXISTS, and the backfill only inserts what is absent.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: transactions.category -- accept 'fines', and move any 'fine' rows onto it
--
-- The constraint is found through pg_constraint rather than assumed to be called
-- `transactions_category_check`, so a hand-applied database that named it differently
-- is repaired too rather than silently left with the old rule still in force.
-- ====================================================================================
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT DISTINCT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.transactions'::regclass
      AND con.contype = 'c'
      AND att.attname = 'category'
  LOOP
    EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped category check % on transactions.', c.conname;
  END LOOP;
END $$;

UPDATE public.transactions SET category = 'fines' WHERE category = 'fine';

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_category_check CHECK (category IN (
    'savings',
    'shares',
    'development_fund',
    'social_fund',
    'loan_disbursement',
    'loan_repayment',
    'fee',
    'fines',
    'dividend',
    'adjustment'
  ));


-- ====================================================================================
-- STEP 2: accounts.account_type -- add 'fines'
--
-- A paid fine is a credit into the member's fines account, the same shape as the other
-- pools. The debt itself is carried by the transaction's 'pending' status, not by a
-- negative balance -- `balance >= 0` forbids that anyway.
-- ====================================================================================
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT DISTINCT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.accounts'::regclass
      AND con.contype = 'c'
      AND att.attname = 'account_type'
  LOOP
    EXECUTE format('ALTER TABLE public.accounts DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped account_type check % on accounts.', c.conname;
  END LOOP;
END $$;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_account_type_check CHECK (account_type IN (
    'savings',
    'shares',
    'development_fund',
    'social_fund',
    'loan',
    'fines'
  ));


-- ====================================================================================
-- STEP 3: transactions.week_number
--
-- Which SACCO week a row belongs to is currently recoverable only by regex over the
-- description, and every writer spells that differently. An explicit column lets the
-- attendance manager state it outright; existing readers already try it first.
--
-- Left nullable and unbackfilled: the historical rows encode their week in the
-- description, and guessing one from `created_at` would be inventing data in a ledger.
-- ====================================================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS week_number INTEGER;

CREATE INDEX IF NOT EXISTS transactions_sacco_week_idx
  ON public.transactions (sacco_id, week_number);


-- ====================================================================================
-- STEP 4: give every existing member a fines account
--
-- approve_member_transaction creates a missing account on the fly, but sync_transaction_full_name
-- resolves `account_id` on INSERT by looking one up, so a member without a fines account
-- gets a fine row with a NULL account_id. Backfilling keeps every member uniform.
-- ====================================================================================
INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance)
SELECT DISTINCT a.sacco_id, a.profile_id, 'fines', 0.00
FROM public.accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts existing
  WHERE existing.sacco_id = a.sacco_id
    AND existing.profile_id = a.profile_id
    AND existing.account_type = 'fines'
)
ON CONFLICT DO NOTHING;


-- ====================================================================================
-- STEP 5: new members get one too
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.initialize_member_accounts()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance)
  VALUES
    (NEW.sacco_id, NEW.profile_id, 'savings', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'shares', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'development_fund', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'social_fund', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'loan', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'fines', 0.00)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ====================================================================================
-- STEP 6: verification
--
-- Both queries should come back empty. The first proves no fine row can be rejected for
-- its category again; the second proves no member is missing a fines account.
-- ====================================================================================
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.transactions'::regclass AND contype = 'c'
--    AND pg_get_constraintdef(oid) NOT LIKE '%fines%'
--    AND pg_get_constraintdef(oid) LIKE '%social_fund%';
--
-- SELECT p.profile_id FROM (SELECT DISTINCT sacco_id, profile_id FROM public.accounts) p
--  WHERE NOT EXISTS (
--    SELECT 1 FROM public.accounts a
--     WHERE a.sacco_id = p.sacco_id AND a.profile_id = p.profile_id AND a.account_type = 'fines');
