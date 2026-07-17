-- RPC 4: Register a new SACCO
CREATE OR REPLACE FUNCTION register_new_sacco(
  p_sacco_name TEXT,
  p_acronym TEXT,
  p_group_code TEXT,
  p_admin_profile_id UUID
) RETURNS JSON AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
  -- Insert into saccos
  INSERT INTO public.saccos (name, acronym, group_code, admin_profile_id, status)
  VALUES (p_sacco_name, p_acronym, p_group_code, p_admin_profile_id, 'active')
  RETURNING id INTO v_sacco_id;

  -- Insert admin into sacco_memberships
  INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
  VALUES (v_sacco_id, p_admin_profile_id, 'admin', 'active');

  RETURN json_build_object('success', true, 'sacco_id', v_sacco_id, 'message', 'SACCO registered successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
