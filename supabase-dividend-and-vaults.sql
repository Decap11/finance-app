-- ====================================================================
-- MIGRATION: Advanced Savings & Dividend Distribution Engine
-- Branch: Additional-features
-- ====================================================================

-- 1. Create Dividend Cycles Table
CREATE TABLE IF NOT EXISTS public.dividend_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  cycle_year INTEGER NOT NULL,
  total_profit_pool NUMERIC NOT NULL CHECK (total_profit_pool >= 0),
  total_shares_count INTEGER NOT NULL DEFAULT 0,
  dividend_per_share NUMERIC NOT NULL DEFAULT 0,
  distribution_mode TEXT NOT NULL DEFAULT 'shares' CHECK (distribution_mode IN ('shares', 'savings', 'payout')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('draft', 'completed', 'reversed')),
  executed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Create Dividend Allocations Table
CREATE TABLE IF NOT EXISTS public.dividend_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES public.dividend_cycles(id) ON DELETE CASCADE,
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shares_count INTEGER NOT NULL DEFAULT 0,
  equity_percentage NUMERIC NOT NULL DEFAULT 0,
  payout_amount NUMERIC NOT NULL DEFAULT 0,
  distribution_mode TEXT NOT NULL DEFAULT 'shares',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create Savings Vaults (Piggybank Target Savings) Table
CREATE TABLE IF NOT EXISTS public.savings_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vault_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  target_amount NUMERIC NOT NULL CHECK (target_amount > 0),
  current_balance NUMERIC NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  target_date DATE,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'broken')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.dividend_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividend_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_vaults ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view dividend cycles for their sacco" ON public.dividend_cycles;
DROP POLICY IF EXISTS "Admins can manage dividend cycles" ON public.dividend_cycles;
DROP POLICY IF EXISTS "Users can view their dividend allocations" ON public.dividend_allocations;
DROP POLICY IF EXISTS "Admins can manage dividend allocations" ON public.dividend_allocations;
DROP POLICY IF EXISTS "Users can manage their savings vaults" ON public.savings_vaults;

-- Create RLS Policies
CREATE POLICY "Users can view dividend cycles for their sacco" 
  ON public.dividend_cycles FOR SELECT USING (true);

CREATE POLICY "Admins can manage dividend cycles" 
  ON public.dividend_cycles FOR ALL USING (true);

CREATE POLICY "Users can view their dividend allocations" 
  ON public.dividend_allocations FOR SELECT USING (true);

CREATE POLICY "Admins can manage dividend allocations" 
  ON public.dividend_allocations FOR ALL USING (true);

CREATE POLICY "Users can manage their savings vaults" 
  ON public.savings_vaults FOR ALL USING (true);

-- 4. RPC Function: Preview Dividend Payout Calculations
CREATE OR REPLACE FUNCTION public.calculate_dividend_preview(
  p_sacco_id UUID,
  p_profit_pool NUMERIC
) RETURNS JSON AS $$
DECLARE
  v_total_shares INTEGER := 0;
  v_div_per_share NUMERIC := 0;
  v_members JSON;
