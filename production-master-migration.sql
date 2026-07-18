-- ==============================================================================
-- SACCO MANAGEMENT SAAS - MASTER PRODUCTION MIGRATION SCRIPT
-- ==============================================================================
-- Description: Consolidated master SQL migration script for complete database setup.
-- Includes: Core tables, foreign keys, performance indexes, automated triggers,
--           Row Level Security (RLS) policies, and server-side RPC functions.
-- Execute this script directly in the Supabase SQL Editor for a 1-click setup.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PART 1: CORE TABLES & CONSTRAINTS
-- ------------------------------------------------------------------------------

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  member_number TEXT UNIQUE NOT NULL,
  group_id TEXT,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'loan_officer', 'admin')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shares_target NUMERIC(15, 2) DEFAULT 50000.00,
  devt_target NUMERIC(15, 2) DEFAULT 10000.00,
  social_target NUMERIC(15, 2) DEFAULT 10000.00,
  avatar_url TEXT
);

-- 2. SACCOs Table
CREATE TABLE IF NOT EXISTS public.saccos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  acronym TEXT NOT NULL,
  group_code TEXT UNIQUE NOT NULL,
  admin_profile_id UUID REFERENCES public.profiles(id),
  member_limit INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  share_price NUMERIC(15, 2) NOT NULL DEFAULT 25000.00,
  devt_fund NUMERIC(15, 2) NOT NULL DEFAULT 1000.00,
  social_fund NUMERIC(15, 2) NOT NULL DEFAULT 2000.00,
  current_week INTEGER NOT NULL DEFAULT 1 CHECK (current_week BETWEEN 1 AND 52),
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backwards compatibility schema migration for existing saccos table
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS share_price NUMERIC(15, 2) NOT NULL DEFAULT 25000.00;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS devt_fund NUMERIC(15, 2) NOT NULL DEFAULT 1000.00;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS social_fund NUMERIC(15, 2) NOT NULL DEFAULT 2000.00;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS current_week INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. SACCO Memberships Table
CREATE TABLE IF NOT EXISTS public.sacco_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'loan_officer', 'admin')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended', 'removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sacco_id, profile_id)
);

-- 4. Accounts Table
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('savings', 'shares', 'development_fund', 'social_fund', 'loan')),
  balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sacco_id, profile_id, account_type)
);

-- 5. Loans Table
CREATE TABLE IF NOT EXISTS public.loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount_requested NUMERIC(15, 2) NOT NULL CHECK (amount_requested > 0),
  amount_approved NUMERIC(15, 2) CHECK (amount_approved >= 0),
  outstanding_balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (outstanding_balance >= 0),
  interest_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (interest_rate >= 0),
  term_months INTEGER CHECK (term_months > 0),
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'disbursed', 'active', 'completed', 'defaulted', 'cancelled', 'issued')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  disbursed_at TIMESTAMPTZ,
  due_date DATE,
  loan_type TEXT NOT NULL DEFAULT 'normal' CHECK (loan_type IN ('normal', 'social_fund')),
  closed_at TIMESTAMPTZ
);

-- 6. Transactions Table
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  loan_id UUID REFERENCES public.loans(id) ON DELETE RESTRICT,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  category TEXT NOT NULL
    CHECK (category IN (
      'savings',
      'shares',
      'development_fund',
      'social_fund',
      'loan_disbursement',
      'loan_repayment',
      'fee',
      'fine',
      'dividend',
      'adjustment'
    )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'failed', 'reversed')),
  description TEXT,
  full_name TEXT,
  reference TEXT,
  requested_by UUID REFERENCES public.profiles(id),
  approved_by UUID REFERENCES public.profiles(id),
  approved_at DATE,
  completed_at DATE,
  created_at DATE NOT NULL DEFAULT CURRENT_DATE
);

-- 7. Loan Repayments Table
CREATE TABLE IF NOT EXISTS public.loan_repayments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  transaction_id UUID UNIQUE REFERENCES public.transactions(id) ON DELETE RESTRICT,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_account_id UUID REFERENCES public.accounts(id)
);

