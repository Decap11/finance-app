-- =============================================================================
-- ALL-IN-ONE SUPABASE DATABASE SETUP & AUTOMATED SACCO PROVISIONING TRIGGER
-- Copy and paste this ENTIRE script into your Supabase SQL Editor and click "RUN".
-- =============================================================================

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  member_number TEXT NOT NULL,
  group_id TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'loan_officer', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shares_target NUMERIC(15, 2) DEFAULT 50000.00,
  devt_target NUMERIC(15, 2) DEFAULT 10000.00,
  social_target NUMERIC(15, 2) DEFAULT 10000.00
);

-- Drop restrictive global unique constraint on member_number if it exists
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_member_number_key;

-- 2. SACCOs Table
CREATE TABLE IF NOT EXISTS public.saccos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  acronym TEXT NOT NULL,
  group_code TEXT UNIQUE NOT NULL,
  admin_profile_id UUID REFERENCES public.profiles(id),
  member_limit INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  current_week INTEGER DEFAULT 1,
  meeting_day TEXT DEFAULT 'Wednesday',
  share_price NUMERIC(15, 2) DEFAULT 25000.00,
  devt_fund NUMERIC(15, 2) DEFAULT 1000.00,
  social_fund NUMERIC(15, 2) DEFAULT 2000.00,
  is_locked BOOLEAN DEFAULT false,
  is_historical_mode BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. SACCO Memberships Table
CREATE TABLE IF NOT EXISTS public.sacco_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'loan_officer', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sacco_id, profile_id)
);

-- 4. Accounts Table
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sacco_id UUID NOT NULL REFERENCES public.saccos(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_type TEXT NOT NULL CHECK (account_type IN ('savings', 'shares', 'development_fund', 'social_fund', 'loan')),
  balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sacco_id, profile_id, account_type)
);

-- 5. SACCO Settings Table
CREATE TABLE IF NOT EXISTS public.sacco_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code TEXT UNIQUE NOT NULL,
  sacco_id UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  share_price NUMERIC(15, 2) DEFAULT 25000.00,
  devt_fund NUMERIC(15, 2) DEFAULT 1000.00,
  social_fund NUMERIC(15, 2) DEFAULT 2000.00,
  current_week INTEGER DEFAULT 1,
  meeting_day TEXT DEFAULT 'Wednesday',
  is_locked BOOLEAN DEFAULT false,
  is_historical_mode BOOLEAN DEFAULT false,
  onboarding_date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Disable RLS or set open access policies to guarantee writes
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.saccos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_memberships DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_settings DISABLE ROW LEVEL SECURITY;

-- 7. Grant full access permissions to anon, authenticated, and service_role
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- 8. AUTOMATED DATABASE TRIGGER: INSTANTLY CREATES PROFILES, SACCOS, MEMBERSHIPS, ACCOUNTS, & SETTINGS
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_sacco_id UUID;
  v_group_id TEXT;
  v_role TEXT;
  v_full_name TEXT;
  v_phone TEXT;
  v_member_number TEXT;
  v_sacco_name TEXT;
  v_acronym TEXT;
  v_meeting_day TEXT;
