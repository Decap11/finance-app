-- =============================================================
-- PATCH FILE — Run this INSTEAD of the full supabase-schema.sql
-- This only updates the handle_new_user trigger function.
-- It will NOT try to recreate any tables.
-- =============================================================

-- Updated handle_new_user trigger: skips membership creation for admins
-- Admins get their membership via the register_new_sacco RPC (atomically, after the SACCO exists).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_sacco_id UUID;
  v_group_id TEXT;
  v_role TEXT;
BEGIN
  v_group_id := NEW.raw_user_meta_data->>'group_id';
  v_role     := COALESCE(NEW.raw_user_meta_data->>'role', 'member');

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
  );

  -- Only create a membership here for regular MEMBERS joining an existing SACCO.
  -- Admins registering a NEW SACCO are handled atomically by the register_new_sacco RPC,
  -- which runs AFTER this trigger. Creating an admin membership here would either fail
  -- (SACCO not yet created) or leave a duplicate/wrong-status row.
  IF v_role != 'admin' AND v_group_id IS NOT NULL AND v_group_id <> '' THEN
    SELECT id INTO v_sacco_id FROM public.saccos WHERE group_code = UPPER(v_group_id);
    IF v_sacco_id IS NOT NULL THEN
      INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
      VALUES (v_sacco_id, NEW.id, 'member', 'pending')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger (DROP IF EXISTS is safe — it won't error if it doesn't exist)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