-- 8. Audit Events Table
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  actor_profile_id UUID REFERENCES public.profiles(id),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- PART 2: HIGH PERFORMANCE INDEXES
-- ------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_profiles_group_id ON public.profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_saccos_group_code ON public.saccos(group_code);
CREATE INDEX IF NOT EXISTS idx_sacco_memberships_sacco ON public.sacco_memberships(sacco_id);
CREATE INDEX IF NOT EXISTS idx_sacco_memberships_profile ON public.sacco_memberships(profile_id);
CREATE INDEX IF NOT EXISTS idx_accounts_profile_sacco ON public.accounts(sacco_id, profile_id);
CREATE INDEX IF NOT EXISTS idx_transactions_profile_category ON public.transactions(profile_id, category);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_loans_profile_status ON public.loans(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_events_sacco ON public.audit_events(sacco_id);

-- ------------------------------------------------------------------------------
-- PART 3: AUTOMATED DATABASE TRIGGERS
-- ------------------------------------------------------------------------------

-- Trigger 1: Automatic Profile Creation on Supabase Auth Signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_sacco_id UUID;
  v_group_id TEXT;
BEGIN
  v_group_id := NEW.raw_user_meta_data->>'group_id';

  INSERT INTO public.profiles (id, full_name, email, phone, member_number, group_id, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'phone',
    COALESCE(NEW.raw_user_meta_data->>'member_number', 'MEMBER-' || substring(NEW.id::text, 1, 8)),
    v_group_id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'member'),
    COALESCE(NEW.raw_user_meta_data->>'status', 'pending')
  )
  ON CONFLICT (id) DO NOTHING;

  -- If group_id is provided, link pending SACCO membership
  IF v_group_id IS NOT NULL AND v_group_id <> '' THEN
    SELECT id INTO v_sacco_id FROM public.saccos WHERE UPPER(group_code) = UPPER(v_group_id);
    IF v_sacco_id IS NOT NULL THEN
      INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
      VALUES (v_sacco_id, NEW.id, 'member', 'pending')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Trigger 2: Automatic Member Accounts Initialization
CREATE OR REPLACE FUNCTION public.initialize_member_accounts()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance)
  VALUES 
    (NEW.sacco_id, NEW.profile_id, 'savings', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'shares', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'development_fund', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'social_fund', 0.00),
    (NEW.sacco_id, NEW.profile_id, 'loan', 0.00)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_sacco_membership_created ON public.sacco_memberships;
CREATE TRIGGER on_sacco_membership_created
  AFTER INSERT ON public.sacco_memberships
  FOR EACH ROW EXECUTE PROCEDURE public.initialize_member_accounts();

-- Trigger 3: Sync Profile Full Name & Account Reference to Transactions
CREATE OR REPLACE FUNCTION public.sync_transaction_full_name()
RETURNS trigger AS $$
DECLARE
  v_account_type TEXT;
BEGIN
  SELECT full_name INTO NEW.full_name
  FROM public.profiles
  WHERE id = NEW.profile_id;

  IF NEW.account_id IS NULL THEN
    IF NEW.category = 'loan_disbursement' OR NEW.category = 'loan_repayment' THEN
      v_account_type := 'loan';
    ELSE
      v_account_type := NEW.category;
    END IF;

    SELECT id INTO NEW.account_id
    FROM public.accounts
    WHERE profile_id = NEW.profile_id 
      AND sacco_id = NEW.sacco_id 
      AND account_type = v_account_type
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_transaction_insert ON public.transactions;
CREATE TRIGGER on_transaction_insert
  BEFORE INSERT OR UPDATE OF profile_id ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE public.sync_transaction_full_name();

-- Trigger 4: Synchronize Loan Status on Transaction Approval/Rejection
CREATE OR REPLACE FUNCTION public.sync_loan_on_transaction_approval()
RETURNS trigger AS $$
BEGIN
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

  IF NEW.status = 'rejected' AND OLD.status = 'pending' AND NEW.category = 'loan_disbursement' AND NEW.loan_id IS NOT NULL THEN
    UPDATE public.loans
    SET 
      status = 'rejected',
      approved_by = NEW.approved_by,
      approved_at = NOW()
    WHERE id = NEW.loan_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_transaction_approval ON public.transactions;
CREATE TRIGGER on_transaction_approval
  AFTER UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE PROCEDURE public.sync_loan_on_transaction_approval();

