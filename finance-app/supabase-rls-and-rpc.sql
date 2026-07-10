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
-- Anyone can view active SACCOs
CREATE POLICY "Anyone can view saccos" ON public.saccos FOR SELECT USING (true);
-- Only SACCO admins can update SACCO details
CREATE POLICY "Admins can update sacco" ON public.saccos FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm 
    WHERE sm.sacco_id = id AND sm.profile_id = auth.uid() AND sm.role = 'admin'
  )
);

-- 3. SACCO Memberships Policies
-- Users can view their own memberships or if they are admin/loan_officer
CREATE POLICY "Users can view their memberships" ON public.sacco_memberships FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm 
    WHERE sm.sacco_id = sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);

-- 4. Accounts Policies
-- Users can only view their own accounts
CREATE POLICY "Users can view own accounts" ON public.accounts FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm 
    WHERE sm.sacco_id = sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);

-- 5. Transactions Policies
-- Users can view their own transactions
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm 
    WHERE sm.sacco_id = sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);

-- 6. Loans Policies
-- Users can view their own loans
CREATE POLICY "Users can view own loans" ON public.loans FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm 
    WHERE sm.sacco_id = sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
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
  IF v_tx.direction = 'credit' THEN
    UPDATE public.accounts SET balance = balance + v_tx.amount, updated_at = now() WHERE id = v_tx.account_id;
  ELSIF v_tx.direction = 'debit' THEN
    UPDATE public.accounts SET balance = balance - v_tx.amount, updated_at = now() WHERE id = v_tx.account_id;
  END IF;

  -- Mark transaction as approved
  UPDATE public.transactions 
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), completed_at = now() 
  WHERE id = p_transaction_id;

  RETURN json_build_object('success', true, 'message', 'Transaction approved and balance updated');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 3: Request a Loan
CREATE OR REPLACE FUNCTION request_loan(
  p_sacco_id UUID,
  p_amount NUMERIC,
  p_term_months INTEGER,
  p_purpose TEXT
) RETURNS JSON AS $$
BEGIN
  -- Insert a pending loan
  INSERT INTO public.loans (sacco_id, profile_id, amount_requested, term_months, purpose, status)
  VALUES (p_sacco_id, auth.uid(), p_amount, p_term_months, p_purpose, 'pending');

  RETURN json_build_object('success', true, 'message', 'Loan requested successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
