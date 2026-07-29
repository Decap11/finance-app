-- RPC 4: Register a new SACCO (hardened, self-healing & atomic)
CREATE OR REPLACE FUNCTION register_new_sacco(
  p_sacco_name TEXT,
  p_acronym TEXT,
  p_group_code TEXT,
  p_admin_profile_id UUID
) RETURNS JSON AS $func$
DECLARE
  v_sacco_id UUID;
BEGIN
  -- Bypass RLS inside this SECURITY DEFINER function
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

  -- Guard: group_code must be globally unique
  IF EXISTS (SELECT 1 FROM public.saccos WHERE group_code = p_group_code) THEN
    RAISE EXCEPTION 'A SACCO with this group code (%) already exists. Please choose a different unique number.', p_group_code;
  END IF;

  -- Insert the new SACCO
  INSERT INTO public.saccos (name, acronym, group_code, admin_profile_id, status)
  VALUES (p_sacco_name, p_acronym, p_group_code, p_admin_profile_id, 'active')
  RETURNING id INTO v_sacco_id;

  -- Insert admin membership
  INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
  VALUES (v_sacco_id, p_admin_profile_id, 'admin', 'active')
  ON CONFLICT (sacco_id, profile_id) DO UPDATE
    SET role = 'admin', status = 'active';

  -- Keep the admin's profile group_id in sync with the new SACCO group_code
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
    RAISE EXCEPTION 'A SACCO with this group code already exists. Please choose a different unique number.';
  WHEN OTHERS THEN
    RAISE;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

