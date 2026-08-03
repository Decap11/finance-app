-- ====================================================================================
-- MIGRATION 0024: Stop approve_member_transaction inventing account types, and stop a
--                 loan disbursement jumping its own gate
-- ====================================================================================
--
-- Requires 0023.
--
-- Two faults, both hit the moment a loan application fee reaches an admin.
--
-- 1. "new row for relation accounts violates check constraint accounts_account_type_check"
--
--    approve_member_transaction resolves the destination account with
--    `account_type = v_tx.category` and creates one when the lookup misses. That holds
--    for shares, development_fund, social_fund, savings and fines, where the two
--    vocabularies happen to use the same word. It does not hold for 'fee', 'dividend' or
--    'adjustment', none of which is an account type -- so the function tries to INSERT an
--    account of type 'fee' and the CHECK constraint rejects it. Loan categories escape
--    only because the sync_transaction_full_name trigger has already mapped them to the
--    'loan' account and left account_id non-null.
--
--    The mapping is now explicit. A category with no account behind it completes the
--    transaction and moves no balance, which is the correct outcome for a fee: it is
--    SACCO income, not a member's holding.
--
-- 2. A loan could be disbursed before its fee was confirmed and before its guarantors
--    signed. request_loan (0023) creates the disbursement as 'pending' at request time,
--    so it appears in the approvals queue immediately and approving it drives the loan
--    straight to 'issued'. Confirmed on the live database: loan 89c56fa7 sits at 'issued'
--    with its UGX 5,000 fee still pending and its guarantors never asked. The gate was
--    decorative. Approval now refuses unless the loan has actually cleared it.
--
-- Safe to re-run.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: one place that says which account a category settles into
--
-- Returning NULL is meaningful: "this category moves no member balance". Kept as a
-- function so approve_member_transaction and anything added later cannot drift apart on
-- the answer.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.account_type_for_category(p_category TEXT)
RETURNS TEXT AS $$
  SELECT CASE p_category
    WHEN 'savings'           THEN 'savings'
    WHEN 'shares'            THEN 'shares'
    WHEN 'development_fund'  THEN 'development_fund'
    WHEN 'social_fund'       THEN 'social_fund'
    WHEN 'fines'             THEN 'fines'
    WHEN 'loan_disbursement' THEN 'loan'
    WHEN 'loan_repayment'    THEN 'loan'
    -- 'fee', 'dividend' and 'adjustment' deliberately fall through to NULL.
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;

GRANT EXECUTE ON FUNCTION public.account_type_for_category(TEXT) TO authenticated;


-- ====================================================================================
-- STEP 2: approve_member_transaction
--
-- Same authorization as 0015. What changed: the account is resolved through the mapping
-- above rather than from the category directly, categories with no account skip the
-- balance work entirely, a loan disbursement is refused unless its loan has cleared the
-- fee and the guarantors, and approving a loan fee advances the loan the same way the
-- dedicated button does -- so it no longer matters which screen the admin used.
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
GRANT EXECUTE ON FUNCTION public.approve_transaction(UUID) TO authenticated;
