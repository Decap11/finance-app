-- ====================================================================================
-- MIGRATION 0025: One open loan *per type*, not one open loan
-- ====================================================================================
--
-- Requires 0023.
--
-- 0023 blocked a member from holding any second live loan. That is stricter than the
-- SACCO actually runs: a Social Fund emergency loan is a small, interest-free, two-week
-- advance and it is meant to be available to a member who is already repaying a normal
-- loan -- an emergency does not wait for a three-month term to end. What must not happen
-- is a member stacking two loans of the *same* kind, which is where guarantors end up
-- backing more than they agreed to and where a member borrows around their own limit.
--
-- So the check is scoped to loan_type. A member may hold at most one open 'normal' loan
-- and at most one open 'social_fund' loan, concurrently.
--
-- Safe to re-run.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: the open-loan statuses in one place
--
-- Duplicated as a literal list in request_loan, in the loans API route and in the manual
-- contribution route. Naming it here means the next status added to the lifecycle has
-- one obvious place to be registered.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.loan_is_open(p_status TEXT)
RETURNS BOOLEAN AS $$
  SELECT p_status IN (
    'pending_fee', 'pending_guarantors', 'pending', 'approved',
    'disbursed', 'issued', 'active', 'overdue'
  );
$$ LANGUAGE sql IMMUTABLE;

GRANT EXECUTE ON FUNCTION public.loan_is_open(TEXT) TO authenticated;


