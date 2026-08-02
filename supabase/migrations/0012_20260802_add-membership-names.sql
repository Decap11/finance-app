-- ====================================================================
-- MIGRATION: Add member_full_name and sacco_name to public.sacco_memberships
-- Extracts full_name from public.profiles and name from public.saccos
-- ====================================================================

-- Step 1: Add new columns if they do not exist
ALTER TABLE public.sacco_memberships 
ADD COLUMN IF NOT EXISTS member_full_name TEXT,
ADD COLUMN IF NOT EXISTS sacco_name TEXT;

-- Step 2: Backfill existing sacco_memberships records with profile full_name and sacco name
UPDATE public.sacco_memberships sm
SET 
  member_full_name = p.full_name,
  sacco_name = s.name
FROM public.profiles p, public.saccos s
WHERE sm.profile_id = p.id 
  AND sm.sacco_id = s.id
  AND (sm.member_full_name IS NULL OR sm.sacco_name IS NULL);

-- Step 3: Create Trigger Function to auto-populate member_full_name & sacco_name on INSERT or UPDATE
CREATE OR REPLACE FUNCTION public.sync_sacco_membership_names()
RETURNS TRIGGER AS $$
BEGIN
  -- Extract member full name from public.profiles if missing or profile_id changed
  IF NEW.member_full_name IS NULL OR (TG_OP = 'UPDATE' AND NEW.profile_id IS DISTINCT FROM OLD.profile_id) THEN
    SELECT full_name INTO NEW.member_full_name 
    FROM public.profiles 
    WHERE id = NEW.profile_id;
  END IF;

  -- Extract sacco name from public.saccos if missing or sacco_id changed
  IF NEW.sacco_name IS NULL OR (TG_OP = 'UPDATE' AND NEW.sacco_id IS DISTINCT FROM OLD.sacco_id) THEN
    SELECT name INTO NEW.sacco_name 
    FROM public.saccos 
    WHERE id = NEW.sacco_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind BEFORE INSERT OR UPDATE trigger on sacco_memberships
DROP TRIGGER IF EXISTS trg_sync_sacco_membership_names ON public.sacco_memberships;

CREATE TRIGGER trg_sync_sacco_membership_names
BEFORE INSERT OR UPDATE ON public.sacco_memberships
FOR EACH ROW
EXECUTE FUNCTION public.sync_sacco_membership_names();

-- Step 4: Auto-sync membership table when a profile full_name is updated
CREATE OR REPLACE FUNCTION public.sync_membership_on_profile_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    UPDATE public.sacco_memberships 
    SET member_full_name = NEW.full_name 
    WHERE profile_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_membership_on_profile_update ON public.profiles;

CREATE TRIGGER trg_sync_membership_on_profile_update
AFTER UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_membership_on_profile_update();

-- Step 5: Auto-sync membership table when a sacco name is updated
CREATE OR REPLACE FUNCTION public.sync_membership_on_sacco_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.sacco_memberships 
    SET sacco_name = NEW.name 
    WHERE sacco_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_membership_on_sacco_update ON public.saccos;

CREATE TRIGGER trg_sync_membership_on_sacco_update
AFTER UPDATE ON public.saccos
FOR EACH ROW
EXECUTE FUNCTION public.sync_membership_on_sacco_update();
