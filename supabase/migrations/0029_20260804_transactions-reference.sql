-- 0029: add the missing transactions.reference column.
--
-- Historical Onboarding failed on every submission with "migration 0028 has not been
-- applied to this database", after 0028 had in fact been applied. The real error was
-- from inside log_historical_record:
--
--   column "reference" of relation "transactions" does not exist
--
-- 0028 tags every backfilled row with reference = 'HISTORICAL', which is what
-- distinguishes a pre-onboarding paper record from one entered live.
--
-- The column is declared in 0001's CREATE TABLE, so it was never added by a later
-- migration -- but the live transactions table predates that file. As the README notes,
-- the 0001-0004 numbering was reconstructed from git history after the fact and does not
-- record what actually ran against production. Confirmed missing on the live database
-- 2026-08-04, while every other column 0028 writes was present.
--
-- Depends on nothing. Safe to re-run.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reference TEXT;

COMMENT ON COLUMN public.transactions.reference IS
  'Free-text origin tag. Historical Onboarding (0028) writes ''HISTORICAL''; live entries leave it null.';

-- Backfilled rows are read back by date range and origin, never by reference alone, so a
-- partial index over just the tagged rows is the whole of what is worth carrying here.
CREATE INDEX IF NOT EXISTS transactions_reference_historical_idx
  ON public.transactions (sacco_id, created_at)
  WHERE reference = 'HISTORICAL';
