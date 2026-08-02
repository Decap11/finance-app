-- ====================================================================================
-- SECURITY HARDENING MIGRATION
-- Copy and paste this entire script into your Supabase SQL Editor and click "RUN".
--
-- Safe to run regardless of which prior supabase-*.sql files have already run against
-- this project: every DROP is IF EXISTS, every function is CREATE OR REPLACE, and RLS
-- is force-enabled unconditionally as the first step (supabase-register-sacco.sql
-- previously disabled it outright on several tables).
--
-- What this fixes:
--   1. Every "Authenticated users access X" / "*_all_policy" / "*_select_policy" style
--      policy across profiles/saccos/sacco_memberships/accounts/sacco_settings/
--      dividend_cycles/dividend_allocations/savings_vaults/loan_guarantors currently
--      reads USING (true) despite reassuring names -- effectively no protection at all
--      for anyone holding the public anon key. This migration drops every one of those
--      by exact name and replaces them with real, auth.uid()-scoped policies.
--   2. audit_events has never had Row Level Security enabled in any prior migration --
--      only a blanket table GRANT. This migration enables it and adds real policies.
--   3. Six SECURITY DEFINER functions (which bypass RLS by design) had no internal
--      authorization checks at all: execute_dividend_payout, calculate_dividend_preview,
--      process_guarantor_response, get_sacco_total_balances, register_new_sacco, and
--      approve_member_transaction/reject_member_transaction (the last two had an
--      unscoped "any admin, any SACCO" clause). All six are hardened here.
--   4. The signup trigger (handle_new_user) previously read `role` directly from
--      client-supplied signup metadata, letting anyone self-declare role: 'admin' and
--      hijack an existing SACCO's admin seat by guessing its group code. The replacement
--      trigger hardcodes role to 'member' and never touches an existing SACCO's admin.
--
-- Deploy order: the app-code changes (API routes forwarding the caller's JWT into the
-- newly-guarded RPCs) must already be live before you run this script, or dividend
-- preview/payout and guarantor-respond will fail for every user immediately after.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: Force RLS on everywhere it should be, unconditionally.
-- ====================================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saccos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividend_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividend_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_guarantors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;


-- ====================================================================================
-- STEP 2: profiles
-- ====================================================================================
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users access profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow profile creation on signup" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public and authenticated read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert and update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

-- Members need to see each other's names/member numbers within the app; keep SELECT broad.
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- auth.uid() = id alone would still let a member UPDATE their own role/status/group_id
-- to self-promote. Column-level privileges close that gap without touching SECURITY
-- DEFINER functions (register_new_sacco, make_member_admin, handle_new_user), which run
-- as the function owner and are unaffected by these GRANT/REVOKE statements.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name, phone, email, avatar_url, shares_target, devt_target, social_target, updated_at)
  ON public.profiles TO authenticated;
-- role, status, group_id, member_number, id, created_at are deliberately NOT grantable.


-- ====================================================================================
-- STEP 3: saccos
-- ====================================================================================
DROP POLICY IF EXISTS "saccos_select_policy" ON public.saccos;
DROP POLICY IF EXISTS "saccos_insert_policy" ON public.saccos;
DROP POLICY IF EXISTS "saccos_update_policy" ON public.saccos;
DROP POLICY IF EXISTS "Authenticated users access saccos" ON public.saccos;
DROP POLICY IF EXISTS "Anyone can view saccos" ON public.saccos;
DROP POLICY IF EXISTS "Authenticated users can create saccos" ON public.saccos;
DROP POLICY IF EXISTS "Admins can update sacco" ON public.saccos;
DROP POLICY IF EXISTS "Anyone can insert saccos via rpc" ON public.saccos;
DROP POLICY IF EXISTS "Public and authenticated access saccos" ON public.saccos;
DROP POLICY IF EXISTS "saccos_select_all" ON public.saccos;
DROP POLICY IF EXISTS "saccos_update_admin_only" ON public.saccos;

CREATE POLICY "saccos_select_all" ON public.saccos FOR SELECT USING (true);
CREATE POLICY "saccos_update_admin_only" ON public.saccos FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = saccos.id AND sm.profile_id = auth.uid() AND sm.role = 'admin'
  )
);
-- No INSERT policy: SACCO creation only ever happens through the hardened
-- register_new_sacco() function below (SECURITY DEFINER, bypasses RLS by design).
-- Verified no browser code performs a direct saccos INSERT.


