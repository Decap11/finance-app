-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saccos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;

-- 1. Profiles Policies
-- Users can read all profiles (to see other members in their SACCO), but only update their own.
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 2. SACCOs Policies
CREATE POLICY "Anyone can view saccos" ON public.saccos FOR SELECT USING (true);
CREATE POLICY "Admins can update sacco" ON public.saccos FOR UPDATE USING (
  admin_profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- 3. SACCO Memberships Policies
CREATE POLICY "Users can view their memberships" ON public.sacco_memberships FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'loan_officer')
  )
);

-- 4. Accounts Policies
CREATE POLICY "Users can view own accounts" ON public.accounts FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'loan_officer')
  )
);

-- 5. Transactions Policies
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (
  profile_id = auth.uid() OR
  requested_by = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'loan_officer')
  )
);

CREATE POLICY "Users can insert own transactions" ON public.transactions FOR INSERT WITH CHECK (
  profile_id = auth.uid() OR requested_by = auth.uid()
);

-- 6. Loans Policies
CREATE POLICY "Users can view own loans" ON public.loans FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'loan_officer')
  )
);

-- ==========================================
-- RPCs (Server-Side Financial Logic)
-- ==========================================

-- RPC 1: Create a secure transaction (e.g., depositing savings or paying shares)
CREATE OR REPLACE FUNCTION process_transaction(
  p_sacco_id UUID,
  p_account_id UUID,
  p_amount NUMERIC,
  p_direction TEXT,
  p_category TEXT,
  p_description TEXT
) RETURNS JSON AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  -- Verify the account belongs to the user
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND profile_id = auth.uid() AND sacco_id = p_sacco_id) THEN
    RAISE EXCEPTION 'Account not found or access denied';
  END IF;

  -- Create the pending transaction
  INSERT INTO public.transactions (sacco_id, profile_id, account_id, amount, direction, category, status, description, requested_by)
  VALUES (p_sacco_id, auth.uid(), p_account_id, p_amount, p_direction, p_category, 'pending', p_description, auth.uid());

  RETURN json_build_object('success', true, 'message', 'Transaction submitted for approval');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 2: Admin approves a transaction and updates the balance securely
CREATE OR REPLACE FUNCTION approve_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
DECLARE
  v_tx RECORD;
