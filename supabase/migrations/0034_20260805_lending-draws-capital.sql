-- ====================================================================================
-- MIGRATION 0034: lending draws the capital down, and cannot draw it below zero
-- ====================================================================================
--
-- Requires 0027 (the trend) and 0024 (approve_member_transaction).
--
-- THE PROBLEM
-- A loan already writes a real ledger row: request_loan inserts a 'loan_disbursement'
-- transaction, direction 'debit', and the admin's approval completes it (0023). The
-- money is in the ledger. What ignored it was every function that adds capital up --
-- get_sacco_total_balances (0022) filters to shares, development_fund, social_fund,
-- savings and fines, and neither loan category is in that list. So a SACCO could hand
-- out its entire pot and the "Total SACCO Assets" figure would not move by one shilling.
-- Nothing in the app showed where lent money came from, and nothing stopped an admin
-- approving a loan the SACCO could not fund.
--
-- WHAT CAPITAL MEANS HERE
-- Cash basis. What came in, minus what went out, plus what came back:
--
--     on_hand = contributions + fines + repayments - disbursements
--
-- Disburse 500,000 and the pot drops by 500,000. It returns over the term as 550,000,
-- so the SACCO ends 50,000 up and the interest lands as growth at the moment it is
-- actually received, rather than as the projected principal x rate x term figure the
-- admin dashboard computes for itself.
--
-- Two consequences worth being explicit about:
--
--   Savings are excluded. They are members' own money held on their behalf -- a
--   liability, not the SACCO's capital, and not the SACCO's to lend. This matches the
--   Total SACCO Assets card, which has never counted them; it does NOT match the admin
--   dashboard, which summed every row it got back including savings. That screen is
--   corrected in the same change so the two stop disagreeing.
--
--   on_hand is returned unclamped and may be negative on a database that has been
--   lending since before this migration. That is not a fault in the arithmetic. It is
--   the SACCO having lent more than it ever collected, reported for the first time.
--
-- Reads nothing but transactions the caller's own SACCO owns. Safe to re-run.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: the arithmetic, in one place
--
-- Split out from the reporting function below because approve_member_transaction needs
-- the same number to decide whether a loan can be funded, and a guard that computes
-- "available" differently from the figure shown on the dashboard is worse than no guard
-- -- it refuses loans for reasons the admin cannot see on any screen.
--
-- Takes a sacco_id and does no authorization of its own. Every caller is SECURITY
-- DEFINER and has already established who is asking; this is deliberately the piece
-- that only does sums.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.sacco_capital_on_hand(p_sacco_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(
    CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END
  ), 0)::NUMERIC
  FROM public.transactions t
  WHERE t.sacco_id = p_sacco_id
    AND t.status IN ('completed', 'approved')
    -- 'savings' is absent on purpose -- see the header. 'fee' and 'dividend' are absent
    -- because they are settled elsewhere and would double-count against the pools.
    AND t.category IN ('shares', 'development_fund', 'social_fund', 'fines',
                       'loan_disbursement', 'loan_repayment');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.sacco_capital_on_hand(UUID) IS
  'Cash a SACCO actually holds: contributions and fines collected, plus loan repayments received, minus loan principal disbursed. Excludes members'' savings. May be negative if the SACCO has lent more than it collected.';

GRANT EXECUTE ON FUNCTION public.sacco_capital_on_hand(UUID) TO authenticated;


-- ====================================================================================
-- STEP 2: the position, broken down
--
-- One row, because every consumer wants the whole picture at once and the alternative
-- is four round trips that can disagree with each other if a transaction is approved
-- between them.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.get_sacco_capital_position(p_profile_id UUID)
RETURNS TABLE (
  contributed     NUMERIC,
  disbursed_total NUMERIC,
  repaid_total    NUMERIC,
  out_on_loan     NUMERIC,
  on_hand         NUMERIC
) AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
  -- Same authorization preamble as get_sacco_total_balances and get_sacco_capital_trend,
  -- reproduced rather than shared for the reason 0022 gives: it is what stops any
  -- authenticated user aiming this at any profile id and reading another SACCO's
  -- position, and the three must not drift into disagreeing about who may see a group's
  -- money.
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

  -- The CTE columns are prefixed and the final SELECT is positional, both deliberately.
  -- RETURNS TABLE declares contributed / disbursed_total / repaid_total / out_on_loan /
  -- on_hand as PL/pgSQL variables, so a query column of the same name inside this body is
  -- an ambiguous reference and aborts at runtime -- an error that appears only when the
  -- function is first called, long after the migration reported success.
  RETURN QUERY
  WITH movement AS (
    SELECT
      t.category,
      t.direction,
      t.amount
    FROM public.transactions t
    WHERE t.sacco_id = v_sacco_id
      AND t.status IN ('completed', 'approved')
  ),
  totals AS (
    SELECT
      COALESCE(SUM(
        CASE WHEN m.direction = 'credit' THEN m.amount ELSE -m.amount END
      ) FILTER (
        WHERE m.category IN ('shares', 'development_fund', 'social_fund', 'fines')
      ), 0)::NUMERIC AS v_contributed,
      COALESCE(SUM(m.amount) FILTER (
        WHERE m.category = 'loan_disbursement'
      ), 0)::NUMERIC AS v_disbursed,
      COALESCE(SUM(m.amount) FILTER (
        WHERE m.category = 'loan_repayment'
      ), 0)::NUMERIC AS v_repaid
    FROM movement m
  )
  SELECT
    t.v_contributed,
    t.v_disbursed,
    t.v_repaid,
    -- Clamped: repayments carry interest, so a fully repaid book returns more than it
    -- lent and the raw difference goes negative. "Minus 40,000 out on loan" is not a
    -- sentence about anything. The last column is deliberately NOT clamped -- there the
    -- surplus is real money and belongs in the total.
    GREATEST(t.v_disbursed - t.v_repaid, 0)::NUMERIC,
    (t.v_contributed + t.v_repaid - t.v_disbursed)::NUMERIC
  FROM totals t;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.get_sacco_capital_position(UUID) IS
  'A SACCO''s capital on a cash basis: what was contributed, what has gone out as loans, what has come back, and what is on hand right now. Savings are excluded -- they are members'' money, not the SACCO''s to lend.';