-- ====================================================================================
-- STEP 4: sacco_memberships (drives every role check in the app)
-- ====================================================================================
DROP POLICY IF EXISTS "sacco_memberships_select_policy" ON public.sacco_memberships;
DROP POLICY IF EXISTS "sacco_memberships_all_policy" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Authenticated users access memberships" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Users can view their memberships" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Allow membership inserts via trusted functions" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Anyone can insert memberships via rpc" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Admins can insert memberships" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Public and authenticated access memberships" ON public.sacco_memberships;
DROP POLICY IF EXISTS "sacco_memberships_select_own_or_staff" ON public.sacco_memberships;
DROP POLICY IF EXISTS "sacco_memberships_insert_self_or_admin" ON public.sacco_memberships;
DROP POLICY IF EXISTS "sacco_memberships_update_admin_only" ON public.sacco_memberships;

CREATE POLICY "sacco_memberships_select_own_or_staff" ON public.sacco_memberships FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = sacco_memberships.sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);

-- The old "trusted functions" INSERT policy was WITH CHECK (true) -- SECURITY DEFINER
-- functions bypass RLS entirely regardless, so that clause only ever served to let any
-- authenticated client insert themselves into ANY sacco with role='admin' directly.
CREATE POLICY "sacco_memberships_insert_self_or_admin" ON public.sacco_memberships FOR INSERT WITH CHECK (
  (profile_id = auth.uid() AND role = 'member')
  OR EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = sacco_memberships.sacco_id AND sm.profile_id = auth.uid() AND sm.role = 'admin'
  )
);

CREATE POLICY "sacco_memberships_update_admin_only" ON public.sacco_memberships FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = sacco_memberships.sacco_id AND sm.profile_id = auth.uid() AND sm.role = 'admin'
  )
);


-- ====================================================================================
-- STEP 5: accounts
-- ====================================================================================
DROP POLICY IF EXISTS "accounts_select_policy" ON public.accounts;
DROP POLICY IF EXISTS "accounts_all_policy" ON public.accounts;
DROP POLICY IF EXISTS "Authenticated users access accounts" ON public.accounts;
DROP POLICY IF EXISTS "Users can view own accounts" ON public.accounts;
DROP POLICY IF EXISTS "Public and authenticated access accounts" ON public.accounts;
DROP POLICY IF EXISTS "accounts_select_own_or_staff" ON public.accounts;

CREATE POLICY "accounts_select_own_or_staff" ON public.accounts FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = accounts.sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);
-- No INSERT/UPDATE/DELETE policy: balance changes only ever happen through the
-- SECURITY DEFINER functions (process_transaction, approve_member_transaction,
-- execute_dividend_payout, etc). Verified the redundant client-side accounts upsert in
-- SignUp.tsx is wrapped in try/catch and non-fatal if it now no-ops under RLS -- the
-- handle_new_user trigger already seeds these rows authoritatively before that call runs.


-- ====================================================================================
-- STEP 6: sacco_settings
-- ====================================================================================
DROP POLICY IF EXISTS "sacco_settings_select_policy" ON public.sacco_settings;
DROP POLICY IF EXISTS "sacco_settings_all_policy" ON public.sacco_settings;
DROP POLICY IF EXISTS "Authenticated users access sacco_settings" ON public.sacco_settings;
DROP POLICY IF EXISTS "Anyone can view sacco settings" ON public.sacco_settings;
DROP POLICY IF EXISTS "Admins can update sacco settings" ON public.sacco_settings;
DROP POLICY IF EXISTS "Public and authenticated access settings" ON public.sacco_settings;
DROP POLICY IF EXISTS "sacco_settings_select_all" ON public.sacco_settings;
DROP POLICY IF EXISTS "sacco_settings_write_admin_only" ON public.sacco_settings;

CREATE POLICY "sacco_settings_select_all" ON public.sacco_settings FOR SELECT USING (true);
CREATE POLICY "sacco_settings_write_admin_only" ON public.sacco_settings FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = sacco_settings.sacco_id AND sm.profile_id = auth.uid() AND sm.role = 'admin'
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = sacco_settings.sacco_id AND sm.profile_id = auth.uid() AND sm.role = 'admin'
  )
);


