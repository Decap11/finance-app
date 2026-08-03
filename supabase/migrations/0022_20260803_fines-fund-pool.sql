-- ====================================================================================
-- MIGRATION 0022: Fines as a fund pool, alongside shares / development / social
-- ====================================================================================
--
-- Requires 0021, which is what made a fine storable at all.
--
-- A fine is one `transactions` row: category 'fines', direction 'credit', status
-- 'pending' while it is owed and 'completed' once collected. That is the same shape as a
-- contribution, so the whole existing machinery -- approve_member_transaction crediting
-- the account, get_sacco_total_balances summing the pool, the immutable ledger -- applies
-- without special cases.
--
-- ABSENTEEISM IS NOT THE SAME THING AS A FINE, and nothing here should let the two blur.
-- `fine_type` is what keeps them apart: the attendance engine writes 'absenteeism' and
-- owns that flow end to end, while 'late' and anything else an admin invents belong to
-- the general fines manager. Every report, column and counter that a human reads keeps
-- them in separate buckets. They meet in exactly one place -- the money. UGX 1,000
-- collected for missing a meeting is cash the SACCO now holds, and it has to sit in some
-- pool; there is no second place to put it. So the *pool total* covers both, and every
-- *label* covers one.
--
-- Safe to re-run.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: transactions.fine_type
--
-- NULL for everything that is not a fine. Deliberately not constrained to a fixed list:
-- the whole point of the general fines manager is that a SACCO can invent a reason the
-- application has never heard of, and a CHECK here would mean a migration every time a
-- committee agrees on a new one.
-- ====================================================================================
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS fine_type TEXT;

COMMENT ON COLUMN public.transactions.fine_type IS
  'For category=''fines'' only. ''absenteeism'' is owned by the attendance engine; every other value is a general fine. NULL on non-fine rows.';

-- Any fine that predates this column came from the attendance engine, which was the only
-- thing writing fines at the time.
UPDATE public.transactions
SET fine_type = 'absenteeism'
WHERE category = 'fines' AND fine_type IS NULL;

CREATE INDEX IF NOT EXISTS transactions_fines_type_idx
  ON public.transactions (sacco_id, fine_type)
  WHERE category = 'fines';


-- ====================================================================================
-- STEP 2: a default amount for late arrival, next to the absenteeism one
--
-- Both tables carry it because both already carry every other fund/week value and are
-- written together -- see the known gap about them drifting.
-- ====================================================================================
ALTER TABLE public.saccos
  ADD COLUMN IF NOT EXISTS late_fine_amount NUMERIC(15, 2) DEFAULT 500.00;

ALTER TABLE public.sacco_settings
  ADD COLUMN IF NOT EXISTS late_fine_amount NUMERIC(15, 2) DEFAULT 500.00;