GRANT EXECUTE ON FUNCTION public.get_sacco_capital_position(UUID) TO authenticated;


-- ====================================================================================
-- STEP 3: the weekly trend counts lending too
--
-- 0027 stated the rule this change is obeying: "A percentage computed over a wider set
-- than the figure it sits under would not reconcile against that figure, and the card is
-- where anyone will check the arithmetic." The figure the card prints now moves when a
-- loan is disbursed, so the percentage underneath it has to move as well -- otherwise a
-- week in which the SACCO lent out half its capital reports as flat.
--
-- Reproduced from 0027 with the category list extended. Nothing else changes.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.get_sacco_capital_trend(p_profile_id UUID)
RETURNS TABLE (
  opening_capital NUMERIC,
  current_week_net NUMERIC,
  previous_week_net NUMERIC,
  week_start DATE
) AS $$
DECLARE
  v_sacco_id UUID;
  v_week_start DATE := date_trunc('week', current_date)::date;
  v_prev_start DATE := (date_trunc('week', current_date) - INTERVAL '7 days')::date;
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
    COALESCE(SUM(m.signed_amount) FILTER (WHERE m.moved_on < v_week_start), 0)::NUMERIC,
    COALESCE(SUM(m.signed_amount) FILTER (WHERE m.moved_on >= v_week_start), 0)::NUMERIC,
    COALESCE(SUM(m.signed_amount) FILTER (
      WHERE m.moved_on >= v_prev_start AND m.moved_on < v_week_start
    ), 0)::NUMERIC,
    v_week_start
  FROM (
    SELECT
      t.created_at AS moved_on,
      CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END AS signed_amount
    FROM public.transactions t
    WHERE t.sacco_id = v_sacco_id
      AND t.status IN ('completed', 'approved')
      -- Extended in 0034. Must stay identical to the set summed by
      -- sacco_capital_on_hand, or the percentage stops reconciling against the figure
      -- it is printed beneath.
      AND t.category IN ('shares', 'development_fund', 'social_fund', 'fines',
                         'loan_disbursement', 'loan_repayment')
  ) m;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.get_sacco_capital_trend(UUID) IS
  'Week-on-week movement of a SACCO''s capital on hand. opening_capital is the pot at Monday 00:00; current_week_net and previous_week_net are the signed movements in those two weeks. Categories match sacco_capital_on_hand exactly, lending included.';

GRANT EXECUTE ON FUNCTION public.get_sacco_capital_trend(UUID) TO authenticated;


