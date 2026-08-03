-- ====================================================================================
-- MIGRATION 0023: Loan lifecycle -- application fee, guarantor minimum, installment
--                 repayment, and late charges
-- ====================================================================================
--
-- Requires 0021/0022 (the fines category and fine_type), because an overdue loan is
-- charged as a fine of type 'loan_default'.
--
-- What was actually here before this file, verified against the live database:
--
--   * `loan_repayments` is empty and six issued loans still show their full balance.
--     Nothing ever reduced `loans.outstanding_balance`: sync_loan_on_transaction_approval
--     handled disbursement and rejection only, and approve_member_transaction moves the
--     loan *account* balance without touching the loan row. Repayment was unimplemented
--     at the data layer, and /api/loans answered action 'repay_loan' with "Invalid
--     action" anyway.
--   * `loans.created_at` does not exist. /api/loans orders by it, so the GET returned a
--     400 and a member's active loan never loaded; the POST used the same ordering to
--     find the loan it had just created, so nominated guarantors were never attached.
--   * Guarantors were optional, and the code set `loans.status = 'pending_guarantors'`,
--     which the status CHECK did not allow.
--
-- The lifecycle this file establishes:
--
--   pending_fee -> pending_guarantors -> pending -> issued -> completed
--        |                 |               |
--    admin confirms   guarantors      admin approves
--    the fee          all approve     the disbursement
--
-- Safe to re-run.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: SACCO-configurable loan rules
--
-- Both tables carry them because both already carry every other configurable value and
-- are written together by /api/sacco-settings.
-- ====================================================================================
ALTER TABLE public.saccos
  ADD COLUMN IF NOT EXISTS loan_application_fee NUMERIC(15, 2) DEFAULT 5000.00,
  ADD COLUMN IF NOT EXISTS loan_late_fee_amount NUMERIC(15, 2) DEFAULT 10000.00,
  ADD COLUMN IF NOT EXISTS loan_min_guarantors INTEGER DEFAULT 3;

ALTER TABLE public.sacco_settings
  ADD COLUMN IF NOT EXISTS loan_application_fee NUMERIC(15, 2) DEFAULT 5000.00,
  ADD COLUMN IF NOT EXISTS loan_late_fee_amount NUMERIC(15, 2) DEFAULT 10000.00,
  ADD COLUMN IF NOT EXISTS loan_min_guarantors INTEGER DEFAULT 3;

COMMENT ON COLUMN public.saccos.loan_application_fee IS
  'Flat charge per loan application, independent of the amount requested.';
COMMENT ON COLUMN public.saccos.loan_late_fee_amount IS
  'Flat charge for each whole month a loan stays unpaid past its due date.';

-- These are operational settings a tenant admin edits, so they join the column-level
-- UPDATE grant 0016 allows. status and every subscription_* column stay off that list.
GRANT UPDATE (loan_application_fee, loan_late_fee_amount, loan_min_guarantors)
  ON public.saccos TO authenticated;


