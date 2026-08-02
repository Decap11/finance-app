-- =============================================================
-- PATCH FILE — Run this IN YOUR SUPABASE SQL EDITOR
-- Fixes AuthRetryableFetchError 500 by making handle_new_user fail-safe
-- =============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_sacco_id UUID;
  v_group_id TEXT;
  v_role TEXT;
BEGIN
  v_group_id := NEW.raw_user_meta_data->>'group_id';
  v_role     := COALESCE(NEW.raw_user_meta_data->>'role', 'member');

  -- Fail-safe profile insertion
  BEGIN
    INSERT INTO public.profiles (id, full_name, email, phone, member_number, group_id, role, status)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
      NEW.email,
      NEW.raw_user_meta_data->>'phone',
      COALESCE(NEW.raw_user_meta_data->>'member_number', 'MEMBER-' || substring(NEW.id::text, 1, 8)),
      v_group_id,
      v_role,
      COALESCE(NEW.raw_user_meta_data->>'status', 'pending')
    )
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      group_id = EXCLUDED.group_id,
      role = EXCLUDED.role,
      status = EXCLUDED.status;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user trigger warning: %', SQLERRM;
  END;

  -- Fail-safe membership insertion for regular members
  IF v_role != 'admin' AND v_group_id IS NOT NULL AND v_group_id <> '' THEN
    BEGIN
      SELECT id INTO v_sacco_id FROM public.saccos WHERE group_code = UPPER(v_group_id);
      IF v_sacco_id IS NOT NULL THEN
        INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
        VALUES (v_sacco_id, NEW.id, 'member', 'pending')
        ON CONFLICT DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user membership warning: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Recreate trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Ensure RPC permissions are active
GRANT EXECUTE ON FUNCTION public.register_new_sacco(TEXT, TEXT, TEXT, UUID) TO anon, authenticated, service_role;