BEGIN
  -- Fetch the transaction
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_tx.status != 'pending' THEN RAISE EXCEPTION 'Transaction is not pending'; END IF;

  -- Verify admin/officer rights
  IF NOT EXISTS (
    SELECT 1 FROM public.sacco_memberships 
    WHERE sacco_id = v_tx.sacco_id AND profile_id = auth.uid() AND role IN ('admin', 'loan_officer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized to approve transactions for this SACCO';
  END IF;

  -- Update account balance
  IF v_tx.category = 'loan_disbursement' THEN
    UPDATE public.accounts SET balance = balance + v_tx.amount, updated_at = now() WHERE id = v_tx.account_id;
  ELSIF v_tx.category = 'loan_repayment' THEN
    UPDATE public.accounts SET balance = balance - v_tx.amount, updated_at = now() WHERE id = v_tx.account_id;
  ELSE
    IF v_tx.direction = 'credit' THEN
      UPDATE public.accounts SET balance = balance + v_tx.amount, updated_at = now() WHERE id = v_tx.account_id;
    ELSIF v_tx.direction = 'debit' THEN
      UPDATE public.accounts SET balance = balance - v_tx.amount, updated_at = now() WHERE id = v_tx.account_id;
    END IF;
  END IF;

  -- Mark transaction as completed
  UPDATE public.transactions 
  SET status = 'completed', approved_by = auth.uid(), approved_at = now(), completed_at = now() 
  WHERE id = p_transaction_id;

  RETURN json_build_object('success', true, 'message', 'Transaction approved and balance updated');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 3: Request a Loan
CREATE OR REPLACE FUNCTION request_loan(
  p_sacco_id UUID,
  p_amount NUMERIC,
  p_term_months INTEGER,
  p_purpose TEXT,
  p_loan_type TEXT,
  p_interest_rate NUMERIC,
  p_due_date DATE
) RETURNS JSON AS $$
DECLARE
  v_loan_id UUID;
  v_account_id UUID;
BEGIN
  -- Validate limits on database side
  IF p_loan_type = 'social_fund' AND p_amount > 50000 THEN
    RAISE EXCEPTION 'Social Fund loan amount cannot exceed Shs 50,000';
  END IF;

  -- Insert a pending loan
  INSERT INTO public.loans (
    sacco_id, 
    profile_id, 
    amount_requested, 
    term_months, 
    purpose, 
    status,
    loan_type,
    interest_rate,
    due_date
  )
  VALUES (
    p_sacco_id, 
    auth.uid(), 
    p_amount, 
    p_term_months, 
    p_purpose, 
    'pending',
    p_loan_type,
    p_interest_rate,
    p_due_date
  )
  RETURNING id INTO v_loan_id;

  -- Get member's loan account id
  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE profile_id = auth.uid() 
    AND sacco_id = p_sacco_id 
    AND account_type = 'loan'
  LIMIT 1;

  -- Insert corresponding pending transaction
  INSERT INTO public.transactions (
    sacco_id, 
    profile_id, 
    account_id,
    loan_id,
    amount, 
    direction, 
    category, 
    status, 
    description, 
    requested_by
  )
  VALUES (
    p_sacco_id, 
    auth.uid(), 
    v_account_id,
    v_loan_id,
    p_amount, 
    'debit', 
    'loan_disbursement', 
    'pending', 
    CASE 
      WHEN p_loan_type = 'social_fund' THEN 'Social Fund Loan request (Interest-free, 2 weeks)'
      ELSE 'Normal Loan request (' || p_term_months || ' month(s) @ 5% p.m.)'
    END, 
    auth.uid()
  );

  RETURN json_build_object('success', true, 'message', 'Loan requested successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 5: Reject a Transaction (by Admin)
CREATE OR REPLACE FUNCTION reject_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
DECLARE
  v_tx RECORD;
BEGIN
  -- Fetch the transaction
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_tx.status != 'pending' THEN RAISE EXCEPTION 'Transaction is not pending'; END IF;

  -- Verify admin/officer rights
  IF NOT EXISTS (
    SELECT 1 FROM public.sacco_memberships 
    WHERE sacco_id = v_tx.sacco_id AND profile_id = auth.uid() AND role IN ('admin', 'loan_officer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized to reject transactions for this SACCO';
  END IF;

  -- Mark transaction as rejected
  UPDATE public.transactions 
  SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), completed_at = now() 
  WHERE id = p_transaction_id;

  RETURN json_build_object('success', true, 'message', 'Transaction rejected successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 6: Make a Member an Admin (by Admin)
CREATE OR REPLACE FUNCTION make_member_admin(
  p_member_id UUID
) RETURNS JSON AS $$
BEGIN
  -- Verify caller is admin of the same SACCO group
  IF NOT EXISTS (
    SELECT 1 
    FROM public.profiles p_member
    JOIN public.sacco_memberships sm_caller ON sm_caller.profile_id = auth.uid() AND sm_caller.role = 'admin'
    JOIN public.saccos s ON s.id = sm_caller.sacco_id
    WHERE p_member.id = p_member_id AND p_member.group_id = s.group_code
  ) THEN
    RAISE EXCEPTION 'Unauthorized to promote this member or member is not in the same SACCO group';
  END IF;

  -- 1. Update profiles role
  UPDATE public.profiles SET role = 'admin', updated_at = now() WHERE id = p_member_id;

  -- 2. Update sacco_memberships role
  UPDATE public.sacco_memberships SET role = 'admin' WHERE profile_id = p_member_id;

  RETURN json_build_object('success', true, 'message', 'Member successfully promoted to admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 7: Delete a Member entirely (by Admin)
CREATE OR REPLACE FUNCTION delete_member_entirely(
  p_member_id UUID
) RETURNS JSON AS $$
BEGIN
  -- Verify caller is admin of the same SACCO group
  IF NOT EXISTS (
    SELECT 1 
    FROM public.profiles p_member
    JOIN public.sacco_memberships sm_caller ON sm_caller.profile_id = auth.uid() AND sm_caller.role = 'admin'
    JOIN public.saccos s ON s.id = sm_caller.sacco_id
    WHERE p_member.id = p_member_id AND p_member.group_id = s.group_code
  ) THEN
    RAISE EXCEPTION 'Unauthorized to delete this member or member is not in the same SACCO group';
  END IF;

  -- Delete from dependent tables first to prevent constraint violations
  DELETE FROM public.loan_repayments WHERE loan_id IN (SELECT id FROM public.loans WHERE profile_id = p_member_id);
  DELETE FROM public.transactions WHERE profile_id = p_member_id OR requested_by = p_member_id OR approved_by = p_member_id;
  DELETE FROM public.loans WHERE profile_id = p_member_id OR approved_by = p_member_id;
  DELETE FROM public.accounts WHERE profile_id = p_member_id;
  DELETE FROM public.sacco_memberships WHERE profile_id = p_member_id;
  DELETE FROM public.audit_events WHERE actor_profile_id = p_member_id;
  
  -- Delete from auth.users which cascades to public.profiles
  DELETE FROM auth.users WHERE id = p_member_id;

  RETURN json_build_object('success', true, 'message', 'Member and all associated data deleted successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to keep public.loans in sync with public.transactions approvals/rejections
CREATE OR REPLACE FUNCTION public.sync_loan_on_transaction_approval()
RETURNS trigger AS $$
BEGIN
  -- If transaction is approved/completed and is a loan_disbursement
  IF NEW.status IN ('approved', 'completed') AND OLD.status = 'pending' AND NEW.category = 'loan_disbursement' AND NEW.loan_id IS NOT NULL THEN
    UPDATE public.loans
    SET 
      status = 'issued',
      amount_approved = NEW.amount,
      outstanding_balance = NEW.amount,
      approved_by = NEW.approved_by,
      approved_at = NEW.approved_at,
      disbursed_at = NEW.completed_at
    WHERE id = NEW.loan_id;
  END IF;

  -- If transaction is rejected and is a loan_disbursement
  IF NEW.status = 'rejected' AND OLD.status = 'pending' AND NEW.category = 'loan_disbursement' AND NEW.loan_id IS NOT NULL THEN
    UPDATE public.loans
    SET 
      status = 'rejected',
      approved_by = NEW.approved_by,
      approved_at = now()
    WHERE id = NEW.loan_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_transaction_approval ON public.transactions;
CREATE TRIGGER on_transaction_approval
  AFTER UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE public.sync_loan_on_transaction_approval();

-- RPC 8: Get total balances of all members in the SACCO group securely
CREATE OR REPLACE FUNCTION public.get_sacco_total_balances(p_profile_id UUID)
RETURNS TABLE (
  account_type TEXT,
  balance NUMERIC
) AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
  -- Retrieve Sacco ID linked to user profile
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

  -- Return category sums of approved/completed transactions
  RETURN QUERY
  SELECT 
    t.category::TEXT as account_type,
    COALESCE(SUM(CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END), 0) as balance
  FROM public.transactions t
  WHERE t.sacco_id = v_sacco_id 
    AND t.status IN ('completed', 'approved')
    AND t.category IN ('shares', 'development_fund', 'social_fund', 'savings')
  GROUP BY t.category;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable Row Level Security for audit_events table
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- SELECT Policy: Members can view audit events within their own SACCO group
CREATE POLICY "Members can view audit events in their sacco" ON public.audit_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sacco_memberships sm 
      WHERE sm.sacco_id = audit_events.sacco_id AND sm.profile_id = auth.uid()
    )
  );

-- INSERT Policy: Only SACCO admins can record audit events (like broadcast announcements)
CREATE POLICY "Admins can log audit events" ON public.audit_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sacco_memberships sm 
      WHERE sm.sacco_id = sacco_id AND sm.profile_id = auth.uid() AND sm.role = 'admin'
    )
  );