-- ====================================================================================
-- STEP 2: loans -- the statuses the flow needs, and the figures it has to remember
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
    WHERE con.conrelid = 'public.loans'::regclass
      AND con.contype = 'c'
      AND att.attname = 'status'
  LOOP
    EXECUTE format('ALTER TABLE public.loans DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.loans
  ADD CONSTRAINT loans_status_check CHECK (status IN (
    'pending_fee',          -- awaiting the admin confirming the application fee
    'pending_guarantors',   -- with the nominated guarantors
    'pending',              -- with the admin for approval
    'approved',
    'rejected',
    'disbursed',
    'issued',
    'active',
    'overdue',
    'completed',
    'defaulted',
    'cancelled'
  ));

-- 0001 declares closed_at but the live table does not have it -- the schema drifted at
-- some point before the migrations were numbered. Added here because step 6 stamps it.
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS application_fee NUMERIC(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS application_fee_paid_at TIMESTAMPTZ,
  -- Principal plus flat interest over the term, fixed when the loan is requested so a
  -- later settings change cannot silently re-price a loan already agreed.
  ADD COLUMN IF NOT EXISTS total_repayable NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS installment_amount NUMERIC(15, 2),
  -- How many monthly late charges have already been levied. The charge routine reads
  -- this so re-running it on the same overdue loan never double-charges.
  ADD COLUMN IF NOT EXISTS late_fee_months_charged INTEGER NOT NULL DEFAULT 0;


-- ====================================================================================
-- STEP 3: request_loan -- guarantor minimum and application fee
--
-- Replaces the 0002 definition. That one took no guarantors at all: the API inserted
-- them afterwards in a separate statement that could (and did) fail on its own, leaving
-- a loan with no guarantors and nobody aware. Doing it inside one function means a loan
-- either exists with its full guarantor set or does not exist.
-- ====================================================================================
DROP FUNCTION IF EXISTS public.request_loan(UUID, NUMERIC, INTEGER, TEXT, TEXT, NUMERIC, DATE);

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

  IF p_loan_type = 'social_fund' AND p_amount > 50000 THEN
    RAISE EXCEPTION 'Social Fund loan amount cannot exceed Shs 50,000';
  END IF;

  -- One live loan at a time. Without this a member can stack requests and guarantors
  -- end up backing more than they agreed to.
  IF EXISTS (
    SELECT 1 FROM public.loans
    WHERE profile_id = auth.uid()
      AND status IN ('pending_fee', 'pending_guarantors', 'pending', 'approved',
                     'disbursed', 'issued', 'active', 'overdue')
  ) THEN
    RAISE EXCEPTION 'You already have a loan in progress. Settle it before requesting another.';
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
    COALESCE(p_loan_type, 'normal'), COALESCE(p_interest_rate, 0), p_due_date, 'pending_guarantors',
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
  -- issues the loan is the same action it has always been.
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
    'application_fee', v_fee,
    'total_repayable', v_total,
    'installment_amount', ROUND(v_total / p_term_months, 2),
    'guarantors', ARRAY_LENGTH(v_guarantors, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.request_loan(UUID, NUMERIC, INTEGER, TEXT, TEXT, NUMERIC, DATE, UUID[]) TO authenticated;


-- ====================================================================================
-- STEP 4: confirm_loan_application_fee
--
-- The fee is SACCO income, not a member balance, so it is marked collected here rather
-- than run through approve_member_transaction -- that function resolves an account by
-- account_type = category, and there is no 'fee' account type for it to find.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.confirm_loan_application_fee(
  p_loan_id UUID
) RETURNS JSON AS $$
DECLARE
  v_loan public.loans;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan not found';
  END IF;

  IF NOT public.is_sacco_staff(v_loan.sacco_id) THEN
    RAISE EXCEPTION 'Only an admin or loan officer of this SACCO may confirm a loan fee';
  END IF;

  IF v_loan.status <> 'pending_fee' THEN
    RAISE EXCEPTION 'This loan is not waiting on its application fee';
  END IF;

  UPDATE public.transactions
  SET status = 'completed',
      approved_by = auth.uid(),
      approved_at = now(),
      completed_at = now()
  WHERE loan_id = p_loan_id AND category = 'fee' AND status = 'pending';

  UPDATE public.loans
  SET status = 'pending_guarantors',
      application_fee_paid_at = now()
  WHERE id = p_loan_id;

  RETURN json_build_object('success', true, 'loan_id', p_loan_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.confirm_loan_application_fee(UUID) TO authenticated;


-- ====================================================================================
-- STEP 5: record_loan_repayment -- an installment
--
-- Creates the pending transaction only. Approving it is the ordinary approval path, and
-- the trigger in step 6 is what moves the loan balance, so there is exactly one place
-- where a repayment is applied.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.record_loan_repayment(
  p_loan_id UUID,
  p_amount NUMERIC
) RETURNS JSON AS $$
DECLARE
  v_loan public.loans;
  v_account_id UUID;
  v_pending NUMERIC;
  v_tx_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_loan FROM public.loans WHERE id = p_loan_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan not found';
  END IF;

  IF v_loan.profile_id <> auth.uid() THEN
    RAISE EXCEPTION 'You can only repay your own loan';
  END IF;

  IF v_loan.status NOT IN ('issued', 'active', 'disbursed', 'overdue') THEN
    RAISE EXCEPTION 'This loan is not open for repayment';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A repayment must be greater than zero';
  END IF;

  -- Repayments already submitted but not yet approved still count against the balance,
  -- or a member could submit the full amount several times over before any is approved.
  SELECT COALESCE(SUM(amount), 0) INTO v_pending
  FROM public.transactions
  WHERE loan_id = p_loan_id AND category = 'loan_repayment' AND status = 'pending';

  IF p_amount > (v_loan.outstanding_balance - v_pending) THEN
    RAISE EXCEPTION 'That is more than is left to pay. Outstanding %, already submitted %.',
      v_loan.outstanding_balance, v_pending;
  END IF;

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE profile_id = auth.uid() AND sacco_id = v_loan.sacco_id AND account_type = 'loan'
  LIMIT 1;

  INSERT INTO public.transactions (
    sacco_id, profile_id, account_id, loan_id, amount, direction,
    category, status, description, requested_by
  )
  VALUES (
    v_loan.sacco_id, auth.uid(), v_account_id, p_loan_id, p_amount, 'credit',
    'loan_repayment', 'pending', 'Loan installment', auth.uid()
  )
  RETURNING id INTO v_tx_id;

  RETURN json_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'outstanding_after', v_loan.outstanding_balance - v_pending - p_amount
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.record_loan_repayment(UUID, NUMERIC) TO authenticated;


-- ====================================================================================
-- STEP 6: apply an approved repayment to the loan
--
-- Extends the existing trigger rather than adding a second one, so disbursement,
-- rejection and repayment all resolve in one place. This is the piece that never
-- existed: outstanding_balance has been frozen at the disbursed amount since launch.
--
-- outstanding_balance is seeded from total_repayable when the loan carries one. Loans
-- issued before this migration have no total_repayable and keep falling back to the
-- disbursed amount, so their balances are not rewritten underneath them.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.sync_loan_on_transaction_approval()
RETURNS trigger AS $$
DECLARE
  v_loan public.loans;
  v_new_balance NUMERIC;
BEGIN
  IF NEW.status IN ('approved', 'completed') AND OLD.status = 'pending'
     AND NEW.category = 'loan_disbursement' AND NEW.loan_id IS NOT NULL THEN
    SELECT * INTO v_loan FROM public.loans WHERE id = NEW.loan_id;

    UPDATE public.loans
    SET status = 'issued',
        amount_approved = NEW.amount,
        outstanding_balance = COALESCE(v_loan.total_repayable, NEW.amount),
        approved_by = NEW.approved_by,
        approved_at = NEW.approved_at,
        disbursed_at = NEW.completed_at,
        -- Term runs from disbursement, not from the request: a loan approved three weeks
        -- after it was asked for should not lose three weeks of its repayment window.
        due_date = COALESCE(
          due_date,
          (COALESCE(NEW.completed_at, now()) + (COALESCE(v_loan.term_months, 1) || ' months')::INTERVAL)::DATE
        )
    WHERE id = NEW.loan_id;
  END IF;

  IF NEW.status = 'rejected' AND OLD.status = 'pending'
     AND NEW.category = 'loan_disbursement' AND NEW.loan_id IS NOT NULL THEN
    UPDATE public.loans
    SET status = 'rejected',
        approved_by = NEW.approved_by,
        approved_at = now()
    WHERE id = NEW.loan_id;
  END IF;

  IF NEW.status IN ('approved', 'completed') AND OLD.status = 'pending'
     AND NEW.category = 'loan_repayment' AND NEW.loan_id IS NOT NULL THEN
    SELECT * INTO v_loan FROM public.loans WHERE id = NEW.loan_id FOR UPDATE;

    v_new_balance := GREATEST(COALESCE(v_loan.outstanding_balance, 0) - NEW.amount, 0);

    UPDATE public.loans
    SET outstanding_balance = v_new_balance,
        status = CASE WHEN v_new_balance = 0 THEN 'completed' ELSE loans.status END,
        closed_at = CASE WHEN v_new_balance = 0 THEN now() ELSE closed_at END
    WHERE id = NEW.loan_id;

    INSERT INTO public.loan_repayments (loan_id, transaction_id, amount, paid_at, source_account_id)
    VALUES (NEW.loan_id, NEW.id, NEW.amount, COALESCE(NEW.completed_at, now()), NEW.account_id)
    ON CONFLICT (transaction_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ====================================================================================
-- STEP 7: late charges
--
-- A flat charge for each whole month a loan stays unpaid past its due date, levied as a
-- fine of type 'loan_default' so it lands in the fines pool and shows up in the fines
-- manager beside every other penalty -- and, per 0022, nowhere near the absence columns.
--
-- Idempotent through late_fee_months_charged: re-running it the same day charges nothing
-- twice, and a loan three months overdue that has never been charged gets three.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.apply_loan_late_fees(
  p_sacco_id UUID
) RETURNS JSON AS $$
DECLARE
  v_loan RECORD;
  v_fee NUMERIC;
  v_months_overdue INTEGER;
  v_to_charge INTEGER;
  v_charged INTEGER := 0;
  v_total NUMERIC := 0;
  i INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_sacco_staff(p_sacco_id) THEN
    RAISE EXCEPTION 'Only an admin or loan officer of this SACCO may apply late charges';
  END IF;

  SELECT COALESCE(loan_late_fee_amount, 10000) INTO v_fee
  FROM public.saccos WHERE id = p_sacco_id;

  IF v_fee <= 0 THEN
    RETURN json_build_object('success', true, 'charged', 0, 'total', 0,
                             'message', 'No late charge is configured for this SACCO.');
  END IF;

  FOR v_loan IN
    SELECT id, profile_id, due_date, outstanding_balance, late_fee_months_charged
    FROM public.loans
    WHERE sacco_id = p_sacco_id
      AND status IN ('issued', 'active', 'disbursed', 'overdue')
      AND outstanding_balance > 0
      AND due_date IS NOT NULL
      AND due_date < CURRENT_DATE
  LOOP
    -- Whole months only: a loan one day late is not yet a month late.
    v_months_overdue := GREATEST(
      (DATE_PART('year', AGE(CURRENT_DATE, v_loan.due_date)) * 12
       + DATE_PART('month', AGE(CURRENT_DATE, v_loan.due_date)))::INTEGER,
      0
    );

    v_to_charge := v_months_overdue - v_loan.late_fee_months_charged;

    IF v_to_charge > 0 THEN
      FOR i IN 1..v_to_charge LOOP
        INSERT INTO public.transactions (
          sacco_id, profile_id, loan_id, amount, direction,
          category, fine_type, status, description, requested_by
        )
        VALUES (
          p_sacco_id, v_loan.profile_id, v_loan.id, v_fee, 'credit',
          'fines', 'loan_default', 'pending',
          'Late loan repayment - month ' || (v_loan.late_fee_months_charged + i)
            || ' past due ' || TO_CHAR(v_loan.due_date, 'DD Mon YYYY'),
          auth.uid()
        );
      END LOOP;

      UPDATE public.loans
      SET late_fee_months_charged = v_months_overdue,
          status = 'overdue'
      WHERE id = v_loan.id;

      v_charged := v_charged + v_to_charge;
      v_total := v_total + (v_to_charge * v_fee);
    ELSIF v_loan.status <> 'overdue' THEN
      UPDATE public.loans SET status = 'overdue' WHERE id = v_loan.id;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'charged', v_charged,
    'total', v_total,
    'message', CASE WHEN v_charged = 0
      THEN 'No new late charges are due.'
      ELSE v_charged || ' late charge(s) totalling UGX ' || v_total || ' applied.' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.apply_loan_late_fees(UUID) TO authenticated;
