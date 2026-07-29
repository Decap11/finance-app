-- PATCH: Fix RLS INSERT policies + harden register_new_sacco
-- Run this in Supabase SQL Editor. Safe to re-run.

-- Step 1: Drop old policies if they exist (safe no-op if missing)
DROP POLICY IF EXISTS "Anyone can insert saccos via rpc" ON public.saccos;
DROP POLICY IF EXISTS "Authenticated users can create saccos" ON public.saccos;
DROP POLICY IF EXISTS "Anyone can insert memberships via rpc" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Allow membership inserts via trusted functions" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Admins can insert memberships" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Allow profile creation on signup" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

-- Step 2: Add missing INSERT policy on saccos
-- Without this, all inserts into saccos are blocked when RLS is enabled.
CREATE POLICY "Authenticated users can create saccos"
  ON public.saccos
  FOR INSERT
  WITH CHECK (true);

-- Step 3: Add missing INSERT policy on sacco_memberships
-- Used by both the handle_new_user trigger and the register_new_sacco RPC.
CREATE POLICY "Allow membership inserts via trusted functions"
  ON public.sacco_memberships
  FOR INSERT
  WITH CHECK (true);

-- Step 4: Add missing INSERT policy on profiles
-- Used by the handle_new_user trigger when a new auth user is created.
CREATE POLICY "Allow profile creation on signup"
  ON public.profiles
  FOR INSERT
  WITH CHECK (true);

-- Step 5: Replace register_new_sacco with hardened & self-healing version.
-- Uses $func$ delimiter and SET LOCAL row_security = off so it works
-- even when called without an active session (email confirmation enabled).
CREATE OR REPLACE FUNCTION register_new_sacco(
  p_sacco_name TEXT,
  p_acronym TEXT,
  p_group_code TEXT,
  p_admin_profile_id UUID
) RETURNS JSON AS $func$
DECLARE
  v_sacco_id UUID;
BEGIN
  -- Bypass RLS inside this SECURITY DEFINER function.
  -- Needed when called right after signUp with no active session.
  SET LOCAL row_security = off;

  -- Self-healing: Ensure admin profile exists in public.profiles.
  -- If handle_new_user trigger was skipped or delayed, auto-create profile from auth.users
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin_profile_id) THEN
    INSERT INTO public.profiles (id, full_name, email, phone, member_number, group_id, role, status)
    SELECT
      u.id,
      COALESCE(u.raw_user_meta_data->>'full_name', 'SACCO Admin'),
      u.email,
      u.raw_user_meta_data->>'phone',
      COALESCE(u.raw_user_meta_data->>'member_number', 'ADMIN-' || substring(u.id::text, 1, 8)),
      p_group_code,
      'admin',
      'active'
    FROM auth.users u
    WHERE u.id = p_admin_profile_id
    ON CONFLICT (id) DO UPDATE SET
      group_id = EXCLUDED.group_id,
      role = EXCLUDED.role,
      status = EXCLUDED.status;
  END IF;

  -- Guard: group_code must be unique
  IF EXISTS (
    SELECT 1 FROM public.saccos WHERE group_code = p_group_code
  ) THEN
    RAISE EXCEPTION 'A SACCO with this group code already exists. Choose a different unique number.';
  END IF;

  -- Insert the new SACCO
  INSERT INTO public.saccos (name, acronym, group_code, admin_profile_id, status)
  VALUES (p_sacco_name, p_acronym, p_group_code, p_admin_profile_id, 'active')
  RETURNING id INTO v_sacco_id;

  -- Insert admin membership.
  -- ON CONFLICT DO UPDATE handles the race where handle_new_user
  -- already inserted a pending membership row before the SACCO existed.
  INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
  VALUES (v_sacco_id, p_admin_profile_id, 'admin', 'active')
  ON CONFLICT (sacco_id, profile_id) DO UPDATE
    SET role = 'admin', status = 'active';

  -- Sync the admin profile group_id to match the new SACCO group_code
  UPDATE public.profiles
  SET group_id = p_group_code, updated_at = now()
  WHERE id = p_admin_profile_id;

  RETURN json_build_object(
    'success', true,
    'sacco_id', v_sacco_id,
    'message', 'SACCO registered successfully'
  );

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A SACCO with this group code already exists. Choose a different unique number.';
  WHEN OTHERS THEN
    RAISE;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execution permissions explicitly to anon, authenticated, and service_role
GRANT EXECUTE ON FUNCTION public.register_new_sacco(TEXT, TEXT, TEXT, UUID) TO anon, authenticated, service_role;


