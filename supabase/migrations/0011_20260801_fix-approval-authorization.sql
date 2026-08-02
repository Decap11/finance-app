-- ====================================================================
-- MIGRATION: Fix Admin Transaction Approval & Rejection Authorization
-- Resolves "Unauthorized to approve this transaction" error for SACCO Admins
-- ====================================================================

-- 1. Create/Replace approve_member_transaction Function
CREATE OR REPLACE FUNCTION public.approve_member_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
DECLARE
  v_tx RECORD;
  v_account_id UUID;
  v_curr_balance NUMERIC;
BEGIN
  -- Fetch target transaction
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_tx.status != 'pending' THEN
    RAISE EXCEPTION 'Transaction is already processed or not pending';
  END IF;

  -- Robust multi-source Admin / Officer authorization verification
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.saccos 
    WHERE id = v_tx.sacco_id AND admin_profile_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.sacco_memberships 
    WHERE sacco_id = v_tx.sacco_id AND profile_id = auth.uid() AND role IN ('admin', 'loan_officer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized to approve this transaction';
  END IF;

  -- Retrieve or initialize account for member if account_id is null
  v_account_id := v_tx.account_id;
  IF v_account_id IS NULL THEN
    SELECT id, balance INTO v_account_id, v_curr_balance 
    FROM public.accounts 
    WHERE profile_id = v_tx.profile_id AND account_type = v_tx.category 
    LIMIT 1;

    IF v_account_id IS NULL THEN
      INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance)
      VALUES (v_tx.sacco_id, v_tx.profile_id, v_tx.category, 0)
      RETURNING id, balance INTO v_account_id, v_curr_balance;
    END IF;
  END IF;

  -- Update member account ledger balance
  IF v_tx.category = 'loan_disbursement' THEN
    UPDATE public.accounts SET balance = balance + v_tx.amount, updated_at = now() WHERE id = v_account_id;
  ELSIF v_tx.category = 'loan_repayment' THEN
    UPDATE public.accounts SET balance = balance - v_tx.amount, updated_at = now() WHERE id = v_account_id;
  ELSE
    IF v_tx.direction = 'credit' THEN
      UPDATE public.accounts SET balance = balance + v_tx.amount, updated_at = now() WHERE id = v_account_id;
    ELSIF v_tx.direction = 'debit' THEN
      UPDATE public.accounts SET balance = balance - v_tx.amount, updated_at = now() WHERE id = v_account_id;
    END IF;
  END IF;

  -- Mark transaction as completed
  UPDATE public.transactions 
  SET 
    status = 'completed',
    account_id = v_account_id,
    approved_by = auth.uid(),
    approved_at = now(),
    completed_at = now()
  WHERE id = p_transaction_id;

  RETURN json_build_object('success', true, 'message', 'Transaction approved and account balance updated successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create/Replace approve_transaction Alias Function
CREATE OR REPLACE FUNCTION public.approve_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
BEGIN
  RETURN public.approve_member_transaction(p_transaction_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create/Replace reject_member_transaction Function
CREATE OR REPLACE FUNCTION public.reject_member_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
DECLARE
  v_tx RECORD;
BEGIN
  -- Fetch target transaction
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_tx.status != 'pending' THEN
    RAISE EXCEPTION 'Transaction is already processed or not pending';
  END IF;

  -- Robust multi-source Admin / Officer authorization verification
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.saccos 
    WHERE id = v_tx.sacco_id AND admin_profile_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.sacco_memberships 
    WHERE sacco_id = v_tx.sacco_id AND profile_id = auth.uid() AND role IN ('admin', 'loan_officer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized to reject this transaction';
  END IF;

  -- Mark transaction as rejected
  UPDATE public.transactions 
  SET 
    status = 'rejected',
    approved_by = auth.uid(),
    approved_at = now(),
    completed_at = now()
  WHERE id = p_transaction_id;

  RETURN json_build_object('success', true, 'message', 'Transaction rejected successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create/Replace reject_transaction Alias Function
CREATE OR REPLACE FUNCTION public.reject_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
BEGIN
  RETURN public.reject_member_transaction(p_transaction_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution permissions on RPC functions to authenticated users
GRANT EXECUTE ON FUNCTION public.approve_member_transaction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_transaction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_member_transaction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_transaction(UUID) TO authenticated;