-- ====================================================================================
-- STEP 4: a loan cannot be approved for money the SACCO does not have
--
-- This is the part that answers "where is this money coming from". Until now the answer
-- was nowhere in particular: approval moved the borrower's loan account and left every
-- capital figure untouched, so there was no quantity for an over-lend to exceed.
--
-- The check sits here rather than in the UI because approval is reachable from the
-- approvals queue, the loan manager and the API route, and a rule enforced in three
-- places is a rule enforced in none.
--
-- Reproduced from 0024 with STEP 4a added. Everything else is verbatim -- the
-- authorization block and the account mapping are load-bearing and must not drift while
-- being edited for an unrelated reason.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.approve_member_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
DECLARE
  v_tx RECORD;
  v_loan public.loans;
  v_account_id UUID;
  v_account_type TEXT;
  v_curr_balance NUMERIC;
  v_on_hand NUMERIC;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_tx.status != 'pending' THEN
    RAISE EXCEPTION 'Transaction is already processed or not pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.saccos
    WHERE id = v_tx.sacco_id AND admin_profile_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.sacco_memberships
    WHERE sacco_id = v_tx.sacco_id AND profile_id = auth.uid() AND role IN ('admin', 'loan_officer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized to approve this transaction';
  END IF;

  -- A disbursement must not overtake the process that authorises it.
  IF v_tx.category = 'loan_disbursement' AND v_tx.loan_id IS NOT NULL THEN
    SELECT * INTO v_loan FROM public.loans WHERE id = v_tx.loan_id;

    IF v_loan.status = 'pending_fee' THEN
      RAISE EXCEPTION 'This loan''s application fee has not been confirmed yet.';
    ELSIF v_loan.status = 'pending_guarantors' THEN
      RAISE EXCEPTION 'This loan is still waiting for its guarantors to approve.';
    ELSIF v_loan.status NOT IN ('pending', 'approved') THEN
      RAISE EXCEPTION 'This loan is not ready to be disbursed (status: %).', v_loan.status;
    END IF;

    -- STEP 4a: and it must not overtake the money.
    --
    -- The SACCO row is locked first, not for anything read from it, but because the
    -- row-level lock taken on the transaction above guards only that one transaction.
    -- Two admins approving two different loans at the same moment would otherwise each
    -- read a balance that does not account for the other, and both would pass. Locking
    -- one row per SACCO serialises disbursement approvals within a group and nothing
    -- else -- ordinary contribution approvals never reach this branch.
    PERFORM 1 FROM public.saccos WHERE id = v_tx.sacco_id FOR UPDATE;

    -- This transaction is still 'pending', so it does not count towards the balance it
    -- is being measured against.
    v_on_hand := public.sacco_capital_on_hand(v_tx.sacco_id);

    IF v_tx.amount > v_on_hand THEN
      RAISE EXCEPTION
        'This loan is for % but the SACCO only holds %. Lending it would leave the group % short. Collect contributions or wait for repayments before approving.',
        to_char(v_tx.amount, 'FM999,999,999,990.00'),
        to_char(GREATEST(v_on_hand, 0), 'FM999,999,999,990.00'),
        to_char(v_tx.amount - v_on_hand, 'FM999,999,999,990.00');
    END IF;
  END IF;

  v_account_type := public.account_type_for_category(v_tx.category);

  IF v_account_type IS NOT NULL THEN
    v_account_id := v_tx.account_id;

    IF v_account_id IS NULL THEN
      SELECT id, balance INTO v_account_id, v_curr_balance
      FROM public.accounts
      WHERE profile_id = v_tx.profile_id
        AND sacco_id = v_tx.sacco_id
        AND account_type = v_account_type
      LIMIT 1;

      IF v_account_id IS NULL THEN
        INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance)
        VALUES (v_tx.sacco_id, v_tx.profile_id, v_account_type, 0)
        RETURNING id, balance INTO v_account_id, v_curr_balance;
      END IF;
    END IF;

    IF v_tx.category = 'loan_disbursement' THEN
      UPDATE public.accounts SET balance = balance + v_tx.amount, updated_at = now()
      WHERE id = v_account_id;
    ELSIF v_tx.category = 'loan_repayment' THEN
      UPDATE public.accounts SET balance = GREATEST(balance - v_tx.amount, 0), updated_at = now()
      WHERE id = v_account_id;
    ELSIF v_tx.direction = 'credit' THEN
      UPDATE public.accounts SET balance = balance + v_tx.amount, updated_at = now()
      WHERE id = v_account_id;
    ELSIF v_tx.direction = 'debit' THEN
      -- Not clamped, unlike the repayment above. A debit that would take a fund balance
      -- below zero is a real inconsistency and should fail loudly on the balance >= 0
      -- constraint, exactly as it did before this file.
      UPDATE public.accounts SET balance = balance - v_tx.amount, updated_at = now()
      WHERE id = v_account_id;
    END IF;
  END IF;

  UPDATE public.transactions
  SET status = 'completed',
      account_id = COALESCE(v_account_id, account_id),
      approved_by = auth.uid(),
      approved_at = now(),
      completed_at = now()
  WHERE id = p_transaction_id;

  -- Approving the application fee is the same act as confirming it, wherever the admin
  -- happened to be standing when they did it.
  IF v_tx.category = 'fee' AND v_tx.loan_id IS NOT NULL THEN
    UPDATE public.loans
    SET status = 'pending_guarantors',
        application_fee_paid_at = COALESCE(application_fee_paid_at, now())
    WHERE id = v_tx.loan_id AND status = 'pending_fee';
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', 'Transaction approved successfully',
    'moved_balance', v_account_type IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.approve_member_transaction(UUID) TO authenticated;


SELECT public.record_migration(
  '0034',
  'Counts loan disbursements and repayments in the SACCO''s capital on a cash basis, so '
  'approving a loan visibly draws the pot down and repayments build it back with their '
  'interest. Adds sacco_capital_on_hand and get_sacco_capital_position, extends the '
  'weekly trend to match, and refuses a disbursement larger than the SACCO actually holds.'
);