BEGIN
  -- Sum total shares owned across active members in this SACCO
  SELECT COALESCE(SUM(balance), 0) INTO v_total_shares
  FROM public.accounts
  WHERE sacco_id = p_sacco_id AND account_type = 'shares';

  IF v_total_shares > 0 THEN
    v_div_per_share := p_profit_pool / v_total_shares;
  END IF;

  -- Build breakdown per member
  SELECT json_agg(json_build_object(
    'profile_id', p.id,
    'full_name', p.full_name,
    'member_number', p.member_number,
    'shares_count', COALESCE(a.balance, 0),
    'equity_percentage', CASE WHEN v_total_shares > 0 THEN ROUND((COALESCE(a.balance, 0)::NUMERIC / v_total_shares * 100), 2) ELSE 0 END,
    'calculated_payout', ROUND(COALESCE(a.balance, 0) * v_div_per_share, 2)
  )) INTO v_members
  FROM public.profiles p
  JOIN public.sacco_memberships sm ON sm.profile_id = p.id AND sm.sacco_id = p_sacco_id AND sm.status = 'active'
  LEFT JOIN public.accounts a ON a.profile_id = p.id AND a.sacco_id = p_sacco_id AND a.account_type = 'shares';

  RETURN json_build_object(
    'sacco_id', p_sacco_id,
    'profit_pool', p_profit_pool,
    'total_shares', v_total_shares,
    'dividend_per_share', ROUND(v_div_per_share, 2),
    'members', COALESCE(v_members, '[]'::json)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. RPC Function: Execute Bulk Dividend Payout
CREATE OR REPLACE FUNCTION public.execute_dividend_payout(
  p_sacco_id UUID,
  p_cycle_year INTEGER,
  p_profit_pool NUMERIC,
  p_distribution_mode TEXT DEFAULT 'shares'
) RETURNS JSON AS $$
DECLARE
  v_cycle_id UUID;
  v_total_shares INTEGER := 0;
  v_div_per_share NUMERIC := 0;
  v_rec RECORD;
  v_payout NUMERIC := 0;
  v_eq_pct NUMERIC := 0;
  v_count INTEGER := 0;
BEGIN
  -- Sum total shares
  SELECT COALESCE(SUM(balance), 0) INTO v_total_shares
  FROM public.accounts
  WHERE sacco_id = p_sacco_id AND account_type = 'shares';

  IF v_total_shares <= 0 THEN
    RAISE EXCEPTION 'No shares recorded in this SACCO to distribute dividends.';
  END IF;

  v_div_per_share := p_profit_pool / v_total_shares;

  -- Create Dividend Cycle Record
  INSERT INTO public.dividend_cycles (
    sacco_id, cycle_year, total_profit_pool, total_shares_count, dividend_per_share, distribution_mode, executed_by
  ) VALUES (
    p_sacco_id, p_cycle_year, p_profit_pool, v_total_shares, v_div_per_share, p_distribution_mode, auth.uid()
  ) RETURNING id INTO v_cycle_id;

  -- Loop through active members and allocate dividends
  FOR v_rec IN 
    SELECT p.id AS profile_id, COALESCE(a.balance, 0) AS member_shares, a.id AS account_id
    FROM public.profiles p
    JOIN public.sacco_memberships sm ON sm.profile_id = p.id AND sm.sacco_id = p_sacco_id AND sm.status = 'active'
    LEFT JOIN public.accounts a ON a.profile_id = p.id AND a.sacco_id = p_sacco_id AND a.account_type = 'shares'
  LOOP
    IF v_rec.member_shares > 0 THEN
      v_payout := ROUND(v_rec.member_shares * v_div_per_share, 2);
      v_eq_pct := ROUND((v_rec.member_shares::NUMERIC / v_total_shares * 100), 2);

      -- Record Allocation
      INSERT INTO public.dividend_allocations (
        cycle_id, sacco_id, profile_id, shares_count, equity_percentage, payout_amount, distribution_mode
      ) VALUES (
        v_cycle_id, p_sacco_id, v_rec.profile_id, v_rec.member_shares, v_eq_pct, v_payout, p_distribution_mode
      );

      -- Credit Member Ledger
      IF p_distribution_mode = 'shares' THEN
        -- Reinvest into shares account
        UPDATE public.accounts SET balance = balance + v_payout, updated_at = now() 
        WHERE profile_id = v_rec.profile_id AND sacco_id = p_sacco_id AND account_type = 'shares';
      ELSE
        -- Credit general savings account
        UPDATE public.accounts SET balance = balance + v_payout, updated_at = now() 
        WHERE profile_id = v_rec.profile_id AND sacco_id = p_sacco_id AND account_type = 'savings';
      END IF;

      -- Log Transaction
      INSERT INTO public.transactions (
        sacco_id, profile_id, direction, category, amount, status, description, requested_by, approved_by, approved_at, completed_at
      ) VALUES (
        p_sacco_id, v_rec.profile_id, 'credit', 'dividend', v_payout, 'completed', 
        format('%s Dividend Distribution %s (%s shares)', p_cycle_year, p_distribution_mode, v_rec.member_shares),
        auth.uid(), auth.uid(), now(), now()
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'cycle_id', v_cycle_id,
    'members_credited', v_count,
    'total_distributed', p_profit_pool,
    'message', format('Successfully distributed UGX %s in dividends to %s members.', p_profit_pool, v_count)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.calculate_dividend_preview(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_dividend_payout(UUID, INTEGER, NUMERIC, TEXT) TO authenticated;