-- ====================================================================================
-- STEP 7: dividend_cycles / dividend_allocations -- SELECT only, writes via
-- execute_dividend_payout() only.
-- ====================================================================================
DROP POLICY IF EXISTS "Users can view dividend cycles for their sacco" ON public.dividend_cycles;
DROP POLICY IF EXISTS "Admins can manage dividend cycles" ON public.dividend_cycles;
DROP POLICY IF EXISTS "dividend_cycles_select_members" ON public.dividend_cycles;

CREATE POLICY "dividend_cycles_select_members" ON public.dividend_cycles FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = dividend_cycles.sacco_id AND sm.profile_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can view their dividend allocations" ON public.dividend_allocations;
DROP POLICY IF EXISTS "Admins can manage dividend allocations" ON public.dividend_allocations;
DROP POLICY IF EXISTS "dividend_allocations_select_own_or_staff" ON public.dividend_allocations;

CREATE POLICY "dividend_allocations_select_own_or_staff" ON public.dividend_allocations FOR SELECT USING (
  profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = dividend_allocations.sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);


-- ====================================================================================
-- STEP 8: savings_vaults -- fully owner-scoped.
-- ====================================================================================
DROP POLICY IF EXISTS "Users can manage their savings vaults" ON public.savings_vaults;
DROP POLICY IF EXISTS "savings_vaults_owner_all" ON public.savings_vaults;

CREATE POLICY "savings_vaults_owner_all" ON public.savings_vaults FOR ALL
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());


-- ====================================================================================
-- STEP 9: loan_guarantors -- SELECT + scoped INSERT; status changes via
-- process_guarantor_response() only (no direct UPDATE policy).
-- ====================================================================================
DROP POLICY IF EXISTS "Users can view loan guarantors" ON public.loan_guarantors;
DROP POLICY IF EXISTS "Guarantors can update their status" ON public.loan_guarantors;
DROP POLICY IF EXISTS "Admins can manage loan guarantors" ON public.loan_guarantors;
DROP POLICY IF EXISTS "loan_guarantors_select_involved" ON public.loan_guarantors;
DROP POLICY IF EXISTS "loan_guarantors_insert_by_borrower" ON public.loan_guarantors;

CREATE POLICY "loan_guarantors_select_involved" ON public.loan_guarantors FOR SELECT USING (
  guarantor_profile_id = auth.uid() OR borrower_profile_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = loan_guarantors.sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);

-- Verified src/app/api/loans/route.js's request_loan RPC path also inserts here with a
-- user-scoped client, and the borrower must own the loan and self-nominate as pending
-- only -- prevents a borrower from directly inserting a pre-approved guarantee.
CREATE POLICY "loan_guarantors_insert_by_borrower" ON public.loan_guarantors FOR INSERT WITH CHECK (
  status = 'pending' AND borrower_profile_id = auth.uid() AND
  EXISTS (SELECT 1 FROM public.loans l WHERE l.id = loan_guarantors.loan_id AND l.profile_id = auth.uid())
);


-- ====================================================================================
-- STEP 10: audit_events -- never had RLS enabled before this migration.
-- ====================================================================================
DROP POLICY IF EXISTS "audit_events_select_members" ON public.audit_events;
DROP POLICY IF EXISTS "audit_events_insert_staff" ON public.audit_events;

CREATE POLICY "audit_events_select_members" ON public.audit_events FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = audit_events.sacco_id AND sm.profile_id = auth.uid()
  )
);

-- admin AND loan_officer, not admin-only: WeeklyAttendanceManager.jsx (attendance
-- snapshots) and BroadcastMessageWidget.jsx (broadcasts) both insert here directly.
CREATE POLICY "audit_events_insert_staff" ON public.audit_events FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = audit_events.sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);
-- Companion app-code fix already applied: WeeklyAttendanceManager.jsx's audit_events
-- insert now includes a top-level sacco_id field (it previously only nested sacco_id
-- inside metadata JSON, which this policy cannot see).


-- ====================================================================================
-- STEP 11: loan_repayments -- SELECT only; confirmed no direct client writes exist.
-- ====================================================================================
DROP POLICY IF EXISTS "loan_repayments_select_own_or_staff" ON public.loan_repayments;

CREATE POLICY "loan_repayments_select_own_or_staff" ON public.loan_repayments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.loans l WHERE l.id = loan_repayments.loan_id AND l.profile_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.loans l
    JOIN public.sacco_memberships sm ON sm.sacco_id = l.sacco_id
    WHERE l.id = loan_repayments.loan_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);