BEGIN
  v_group_id      := UPPER(TRIM(COALESCE(NEW.raw_user_meta_data->>'group_id', '')));
  v_role          := COALESCE(NEW.raw_user_meta_data->>'role', 'member');
  v_full_name     := COALESCE(NEW.raw_user_meta_data->>'full_name', 'SACCO User');
  v_phone         := NEW.raw_user_meta_data->>'phone';
  v_member_number := COALESCE(NEW.raw_user_meta_data->>'member_number', 'MEM-' || substring(NEW.id::text, 1, 8));
  v_meeting_day   := TRIM(TO_CHAR(now(), 'Day'));

  -- Prevent unique member number conflict across different SACCO groups
  IF EXISTS (SELECT 1 FROM public.profiles WHERE member_number = v_member_number AND id <> NEW.id) THEN
    v_member_number := v_member_number || '-' || substring(NEW.id::text, 1, 4);
  END IF;

  -- Step A: Insert Profile
  BEGIN
    INSERT INTO public.profiles (id, full_name, email, phone, member_number, group_id, role, status)
    VALUES (NEW.id, v_full_name, NEW.email, v_phone, v_member_number, v_group_id, v_role, 'active')
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      group_id = EXCLUDED.group_id,
      role = EXCLUDED.role,
      status = EXCLUDED.status;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user profiles warning: %', SQLERRM;
  END;

  -- Step B: If Admin registering a SACCO, auto-create the SACCO group, link membership, accounts, and settings
  IF v_role = 'admin' AND v_group_id <> '' THEN
    BEGIN
      v_acronym := COALESCE(split_part(v_group_id, '-', 1), 'SACCO');
      v_sacco_name := v_full_name || ' Group (' || v_group_id || ')';

      INSERT INTO public.saccos (name, acronym, group_code, admin_profile_id, status, current_week, meeting_day)
      VALUES (v_sacco_name, v_acronym, v_group_id, NEW.id, 'active', 1, v_meeting_day)
      ON CONFLICT (group_code) DO UPDATE SET admin_profile_id = EXCLUDED.admin_profile_id, status = 'active'
      RETURNING id INTO v_sacco_id;

      IF v_sacco_id IS NULL THEN
        SELECT id INTO v_sacco_id FROM public.saccos WHERE UPPER(group_code) = v_group_id;
      END IF;

      IF v_sacco_id IS NOT NULL THEN
        INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
        VALUES (v_sacco_id, NEW.id, 'admin', 'active')
        ON CONFLICT (sacco_id, profile_id) DO UPDATE SET role = 'admin', status = 'active';

        INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance, status)
        VALUES 
          (v_sacco_id, NEW.id, 'savings', 0.00, 'active'),
          (v_sacco_id, NEW.id, 'shares', 0.00, 'active'),
          (v_sacco_id, NEW.id, 'development_fund', 0.00, 'active'),
          (v_sacco_id, NEW.id, 'social_fund', 0.00, 'active'),
          (v_sacco_id, NEW.id, 'loan', 0.00, 'active')
        ON CONFLICT (sacco_id, profile_id, account_type) DO NOTHING;

        INSERT INTO public.sacco_settings (group_code, sacco_id, share_price, devt_fund, social_fund, current_week, meeting_day)
        VALUES (v_group_id, v_sacco_id, 25000.00, 1000.00, 2000.00, 1, v_meeting_day)
        ON CONFLICT (group_code) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user admin sacco creation warning: %', SQLERRM;
    END;

  -- Step C: If regular Member joining existing SACCO
  ELSIF v_role != 'admin' AND v_group_id <> '' THEN
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
      RAISE WARNING 'handle_new_user member sacco link warning: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 9. Atomic & Idempotent SACCO Registration RPC
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
  v_admin_mem_num := 'ADMIN-' || substring(p_admin_profile_id::text, 1, 8);

  -- Ensure profile exists
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

  -- Insert or fetch SACCO
  IF EXISTS (SELECT 1 FROM public.saccos WHERE UPPER(group_code) = v_clean_code) THEN
    SELECT id INTO v_sacco_id FROM public.saccos WHERE UPPER(group_code) = v_clean_code;
    UPDATE public.saccos
    SET admin_profile_id = p_admin_profile_id, status = 'active', updated_at = now()
    WHERE id = v_sacco_id;
  ELSE
    INSERT INTO public.saccos (name, acronym, group_code, admin_profile_id, status, current_week, meeting_day)
    VALUES (p_sacco_name, UPPER(TRIM(p_acronym)), v_clean_code, p_admin_profile_id, 'active', 1, v_meeting_day)
    RETURNING id INTO v_sacco_id;
  END IF;

  -- Link admin membership
  IF v_sacco_id IS NOT NULL THEN
    INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
    VALUES (v_sacco_id, p_admin_profile_id, 'admin', 'active')
    ON CONFLICT (sacco_id, profile_id) DO UPDATE
      SET role = 'admin', status = 'active';

    -- Accounts
    INSERT INTO public.accounts (sacco_id, profile_id, account_type, balance, status)
    VALUES 
      (v_sacco_id, p_admin_profile_id, 'savings', 0.00, 'active'),
      (v_sacco_id, p_admin_profile_id, 'shares', 0.00, 'active'),
      (v_sacco_id, p_admin_profile_id, 'development_fund', 0.00, 'active'),
      (v_sacco_id, p_admin_profile_id, 'social_fund', 0.00, 'active'),
      (v_sacco_id, p_admin_profile_id, 'loan', 0.00, 'active')
    ON CONFLICT (sacco_id, profile_id, account_type) DO NOTHING;

    -- Settings
    INSERT INTO public.sacco_settings (
      group_code, sacco_id, share_price, devt_fund, social_fund, current_week, meeting_day, is_locked, is_historical_mode, onboarding_date, created_at, updated_at
    ) VALUES (
      v_clean_code, v_sacco_id, 25000.00, 1000.00, 2000.00, 1, v_meeting_day, false, false, now(), now(), now()
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