-- ------------------------------------------------------------------------------
-- PART 4: ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saccos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- SACCOs Policies
DROP POLICY IF EXISTS "Anyone can view saccos" ON public.saccos;
CREATE POLICY "Anyone can view saccos" ON public.saccos FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can update sacco" ON public.saccos;
CREATE POLICY "Admins can update sacco" ON public.saccos FOR UPDATE USING (
  admin_profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- SACCO Memberships Policies
DROP POLICY IF EXISTS "Users can view their memberships" ON public.sacco_memberships;
CREATE POLICY "Users can view their memberships" ON public.sacco_memberships FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'loan_officer')
  )
);

-- Accounts Policies
DROP POLICY IF EXISTS "Users can view own accounts" ON public.accounts;
CREATE POLICY "Users can view own accounts" ON public.accounts FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'loan_officer')
  )
);

-- Transactions Policies
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (
  profile_id = auth.uid() OR
  requested_by = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'loan_officer')
  )
);

DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
CREATE POLICY "Users can insert own transactions" ON public.transactions FOR INSERT WITH CHECK (
  profile_id = auth.uid() OR requested_by = auth.uid()
);

-- Loans Policies
DROP POLICY IF EXISTS "Users can view own loans" ON public.loans;
CREATE POLICY "Users can view own loans" ON public.loans FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role IN ('admin', 'loan_officer')
  )
);