-- ====================================================================================
-- STEP 12: transactions / loans -- verified already correctly scoped in
-- supabase-rls-and-rpc.sql (SELECT-only, auth.uid()-keyed) and never contradicted by any
-- other file. Left untouched, EXCEPT one narrow addition: WeeklyAttendanceManager.jsx
-- directly inserts pending absenteeism-fine transactions from the browser (admin
-- dashboard), which needs an explicit scoped INSERT policy to keep working now that RLS
-- is enforced everywhere.
-- ====================================================================================
DROP POLICY IF EXISTS "transactions_insert_staff_fines" ON public.transactions;

CREATE POLICY "transactions_insert_staff_fines" ON public.transactions FOR INSERT WITH CHECK (
  category = 'fines' AND status = 'pending' AND
  EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = transactions.sacco_id AND sm.profile_id = auth.uid() AND sm.role IN ('admin', 'loan_officer')
  )
);


-- ====================================================================================
-- STEP 13: Harden six SECURITY DEFINER functions.
-- These bypass RLS by design, so the table policies above do not protect them --
-- each needs its own internal auth.uid() check.
-- ====================================================================================

-- 13a. calculate_dividend_preview -- was fully unauthenticated; leaked every member's
-- financial data for any SACCO to any caller.
CREATE OR REPLACE FUNCTION public.calculate_dividend_preview(
  p_sacco_id UUID,
  p_profit_pool NUMERIC
) RETURNS JSON AS $$
DECLARE
  v_total_shares INTEGER := 0;
  v_div_per_share NUMERIC := 0;
  v_members JSON;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sacco_memberships sm WHERE sm.sacco_id = p_sacco_id AND sm.profile_id = auth.uid() AND sm.role = 'admin'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.saccos s WHERE s.id = p_sacco_id AND s.admin_profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only the SACCO admin can access this.';
  END IF;

  SELECT COALESCE(SUM(balance), 0) INTO v_total_shares
  FROM public.accounts
  WHERE sacco_id = p_sacco_id AND account_type = 'shares';

  IF v_total_shares > 0 THEN
    v_div_per_share := p_profit_pool / v_total_shares;
  END IF;

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

