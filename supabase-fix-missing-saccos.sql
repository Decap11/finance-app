-- =============================================================================
-- FIX & SELF-HEAL SCRIPT FOR MISSING SACCOS (Run in Supabase SQL Editor)
-- Creates missing rows in `saccos`, `sacco_memberships`, and `sacco_settings` 
-- for any onboarded SACCO Admins whose SACCO group row is missing.
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  v_sacco_id UUID;
  v_acronym TEXT;
  v_sacco_name TEXT;
  v_meeting_day TEXT;
BEGIN
  v_meeting_day := TRIM(TO_CHAR(now(), 'Day'));

  -- Loop through all admin profiles whose group_id is missing from public.saccos
  FOR r IN 
    SELECT p.id, p.full_name, p.email, p.group_id, p.phone, p.member_number
    FROM public.profiles p
    WHERE p.role = 'admin' 
      AND p.group_id IS NOT NULL 
      AND p.group_id <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.saccos s WHERE UPPER(s.group_code) = UPPER(p.group_id)
      )
  LOOP
    -- Derive acronym and name from group_id or full_name
    v_acronym := COALESCE(split_part(r.group_id, '-', 1), 'SACCO');
    v_sacco_name := COALESCE(NULLIF(TRIM(r.full_name), ''), 'SACCO Admin') || ' Group (' || r.group_id || ')';

    -- 1. Insert missing SACCO row
    INSERT INTO public.saccos (name, acronym, group_code, admin_profile_id, status, current_week, meeting_day)
    VALUES (v_sacco_name, v_acronym, UPPER(r.group_id), r.id, 'active', 1, v_meeting_day)
    ON CONFLICT (group_code) DO UPDATE
      SET admin_profile_id = EXCLUDED.admin_profile_id, status = 'active'
    RETURNING id INTO v_sacco_id;

    IF v_sacco_id IS NULL THEN
      SELECT id INTO v_sacco_id FROM public.saccos WHERE UPPER(group_code) = UPPER(r.group_id);
    END IF;

    -- 2. Insert admin membership
    IF v_sacco_id IS NOT NULL THEN
      INSERT INTO public.sacco_memberships (sacco_id, profile_id, role, status)
      VALUES (v_sacco_id, r.id, 'admin', 'active')
      ON CONFLICT (sacco_id, profile_id) DO UPDATE
        SET role = 'admin', status = 'active';

      -- 3. Auto-seed sacco_settings
      INSERT INTO public.sacco_settings (
        group_code,
        sacco_id,
        share_price,
        devt_fund,
        social_fund,
        current_week,
        meeting_day,
        is_locked,
        is_historical_mode,
        onboarding_date,
        created_at,
        updated_at
      )
      VALUES (
        UPPER(r.group_id),
        v_sacco_id,
        25000.00,
        1000.00,
        2000.00,
        1,
        v_meeting_day,
        false,
        false,
        now(),
        now(),
        now()
      )
      ON CONFLICT (group_code) DO NOTHING;
    END IF;

    RAISE NOTICE 'Self-healed missing SACCO group: % for Admin: %', r.group_id, r.email;
  END LOOP;
END $$;