-- ====================================================================================
-- STEP 3: the pool
--
-- One category added to the list this function sums. Collected fines now report as a
-- pool the same way the other three do, so every balance surface picks them up at once.
-- ====================================================================================
-- Reproduced verbatim from 0015 apart from the category list -- the authorization
-- preamble is load-bearing (it is what stopped any caller reading any member's balance
-- breakdown) and must not drift while being edited for an unrelated reason.
CREATE OR REPLACE FUNCTION public.get_sacco_total_balances(p_profile_id UUID)
RETURNS TABLE (
  account_type TEXT,
  balance NUMERIC
) AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized to view balances for this member.';
  END IF;

  IF p_profile_id <> auth.uid() AND NOT EXISTS (
    SELECT 1
    FROM public.sacco_memberships caller_sm
    JOIN public.sacco_memberships target_sm ON target_sm.sacco_id = caller_sm.sacco_id
    WHERE caller_sm.profile_id = auth.uid()
      AND caller_sm.role IN ('admin', 'loan_officer')
      AND target_sm.profile_id = p_profile_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized to view balances for this member.';
  END IF;

  SELECT sacco_id INTO v_sacco_id
  FROM public.sacco_memberships
  WHERE profile_id = p_profile_id AND status = 'active'
  LIMIT 1;

  IF v_sacco_id IS NULL THEN
    SELECT s.id INTO v_sacco_id
    FROM public.profiles p
    JOIN public.saccos s ON s.group_code = p.group_id
    WHERE p.id = p_profile_id
    LIMIT 1;
  END IF;

  IF v_sacco_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    t.category::TEXT as account_type,
    COALESCE(SUM(CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END), 0) as balance
  FROM public.transactions t
  WHERE t.sacco_id = v_sacco_id
    AND t.status IN ('completed', 'approved')
    AND t.category IN ('shares', 'development_fund', 'social_fund', 'savings', 'fines')
  GROUP BY t.category;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_sacco_total_balances(UUID) TO authenticated;


-- ====================================================================================
-- STEP 4: levy_member_fine
--
-- Replaces the browser writing to `transactions` directly. 0015 had to add an INSERT
-- policy for that (`transactions_insert_staff_fines`); routing the write through a
-- SECURITY DEFINER function instead means the only way to create a fine is one that
-- checks the caller is staff of the member's own SACCO, and the policy can go.
--
-- Returns the row so a caller can report exactly what it created.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.levy_member_fine(
  p_profile_id UUID,
  p_amount NUMERIC,
  p_fine_type TEXT,
  p_description TEXT DEFAULT NULL,
  p_week_number INTEGER DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_sacco_id UUID;
  v_tx public.transactions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A fine must be greater than zero';
  END IF;

  IF p_fine_type IS NULL OR btrim(p_fine_type) = '' THEN
    RAISE EXCEPTION 'A fine must say what it is for';
  END IF;

  SELECT sm.sacco_id INTO v_sacco_id
  FROM public.sacco_memberships sm
  WHERE sm.profile_id = p_profile_id
  LIMIT 1;

  IF v_sacco_id IS NULL THEN
    RAISE EXCEPTION 'That member does not belong to a SACCO';
  END IF;

  -- Staff of that member's SACCO, resolved through the 0019 helper so the lookup runs
  -- outside RLS and cannot recurse.
  IF NOT public.is_sacco_staff(v_sacco_id) THEN
    RAISE EXCEPTION 'Only an admin or loan officer of this SACCO may issue a fine';
  END IF;

  INSERT INTO public.transactions (
    sacco_id, profile_id, direction, category, fine_type,
    amount, status, description, week_number, requested_by
  ) VALUES (
    v_sacco_id, p_profile_id, 'credit', 'fines', btrim(p_fine_type),
    p_amount, 'pending', p_description, p_week_number, auth.uid()
  )
  RETURNING * INTO v_tx;

  RETURN json_build_object(
    'success', true,
    'transaction_id', v_tx.id,
    'amount', v_tx.amount,
    'fine_type', v_tx.fine_type
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.levy_member_fine(UUID, NUMERIC, TEXT, TEXT, INTEGER) TO authenticated;


-- ====================================================================================
-- STEP 5: waive_member_fine
--
-- Cancelling a fine is 'rejected', never a delete -- transactions is an audit trail, and
-- "this fine was dropped, by whom, and why" is exactly the kind of thing a member will
-- later dispute.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.waive_member_fine(
  p_transaction_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_tx public.transactions;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fine not found';
  END IF;

  IF v_tx.category <> 'fines' THEN
    RAISE EXCEPTION 'That transaction is not a fine';
  END IF;

  IF v_tx.status <> 'pending' THEN
    RAISE EXCEPTION 'Only an unpaid fine can be waived';
  END IF;

  IF NOT public.is_sacco_staff(v_tx.sacco_id) THEN
    RAISE EXCEPTION 'Only an admin or loan officer of this SACCO may waive a fine';
  END IF;

  UPDATE public.transactions
  SET status = 'rejected',
      approved_by = auth.uid(),
      approved_at = now(),
      description = COALESCE(description, '') ||
        ' | Waived by admin' || COALESCE(': ' || btrim(p_reason), '')
  WHERE id = p_transaction_id;

  RETURN json_build_object('success', true, 'transaction_id', p_transaction_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.waive_member_fine(UUID, TEXT) TO authenticated;


-- ====================================================================================
-- STEP 6: retire the direct-insert policy
--
-- levy_member_fine is now the only way in, and it authorizes itself. Leaving the policy
-- would keep a second, weaker door open: it checks the caller is staff of the SACCO named
-- in the row, but nothing stops a crafted row naming a different member or amount.
-- ====================================================================================
DROP POLICY IF EXISTS "transactions_insert_staff_fines" ON public.transactions;
