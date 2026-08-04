-- ====================================================================================
-- MIGRATION 0033: Store what a shares contribution IS, not only what it came to
-- ====================================================================================
--
-- Depends on nothing. Safe to re-run.
--
-- A shares contribution is a whole number of shares bought at the SACCO's share price.
-- The ledger held only the product of those two facts, in `amount`, and the two facts
-- themselves existed nowhere except as prose in `description`. Everything that needed a
-- share COUNT therefore recovered it by dividing the amount by whatever the share price
-- happened to be at the moment of reading.
--
-- Three consequences, all of them silent:
--
-- 1. The member's browser, the API and the reporting screens each resolved the price
--    separately -- from a `localStorage` cache shared across every SACCO signed in on
--    that device, from the database, and from the settings form respectively -- and each
--    fell back to a hardcoded 25,000 when its own lookup failed. A member of a SACCO
--    charging 5,000 a share could be shown one total, have another stored, and have the
--    admin approve a third.
--
-- 2. Editing the share price in Configuration Settings retroactively changed how many
--    shares every member had ever bought, everywhere in the app at once. Nothing was
--    written; the same rows simply divided differently from that moment on.
--
-- 3. Nothing enforced that a shares amount was a multiple of a share price at all, so a
--    fractional quantity reaching the API produced an amount that could not be read back
--    as any number of shares.
--
-- This migration adds the two facts as columns, recovers them for existing rows from the
-- description that recorded them, and makes their agreement with `amount` a CHECK the
-- database enforces rather than a convention the application remembers.
--
-- The application half is `src/utils/sharePricing.js`, which is now the only place that
-- multiplies, and `/api/user-transactions`, which refuses a shares request it cannot
-- price and refuses one whose price disagrees with what the member's screen showed.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: the columns
--
-- Nullable, and NULL means something specific: "this row does not claim to be a
-- quantity of shares at a price". Backfilled records typed by an admin as a lump sum in
-- Historical Onboarding are exactly that, and forcing a count onto them would be
-- inventing one. Only rows that state both are held to the CHECK below.
-- ====================================================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS share_count INTEGER,
  ADD COLUMN IF NOT EXISTS unit_price  NUMERIC(15, 2);

COMMENT ON COLUMN public.transactions.share_count IS
  'Shares bought, for category = ''shares''. NULL where the row was recorded as a lump '
  'sum (e.g. a Historical Onboarding backfill) and no count was ever stated.';

COMMENT ON COLUMN public.transactions.unit_price IS
  'The share price CHARGED for this row, as agreed with the member when they submitted. '
  'Not the SACCO''s current share price -- that changes, and this must not.';


-- ====================================================================================
-- STEP 2: recover the two facts for existing rows
--
-- Every shares row written by /api/user-transactions carries them in its description:
--   "Contribution request: 3 share(s) @ Shs 25,000 | Week 7"
-- which is the only surviving record of what was actually agreed at the time, and is
-- better evidence than any division by a price that may have changed since.
--
-- Only rows whose recovered figures MULTIPLY BACK to the stored amount are filled in. A
-- description that disagrees with the amount is a row where something already went
-- wrong, and writing the description's version over it would erase the discrepancy
-- rather than surface it -- those are listed by STEP 4 instead.
--
-- Rows with no parseable description are deliberately left NULL. The alternative --
-- dividing by today's price -- is the guess this migration exists to stop making.
-- ====================================================================================
WITH parsed AS (
  SELECT
    t.id,
    NULLIF(substring(t.description from '([0-9]+)\s*share\(s\)'), '')::INTEGER AS qty,
    NULLIF(replace(substring(t.description from 'share\(s\)\s*@\s*Shs\s*([0-9,]+)'), ',', ''), '')::NUMERIC AS price
  FROM public.transactions t
  WHERE t.category = 'shares'
    AND t.share_count IS NULL
    AND t.description ~ 'share\(s\)\s*@\s*Shs'
)
UPDATE public.transactions t
SET share_count = p.qty,
    unit_price  = p.price
FROM parsed p
WHERE t.id = p.id
  AND p.qty > 0
  AND p.price > 0
  AND t.amount = p.qty * p.price;


-- ====================================================================================
-- STEP 3: the invariant, enforced
--
-- Reads as: if a row states both a count and a unit price, then the money must be the
-- product, the count must be a positive whole number, and the price must be positive.
--
-- Stated over all categories rather than only 'shares' so the columns cannot quietly
-- grow a second meaning elsewhere.
--
-- Added NOT VALID and validated separately: on a table of any size that takes a lighter
-- lock, and it lets a pre-existing bad row be reported by STEP 4 rather than abort the
-- whole file with a constraint violation nobody can act on.
-- ====================================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass
      AND conname = 'transactions_share_amount_consistent'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_share_amount_consistent
      CHECK (
        share_count IS NULL
        OR (
          share_count > 0
          AND unit_price IS NOT NULL
          AND unit_price > 0
          AND amount = share_count * unit_price
        )
      ) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.transactions VALIDATE CONSTRAINT transactions_share_amount_consistent;
  RAISE NOTICE '0033: every shares row with a stated count now agrees with its amount.';
EXCEPTION WHEN check_violation THEN
  -- Left NOT VALID. It still applies to every INSERT and UPDATE from this moment on --
  -- which is what stops the fault recurring -- and only the existing offending rows go
  -- unvalidated. STEP 4 names them.
  RAISE WARNING '0033: existing rows violate the share consistency check; constraint left '
                'NOT VALID (it still governs all new writes). See the report below.';
END $$;


-- ====================================================================================
-- STEP 4: what could not be repaired
--
-- Printed rather than fixed. Each of these is a row where the money on record and the
-- shares on record are not the same claim, and choosing which one is true is a decision
-- for the SACCO's admin with the paper book in front of them, not for a migration.
-- ====================================================================================
DO $$
DECLARE
  v_unpriced INTEGER;
  v_mismatch INTEGER;
BEGIN
  SELECT count(*) INTO v_unpriced
  FROM public.transactions
  WHERE category = 'shares' AND share_count IS NULL;

  SELECT count(*) INTO v_mismatch
  FROM public.transactions
  WHERE category = 'shares'
    AND share_count IS NOT NULL
    AND (unit_price IS NULL OR amount <> share_count * unit_price);

  RAISE NOTICE '0033: % shares row(s) still carry no share count -- these are lump sums, '
               'or rows whose description never recorded one. Screens fall back to '
               'dividing by the current share price for these, and only these.', v_unpriced;

  IF v_mismatch > 0 THEN
    RAISE WARNING '0033: % shares row(s) state a count and price that do not multiply to '
                  'their amount. The admin approvals screen flags each of these in red. '
                  'Query: SELECT id, profile_id, amount, share_count, unit_price FROM '
                  'public.transactions WHERE category = ''shares'' AND share_count IS NOT '
                  'NULL AND amount <> share_count * unit_price;', v_mismatch;
  END IF;
END $$;


-- ====================================================================================
-- STEP 5: reading the share ledger
--
-- Every screen that shows share counts filters to this member, this SACCO, this
-- category. The partial index keeps that cheap and stays small -- it covers only rows
-- that actually carry a count.
-- ====================================================================================
CREATE INDEX IF NOT EXISTS transactions_shares_counted_idx
  ON public.transactions (sacco_id, profile_id)
  WHERE category = 'shares' AND share_count IS NOT NULL;


SELECT public.record_migration(
  '0033',
  'Adds transactions.share_count / unit_price, recovers both from existing descriptions, '
  'and enforces amount = share_count * unit_price so a shares amount is always a multiple '
  'of the price actually agreed with the member.'
);
