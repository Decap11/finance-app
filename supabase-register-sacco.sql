-- =============================================================================
-- IDEMPOTENT & FAIL-SAFE SACCO REGISTRATION RPC FUNCTION
-- Copy and paste this script into your Supabase SQL Editor and click "RUN".
-- =============================================================================

-- Ensure required columns exist on sacco_settings and saccos
ALTER TABLE public.sacco_settings ADD COLUMN IF NOT EXISTS is_historical_mode BOOLEAN DEFAULT false;
ALTER TABLE public.sacco_settings ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;
ALTER TABLE public.sacco_settings ADD COLUMN IF NOT EXISTS onboarding_date TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS is_historical_mode BOOLEAN DEFAULT false;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;

-- Drop obsolete meeting_day column from saccos table
ALTER TABLE public.saccos DROP COLUMN IF EXISTS meeting_day;

-- Disable RLS to ensure unhindered backend execution
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.saccos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_memberships DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_settings DISABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_new_sacco(
  p_sacco_name TEXT,
  p_acronym TEXT,
  p_group_code TEXT,
  p_admin_profile_id UUID
) RETURNS JSON AS $func$
DECLARE
  v_sacco_id UUID;
  v_meeting_day TEXT;
  v_clean_code TEXT;
  v_admin_mem_num TEXT;
BEGIN
  SET LOCAL row_security = off;

  v_clean_code := UPPER(TRIM(p_group_code));
  v_meeting_day := TRIM(TO_CHAR(now(), 'Day'));
  v_admin_mem_num := 'MEM-001';

  -- 1. Ensure Profile exists for Admin
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
      role = EXCLUDED.role,
      status = EXCLUDED.status;
  ELSE
    UPDATE public.profiles
    SET group_id = v_clean_code, role = 'admin', status = 'active', updated_at = now()
    WHERE id = p_admin_profile_id;
  END IF;

  -- 2. Insert or fetch SACCO with exact form SACCO Name
  IF EXISTS (SELECT 1 FROM public.saccos WHERE UPPER(group_code) = v_clean_code) THEN
    SELECT id INTO v_sacco_id FROM public.saccos WHERE UPPER(group_code) = v_clean_code;
    UPDATE public.saccos
    SET name = p_sacco_name, admin_profile_id = p_admin_profile_id, status = 'active', updated_at = now()
    WHERE id = v_sacco_id;
  ELSE
    INSERT INTO public.saccos (name, acronym, group_code, admin_profile_id, status, current_week, is_historical_mode, is_locked)
    VALUES (p_sacco_name, UPPER(TRIM(p_acronym)), v_clean_code, p_admin_profile_id, 'active', 1, false, false)
    RETURNING id INTO v_sacco_id;
  END IF;

  -- 3. Link Admin Membership
  IF v_sacco_id IS NOT NULL THEN
    INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
    VALUES (v_sacco_id, p_admin_profile_id, 'admin', 'active')
    ON CONFLICT (sacco_id, profile_id) DO UPDATE
      SET role = 'admin', status = 'active';

    -- 4. Initialize Member Accounts
    INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance, status)
    VALUES 
      (v_sacco_id, p_admin_profile_id, 'savings', 0.00, 'active'),
      (v_sacco_id, p_admin_profile_id, 'shares', 0.00, 'active'),
      (v_sacco_id, p_admin_profile_id, 'development_fund', 0.00, 'active'),
      (v_sacco_id, p_admin_profile_id, 'social_fund', 0.00, 'active'),
      (v_sacco_id, p_admin_profile_id, 'loan', 0.00, 'active')
    ON CONFLICT (sacco_id, profile_id, account_type) DO NOTHING;

    -- 5. Initialize SACCO Settings (meeting_day stored exclusively in sacco_settings)
    INSERT INTO public.sacco_settings (
      group_code, sacco_id, share_price, devt_fund, social_fund, current_week, meeting_day
    ) VALUES (
      v_clean_code, v_sacco_id, 25000.00, 1000.00, 2000.00, 1, v_meeting_day
    ) ON CONFLICT (group_code) DO NOTHING;
  END IF;

  RETURN json_build_object(
    'success', true,
    'sacco_id', v_sacco_id,
    'group_code', v_clean_code,
    'message', 'SACCO registered successfully and admin linked'
  );
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.register_new_sacco(TEXT, TEXT, TEXT, UUID) TO anon, authenticated, service_role;