-- 13b. execute_dividend_payout -- most severe finding in the whole audit: was fully
-- unauthenticated, letting any logged-in member credit real money into any SACCO's
-- member accounts.
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
  IF NOT EXISTS (
    SELECT 1 FROM public.sacco_memberships sm WHERE sm.sacco_id = p_sacco_id AND sm.profile_id = auth.uid() AND sm.role = 'admin'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.saccos s WHERE s.id = p_sacco_id AND s.admin_profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only the SACCO admin can access this.';
  END IF;

  SELECT COALESCE(SUM(balance), 0) INTO v_total_shares
  FROM public.accounts
  WHERE sacco_id = p_sacco_id AND account_type = 'shares';

  IF v_total_shares <= 0 THEN
    RAISE EXCEPTION 'No shares recorded in this SACCO to distribute dividends.';
  END IF;

  v_div_per_share := p_profit_pool / v_total_shares;

  INSERT INTO public.dividend_cycles (
    sacco_id, cycle_year, total_profit_pool, total_shares_count, dividend_per_share, distribution_mode, executed_by
  ) VALUES (
    p_sacco_id, p_cycle_year, p_profit_pool, v_total_shares, v_div_per_share, p_distribution_mode, auth.uid()
  ) RETURNING id INTO v_cycle_id;

  FOR v_rec IN
    SELECT p.id AS profile_id, COALESCE(a.balance, 0) AS member_shares, a.id AS account_id
    FROM public.profiles p
    JOIN public.sacco_memberships sm ON sm.profile_id = p.id AND sm.sacco_id = p_sacco_id AND sm.status = 'active'
    LEFT JOIN public.accounts a ON a.profile_id = p.id AND a.sacco_id = p_sacco_id AND a.account_type = 'shares'
  LOOP
    IF v_rec.member_shares > 0 THEN
      v_payout := ROUND(v_rec.member_shares * v_div_per_share, 2);
      v_eq_pct := ROUND((v_rec.member_shares::NUMERIC / v_total_shares * 100), 2);

      INSERT INTO public.dividend_allocations (
        cycle_id, sacco_id, profile_id, shares_count, equity_percentage, payout_amount, distribution_mode
      ) VALUES (
        v_cycle_id, p_sacco_id, v_rec.profile_id, v_rec.member_shares, v_eq_pct, v_payout, p_distribution_mode
      );

      IF p_distribution_mode = 'shares' THEN
        UPDATE public.accounts SET balance = balance + v_payout, updated_at = now()
        WHERE profile_id = v_rec.profile_id AND sacco_id = p_sacco_id AND account_type = 'shares';
      ELSE
        UPDATE public.accounts SET balance = balance + v_payout, updated_at = now()
        WHERE profile_id = v_rec.profile_id AND sacco_id = p_sacco_id AND account_type = 'savings';
      END IF;

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

GRANT EXECUTE ON FUNCTION public.calculate_dividend_preview(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_dividend_payout(UUID, INTEGER, NUMERIC, TEXT) TO authenticated;


-- 13c. process_guarantor_response -- was fully unauthenticated; anyone could
-- approve/reject any guarantor request, including self-approving their own loan.
CREATE OR REPLACE FUNCTION public.process_guarantor_response(
  p_guarantor_id UUID,
  p_response TEXT
) RETURNS JSON AS $$
DECLARE
  v_rec RECORD;
  v_pending_count INTEGER := 0;
  v_rejected_count INTEGER := 0;
BEGIN
  SELECT * INTO v_rec FROM public.loan_guarantors WHERE id = p_guarantor_id;

  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'Guarantor record not found.';
  END IF;

  IF auth.uid() IS NULL OR v_rec.guarantor_profile_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: only the nominated guarantor may respond to this request.';
  END IF;

  UPDATE public.loan_guarantors
  SET status = p_response, responded_at = now()
  WHERE id = p_guarantor_id;

  SELECT COUNT(*) INTO v_pending_count
  FROM public.loan_guarantors
  WHERE loan_id = v_rec.loan_id AND status = 'pending';

  SELECT COUNT(*) INTO v_rejected_count
  FROM public.loan_guarantors
  WHERE loan_id = v_rec.loan_id AND status = 'rejected';

  IF v_rejected_count > 0 THEN
    UPDATE public.loans
    SET guarantor_status = 'guarantors_rejected', status = 'rejected'
    WHERE id = v_rec.loan_id;

    RETURN json_build_object(
      'success', true,
      'loan_status', 'rejected',
      'message', 'Loan guarantee rejected. Loan request declined.'
    );
  ELSIF v_pending_count = 0 THEN
    UPDATE public.loans
    SET guarantor_status = 'guarantors_approved', status = 'pending'
    WHERE id = v_rec.loan_id;

    RETURN json_build_object(
      'success', true,
      'loan_status', 'pending_admin_approval',
      'message', 'All guarantors have approved! Loan escalated for Admin final approval.'
    );
  ELSE
    RETURN json_build_object(
      'success', true,
      'loan_status', 'pending_guarantors',
      'message', format('Response recorded. %s more guarantor(s) pending.', v_pending_count)
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.process_guarantor_response(UUID, TEXT) TO authenticated;


-- 13d. get_sacco_total_balances -- took the target profile as a raw parameter with no
-- check, letting any caller view any other member's balance breakdown. Both real call
-- sites already always pass their own id, so this closes dead attack surface only.
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
    AND t.category IN ('shares', 'development_fund', 'social_fund', 'savings')
  GROUP BY t.category;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_sacco_total_balances(UUID) TO authenticated;


-- 13e. register_new_sacco -- three competing bodies existed across prior migration
-- files, none checked the caller's identity at all, and the existing-group_code path
-- silently reassigned admin_profile_id to whoever called it -- i.e. anyone who guessed
-- an existing SACCO's group code could hijack its admin seat. This is the single
-- canonical replacement.
CREATE OR REPLACE FUNCTION public.register_new_sacco(
  p_sacco_name TEXT,
  p_acronym TEXT,
  p_group_code TEXT,
  p_admin_profile_id UUID
) RETURNS JSON AS $func$
DECLARE
  v_sacco_id UUID;
  v_existing_admin UUID;
  v_meeting_day TEXT;
  v_clean_code TEXT;
  v_admin_mem_num TEXT;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_admin_profile_id THEN
    RAISE EXCEPTION 'Unauthorized: you may only register a SACCO for your own account.';
  END IF;

  SET LOCAL row_security = off;

  v_clean_code := UPPER(TRIM(p_group_code));
  v_meeting_day := TRIM(TO_CHAR(now(), 'Day'));
  v_admin_mem_num := 'MEM-001';

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_profile_id) THEN
    INSERT INTO public.profiles (id, full_name, email, phone, member_number, group_id, role, status)
    SELECT
      u.id,
      COALESCE(u.raw_user_meta_data->>'full_name', 'SACCO Admin'),
      u.email,
      u.raw_user_meta_data->>'phone',
      COALESCE(u.raw_user_meta_data->>'member_number', v_admin_mem_num),
      v_clean_code,
      'admin',
      'active'
    FROM auth.users u
    WHERE u.id = p_admin_profile_id
    ON CONFLICT (id) DO UPDATE SET
      group_id = EXCLUDED.group_id,
      role = 'admin',
      status = 'active';
  ELSE
    UPDATE public.profiles
    SET group_id = v_clean_code, role = 'admin', status = 'active', updated_at = now()
    WHERE id = p_admin_profile_id;
  END IF;

  -- Never silently reassign an existing, differently-owned SACCO to a new admin.
  IF EXISTS (SELECT 1 FROM public.saccos WHERE UPPER(group_code) = v_clean_code) THEN
    SELECT id, admin_profile_id INTO v_sacco_id, v_existing_admin FROM public.saccos WHERE UPPER(group_code) = v_clean_code;

    IF v_existing_admin IS NOT NULL AND v_existing_admin <> p_admin_profile_id THEN
      RAISE EXCEPTION 'A SACCO with this group code already exists under different administration. Choose a different unique number.';
    END IF;

    UPDATE public.saccos
    SET
      name = CASE
        WHEN p_sacco_name IS NOT NULL AND p_sacco_name <> '' AND p_sacco_name NOT LIKE '% SACCO' AND p_sacco_name NOT LIKE '% Group' THEN p_sacco_name
        WHEN name IS NULL OR name = '' OR name LIKE '% Group' OR name LIKE '% SACCO' THEN p_sacco_name
        ELSE name
      END,
      admin_profile_id = p_admin_profile_id,
      status = 'active',
      updated_at = now()
    WHERE id = v_sacco_id;
  ELSE
    INSERT INTO public.saccos (name, acronym, group_code, admin_profile_id, status, current_week, is_historical_mode, is_locked, absenteeism_fine_amount)
    VALUES (p_sacco_name, UPPER(TRIM(p_acronym)), v_clean_code, p_admin_profile_id, 'active', 1, false, false, 1000.00)
    RETURNING id INTO v_sacco_id;
  END IF;

  INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
  VALUES (v_sacco_id, p_admin_profile_id, 'admin', 'active')
  ON CONFLICT (sacco_id, profile_id) DO UPDATE
    SET role = 'admin', status = 'active';

  INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance, status)
  VALUES
    (v_sacco_id, p_admin_profile_id, 'savings', 0.00, 'active'),
    (v_sacco_id, p_admin_profile_id, 'shares', 0.00, 'active'),
    (v_sacco_id, p_admin_profile_id, 'development_fund', 0.00, 'active'),
    (v_sacco_id, p_admin_profile_id, 'social_fund', 0.00, 'active'),
    (v_sacco_id, p_admin_profile_id, 'loan', 0.00, 'active')
  ON CONFLICT (sacco_id, profile_id, account_type) DO NOTHING;

  INSERT INTO public.sacco_settings (
    group_code, sacco_id, share_price, devt_fund, social_fund, current_week, meeting_day, absenteeism_fine_amount
  ) VALUES (
    v_clean_code, v_sacco_id, 25000.00, 1000.00, 2000.00, 1, v_meeting_day, 1000.00
  ) ON CONFLICT (group_code) DO NOTHING;

  RETURN json_build_object(
    'success', true,
    'sacco_id', v_sacco_id,
    'group_code', v_clean_code,
    'message', 'SACCO registered successfully and admin linked'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.register_new_sacco(TEXT, TEXT, TEXT, UUID) TO anon, authenticated, service_role;
-- Kept executable by anon: RegisterSacco.tsx may call this immediately after
-- auth.signUp() before an email-confirmation session exists. Safe regardless, since the
-- auth.uid() check above now rejects any call where no real session is attached.


-- 13f. approve_member_transaction / reject_member_transaction -- previously included an
-- unscoped "any admin, any SACCO" clause, letting an admin of one SACCO approve or
-- reject another SACCO's pending transactions. Removed; only the two already-correct
-- sacco-scoped checks remain.
CREATE OR REPLACE FUNCTION public.approve_member_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
DECLARE
  v_tx RECORD;
  v_account_id UUID;
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

CREATE OR REPLACE FUNCTION public.approve_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
BEGIN
  RETURN public.approve_member_transaction(p_transaction_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_member_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
DECLARE
  v_tx RECORD;
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
    RAISE EXCEPTION 'Unauthorized to reject this transaction';
  END IF;

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

CREATE OR REPLACE FUNCTION public.reject_transaction(
  p_transaction_id UUID
) RETURNS JSON AS $$
BEGIN
  RETURN public.reject_member_transaction(p_transaction_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.approve_member_transaction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_transaction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_member_transaction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_transaction(UUID) TO authenticated;


-- ====================================================================================
-- STEP 14: handle_new_user trigger -- the single most severe finding in the audit.
-- The prior live version read `role` directly from client-supplied signup metadata
-- (raw_user_meta_data), which is fully attacker-controlled via a raw auth.signUp() call
-- that bypasses the UI entirely. Combined with an ON CONFLICT (group_code) DO UPDATE
-- SET admin_profile_id = ..., anyone could self-declare role: 'admin' plus an existing
-- SACCO's group_id at signup and instantly hijack that SACCO's admin seat -- no RPC call
-- needed. This replacement hardcodes role to 'member' unconditionally and never touches
-- an existing SACCO's admin_profile_id. Verified SignUp.tsx and RegisterSacco.tsx
-- already do their own explicit client-side upserts / call register_new_sacco directly,
-- so nothing depends on this trigger performing admin/SACCO creation.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_sacco_id UUID;
  v_group_id TEXT;
  v_full_name TEXT;
  v_phone TEXT;
  v_member_number TEXT;
BEGIN
  v_group_id      := UPPER(TRIM(COALESCE(NEW.raw_user_meta_data->>'group_id', '')));
  v_full_name     := COALESCE(NEW.raw_user_meta_data->>'full_name', 'SACCO User');
  v_phone         := NEW.raw_user_meta_data->>'phone';
  v_member_number := COALESCE(NEW.raw_user_meta_data->>'member_number', 'MEM-' || substring(NEW.id::text, 1, 8));

  -- role is ALWAYS hardcoded 'member' here -- never read from raw_user_meta_data.
  -- Real elevation only ever happens via register_new_sacco (self-registration,
  -- auth.uid()-checked) or make_member_admin (existing-admin-only).
  BEGIN
    INSERT INTO public.profiles (id, full_name, email, phone, member_number, group_id, role, status)
    VALUES (NEW.id, v_full_name, NEW.email, v_phone, v_member_number, v_group_id, 'member', 'active')
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user profiles warning: %', SQLERRM;
  END;

  -- Benign self-service: joining an EXISTING sacco by code. role hardcoded 'member', so
  -- this branch can never grant elevated access or reassign an admin seat.
  IF v_group_id <> '' THEN
    BEGIN
      SELECT id INTO v_sacco_id FROM public.saccos WHERE UPPER(group_code) = v_group_id;
      IF v_sacco_id IS NOT NULL THEN
        INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
        VALUES (v_sacco_id, NEW.id, 'member', 'active')
        ON CONFLICT (sacco_id, profile_id) DO NOTHING;

        INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance, status)
        VALUES
          (v_sacco_id, NEW.id, 'savings', 0.00, 'active'),
          (v_sacco_id, NEW.id, 'shares', 0.00, 'active'),
          (v_sacco_id, NEW.id, 'development_fund', 0.00, 'active'),
          (v_sacco_id, NEW.id, 'social_fund', 0.00, 'active'),
          (v_sacco_id, NEW.id, 'loan', 0.00, 'active')
        ON CONFLICT (sacco_id, profile_id, account_type) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user membership warning: %', SQLERRM;
    END;
  END IF;

  -- REMOVED vs. the prior "role='admin' -> auto-create SACCO, ON CONFLICT DO UPDATE
  -- admin_profile_id" branch: that is exactly what let a raw signup HTTP call (bypassing
  -- the UI entirely) instantly hijack any existing SACCO by guessing its group_code.
  -- Admins now register their SACCO exclusively through the hardened register_new_sacco()
  -- function, which verifies auth.uid() = p_admin_profile_id and refuses to reassign an
  -- already-owned SACCO.

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ====================================================================================
-- End of migration.
-- ====================================================================================