-- ====================================================================================
-- STEP 2: request_loan
--
-- Identical to 0023 apart from the duplicate-loan check, which now compares loan_type
-- and names the type it found in the message.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.request_loan(
  p_sacco_id UUID,
  p_amount NUMERIC,
  p_term_months INTEGER,
  p_purpose TEXT,
  p_loan_type TEXT,
  p_interest_rate NUMERIC,
  p_due_date DATE,
  p_guarantors UUID[] DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_loan_id UUID;
  v_account_id UUID;
  v_fee NUMERIC;
  v_min_guarantors INTEGER;
  v_guarantors UUID[];
  v_total NUMERIC;
  v_guarantor UUID;
  v_type TEXT;
  v_type_label TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_sacco_member(p_sacco_id) THEN
    RAISE EXCEPTION 'You are not a member of this SACCO';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A loan must be greater than zero';
  END IF;

  IF p_term_months IS NULL OR p_term_months < 1 THEN
    RAISE EXCEPTION 'Choose how long you need to repay this loan';
  END IF;

  v_type := COALESCE(p_loan_type, 'normal');

  IF v_type NOT IN ('normal', 'social_fund') THEN
    RAISE EXCEPTION 'Unknown loan type: %', v_type;
  END IF;

  IF v_type = 'social_fund' AND p_amount > 50000 THEN
    RAISE EXCEPTION 'Social Fund loan amount cannot exceed Shs 50,000';
  END IF;

  v_type_label := CASE v_type
    WHEN 'social_fund' THEN 'Social Fund emergency'
    ELSE 'normal'
  END;

  -- One live loan of each type. A member repaying a normal loan may still take a Social
  -- Fund emergency advance, and the reverse; what they cannot do is stack two of the
  -- same kind, which would put their guarantors behind more than they agreed to.
  IF EXISTS (
    SELECT 1 FROM public.loans
    WHERE profile_id = auth.uid()
      AND loan_type = v_type
      AND public.loan_is_open(status)
  ) THEN
    RAISE EXCEPTION 'You already have a % loan in progress. Settle it before requesting another.',
      v_type_label;
  END IF;

  SELECT COALESCE(loan_application_fee, 5000), COALESCE(loan_min_guarantors, 3)
    INTO v_fee, v_min_guarantors
  FROM public.saccos WHERE id = p_sacco_id;

  -- Deduplicate, and drop the borrower if they nominated themselves.
  SELECT COALESCE(ARRAY_AGG(DISTINCT g), ARRAY[]::UUID[]) INTO v_guarantors
  FROM UNNEST(COALESCE(p_guarantors, ARRAY[]::UUID[])) AS g
  WHERE g <> auth.uid();

  IF COALESCE(ARRAY_LENGTH(v_guarantors, 1), 0) < v_min_guarantors THEN
    RAISE EXCEPTION 'This loan needs at least % guarantors from your SACCO. You selected %.',
      v_min_guarantors, COALESCE(ARRAY_LENGTH(v_guarantors, 1), 0);
  END IF;

  -- Every guarantor must be an active member of the same SACCO. Checked here rather
  -- than in the browser because the browser list is only a suggestion.
  FOREACH v_guarantor IN ARRAY v_guarantors LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.sacco_memberships sm
      WHERE sm.sacco_id = p_sacco_id AND sm.profile_id = v_guarantor
    ) THEN
      RAISE EXCEPTION 'One of the guarantors you selected is not a member of this SACCO';
    END IF;
  END LOOP;

  -- Flat interest across the term, matching how the application has always quoted it.
  v_total := ROUND(p_amount * (1 + (COALESCE(p_interest_rate, 0) / 100.0) * p_term_months), 2);

  INSERT INTO public.loans (
    sacco_id, profile_id, amount_requested, term_months, purpose, status,
    loan_type, interest_rate, due_date, guarantor_status,
    application_fee, total_repayable, installment_amount
  )
  VALUES (
    p_sacco_id, auth.uid(), p_amount, p_term_months, p_purpose, 'pending_fee',
    v_type, COALESCE(p_interest_rate, 0), p_due_date, 'pending_guarantors',
    v_fee, v_total, ROUND(v_total / p_term_months, 2)
  )
  RETURNING id INTO v_loan_id;

  INSERT INTO public.loan_guarantors (
    loan_id, sacco_id, borrower_profile_id, guarantor_profile_id, status, guaranteed_amount
  )
  SELECT v_loan_id, p_sacco_id, auth.uid(), g, 'pending',
         ROUND(p_amount / ARRAY_LENGTH(v_guarantors, 1), 2)
  FROM UNNEST(v_guarantors) AS g;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE profile_id = auth.uid() AND sacco_id = p_sacco_id AND account_type = 'loan'
  LIMIT 1;

  -- The disbursement sits pending from the outset, as before, so the admin approval that
  -- issues the loan is the same action it has always been. 0024 stops that approval
  -- landing before the fee and the guarantors have cleared.
  INSERT INTO public.transactions (
    sacco_id, profile_id, account_id, loan_id, amount, direction,
    category, status, description, requested_by
  )
  VALUES (
    p_sacco_id, auth.uid(), v_account_id, v_loan_id, p_amount, 'debit',
    'loan_disbursement', 'pending',
    'Loan request: ' || COALESCE(p_purpose, 'general') || ' | ' || p_term_months || ' month(s)',
    auth.uid()
  );

  -- The application fee, owed immediately and confirmed by an admin before the
  -- guarantors are asked for anything.
  IF v_fee > 0 THEN
    INSERT INTO public.transactions (
      sacco_id, profile_id, loan_id, amount, direction,
      category, status, description, requested_by
    )
    VALUES (
      p_sacco_id, auth.uid(), v_loan_id, v_fee, 'credit',
      'fee', 'pending', 'Loan application fee', auth.uid()
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'loan_id', v_loan_id,
    'loan_type', v_type,
    'application_fee', v_fee,
    'total_repayable', v_total,
    'installment_amount', ROUND(v_total / p_term_months, 2),
    'guarantors', ARRAY_LENGTH(v_guarantors, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.request_loan(UUID, NUMERIC, INTEGER, TEXT, TEXT, NUMERIC, DATE, UUID[]) TO authenticated;


-- ====================================================================================
-- STEP 3: a partial unique index, so the rule survives a code path that forgets it
--
-- request_loan is not the only way a loan row appears -- the admin manual-contribution
-- route inserts one directly when onboarding a historical loan. A partial unique index
-- over the open statuses makes a second open loan of the same type impossible no matter
-- who is writing. A partial index rather than a CHECK because the rule is about the set
-- of a member's rows, not about any one row.
--
-- This database already contains members holding several open 'normal' loans from before
-- the rule existed -- one profile has five. Deciding which of those to close is a SACCO
-- decision about real money, not something a migration should do behind anyone's back.
-- So the index is created only when the data can accept it, and otherwise the migration
-- says exactly what is in the way and moves on. Re-run this file after the backlog is
-- settled and the index appears on its own. request_loan enforces the rule for every new
-- request in the meantime.
-- ====================================================================================
DO $$
DECLARE
  v_dupes INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT profile_id, loan_type
    FROM public.loans
    WHERE public.loan_is_open(status)
    GROUP BY profile_id, loan_type
    HAVING COUNT(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE WARNING 'Skipping loans_one_open_per_type_idx: % member/type pair(s) already hold more than one open loan. Settle or cancel the extras, then re-run this migration to add the index. New requests are already blocked by request_loan.', v_dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS loans_one_open_per_type_idx
      ON public.loans (profile_id, loan_type)
      WHERE status IN (
        'pending_fee', 'pending_guarantors', 'pending', 'approved',
        'disbursed', 'issued', 'active', 'overdue'
      );
  END IF;
END $$;


-- ====================================================================================
-- Which members are in the way, for when you come to settle them:
--
--   SELECT p.full_name, p.member_number, l.loan_type, COUNT(*) AS open_loans,
--          SUM(COALESCE(l.outstanding_balance, l.amount_approved, l.amount_requested)) AS owed
--   FROM public.loans l
--   JOIN public.profiles p ON p.id = l.profile_id
--   WHERE public.loan_is_open(l.status)
--   GROUP BY p.full_name, p.member_number, l.loan_type
--   HAVING COUNT(*) > 1;
-- ====================================================================================