-- Audit Events Policies
DROP POLICY IF EXISTS "Members can view audit events in their sacco" ON public.audit_events;
CREATE POLICY "Members can view audit events in their sacco" ON public.audit_events FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can log audit events" ON public.audit_events;
CREATE POLICY "Admins can log audit events" ON public.audit_events FOR INSERT WITH CHECK (
  actor_profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.profiles p 
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- ------------------------------------------------------------------------------
-- PART 5: SERVER-SIDE STORED PROCEDURES (RPCs)
-- ------------------------------------------------------------------------------

-- RPC 1: Register a New SACCO Workspace
CREATE OR REPLACE FUNCTION register_new_sacco(
  p_sacco_name TEXT,
  p_acronym TEXT,
  p_group_code TEXT,
  p_admin_profile_id UUID
) RETURNS JSON AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
  INSERT INTO public.saccos (name, acronym, group_code, admin_profile_id, status)
  VALUES (p_sacco_name, p_acronym, UPPER(p_group_code), p_admin_profile_id, 'active')
  RETURNING id INTO v_sacco_id;

  INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
  VALUES (v_sacco_id, p_admin_profile_id, 'admin', 'active')
  ON CONFLICT (sacco_id, profile_id) DO UPDATE SET role = 'admin', status = 'active';

  UPDATE public.profiles
  SET role = 'admin', group_id = UPPER(p_group_code), status = 'active', updated_at = NOW()
  WHERE id = p_admin_profile_id;

  RETURN json_build_object('success', true, 'sacco_id', v_sacco_id, 'message', 'SACCO registered successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 2: Submit Member Transaction Request
CREATE OR REPLACE FUNCTION process_transaction(
  p_sacco_id UUID,
  p_account_id UUID,
  p_amount NUMERIC,
  p_direction TEXT,
  p_category TEXT,
  p_description TEXT
) RETURNS JSON AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND profile_id = auth.uid() AND sacco_id = p_sacco_id) THEN
    RAISE EXCEPTION 'Account not found or access denied';
  END IF;

  INSERT INTO public.transactions (sacco_id, profile_id, account_id, amount, direction, category, status, description, requested_by)
  VALUES (p_sacco_id, auth.uid(), p_account_id, p_amount, p_direction, p_category, 'pending', p_description, auth.uid());

  RETURN json_build_object('success', true, 'message', 'Transaction submitted for approval');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 3: Admin Approve Transaction
CREATE OR REPLACE FUNCTION approve_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
DECLARE
  v_tx RECORD;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_tx.status != 'pending' THEN RAISE EXCEPTION 'Transaction is not pending'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sacco_memberships 
    WHERE sacco_id = v_tx.sacco_id AND profile_id = auth.uid() AND role IN ('admin', 'loan_officer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized to approve transactions for this SACCO';
  END IF;

  IF v_tx.category = 'loan_disbursement' THEN
    UPDATE public.accounts SET balance = balance + v_tx.amount, updated_at = NOW() WHERE id = v_tx.account_id;
  ELSIF v_tx.category = 'loan_repayment' THEN
    UPDATE public.accounts SET balance = balance - v_tx.amount, updated_at = NOW() WHERE id = v_tx.account_id;
  ELSE
    IF v_tx.direction = 'credit' THEN
      UPDATE public.accounts SET balance = balance + v_tx.amount, updated_at = NOW() WHERE id = v_tx.account_id;
    ELSIF v_tx.direction = 'debit' THEN
      UPDATE public.accounts SET balance = balance - v_tx.amount, updated_at = NOW() WHERE id = v_tx.account_id;
    END IF;
  END IF;

  UPDATE public.transactions 
  SET status = 'completed', approved_by = auth.uid(), approved_at = NOW(), completed_at = NOW() 
  WHERE id = p_transaction_id;

  RETURN json_build_object('success', true, 'message', 'Transaction approved and balance updated');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 4: Admin Reject Transaction
CREATE OR REPLACE FUNCTION reject_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
DECLARE
  v_tx RECORD;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF v_tx.status != 'pending' THEN RAISE EXCEPTION 'Transaction is not pending'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sacco_memberships 
    WHERE sacco_id = v_tx.sacco_id AND profile_id = auth.uid() AND role IN ('admin', 'loan_officer')
  ) THEN
    RAISE EXCEPTION 'Unauthorized to reject transactions for this SACCO';
  END IF;

  UPDATE public.transactions 
  SET status = 'rejected', approved_by = auth.uid(), approved_at = NOW(), completed_at = NOW() 
  WHERE id = p_transaction_id;

  RETURN json_build_object('success', true, 'message', 'Transaction rejected successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 5: Request Member Loan
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
  IF p_loan_type = 'social_fund' AND p_amount > 50000 THEN
    RAISE EXCEPTION 'Social Fund loan amount cannot exceed Shs 50,000';
  END IF;

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

  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE profile_id = auth.uid() 
    AND sacco_id = p_sacco_id 
    AND account_type = 'loan'
  LIMIT 1;

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

-- RPC 6: Promote Member to Admin
CREATE OR REPLACE FUNCTION make_member_admin(
  p_member_id UUID
) RETURNS JSON AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM public.profiles p_member
    JOIN public.sacco_memberships sm_caller ON sm_caller.profile_id = auth.uid() AND sm_caller.role = 'admin'
    JOIN public.saccos s ON s.id = sm_caller.sacco_id
    WHERE p_member.id = p_member_id AND p_member.group_id = s.group_code
  ) THEN
    RAISE EXCEPTION 'Unauthorized to promote this member or member is not in the same SACCO group';
  END IF;

  UPDATE public.profiles SET role = 'admin', updated_at = NOW() WHERE id = p_member_id;
  UPDATE public.sacco_memberships SET role = 'admin' WHERE profile_id = p_member_id;

  RETURN json_build_object('success', true, 'message', 'Member successfully promoted to admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 7: Entirely Remove Member and Cascading Logs
CREATE OR REPLACE FUNCTION delete_member_entirely(
  p_member_id UUID
) RETURNS JSON AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM public.profiles p_member
    JOIN public.sacco_memberships sm_caller ON sm_caller.profile_id = auth.uid() AND sm_caller.role = 'admin'
    JOIN public.saccos s ON s.id = sm_caller.sacco_id
    WHERE p_member.id = p_member_id AND p_member.group_id = s.group_code
  ) THEN
    RAISE EXCEPTION 'Unauthorized to delete this member or member is not in the same SACCO group';
  END IF;

  DELETE FROM public.loan_repayments WHERE loan_id IN (SELECT id FROM public.loans WHERE profile_id = p_member_id);
  DELETE FROM public.transactions WHERE profile_id = p_member_id OR requested_by = p_member_id OR approved_by = p_member_id;
  DELETE FROM public.loans WHERE profile_id = p_member_id OR approved_by = p_member_id;
  DELETE FROM public.accounts WHERE profile_id = p_member_id;
  DELETE FROM public.sacco_memberships WHERE profile_id = p_member_id;
  DELETE FROM public.audit_events WHERE actor_profile_id = p_member_id;
  DELETE FROM auth.users WHERE id = p_member_id;

  RETURN json_build_object('success', true, 'message', 'Member and all associated data deleted successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC 8: Get Group SACCO Balances Summary
CREATE OR REPLACE FUNCTION public.get_sacco_total_balances(p_profile_id UUID)
RETURNS TABLE (
  account_type TEXT,
  balance NUMERIC
) AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
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
    AND t.category IN ('shares', 'development_fund', 'social_fund', 'savings')
  GROUP BY t.category;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
