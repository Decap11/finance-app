-- ====================================================================================
-- 0031: when a member actually joined the SACCO
--
-- WHY THIS FILE EXISTS
--
-- Development fund and social fund are owed every meeting week. Working out what a member
-- owes therefore needs one fact the database did not hold: the week they started owing it.
--
-- src/utils/duesEngine.js infers that from the member's own earliest record, and that
-- inference has a blind spot it cannot close on its own. It cannot tell
--
--     "joined in week 20"                          from
--     "was here since week 1 and paid nothing until week 20"
--
-- Both look identical -- no records before week 20. So the member who paid nothing for
-- nineteen weeks has those nineteen weeks quietly forgiven, and ends the cycle "current"
-- having paid far less than everyone else. The rule is most generous to exactly the members
-- the arrears feature exists to surface.
--
-- WHY NOT sacco_memberships.joined_at
--
-- That column already exists (0001) but it is `default now()` and nothing in this codebase
-- ever sets it. It records when the membership ROW was created, which for a SACCO that
-- backfilled a year of paper records is the day the admin typed everybody in. It is a system
-- fact and a useful one; overwriting it to mean something else would destroy the only record
-- of when the account was actually made.
--
-- So this file adds a separate, nullable column for the BUSINESS fact: joined_on.
--
-- WHY ON profiles RATHER THAN sacco_memberships
--
-- Not every member has a sacco_memberships row -- bulk-added members and pre-0009 groups
-- often do not, which is why admin_sacco_for_member (0017) has a profiles.group_id fallback
-- and the admin dashboard mirrors it. A join date that silently could not be stored for
-- those members would be worse than none. Every member has a profile, profiles already
-- carries the other SACCO-scoped facts (group_id, member_number, status), and group_id is a
-- single group code -- this schema has always assumed one SACCO per profile. So profiles is
-- both the reliable home and the consistent one.
--
-- NOTHING CHANGES WHEN THIS IS APPLIED
--
-- The column starts NULL for everybody and NULL means "not stated". The dues engine keeps
-- inferring from the first record exactly as before. The numbers only move when an admin
-- asserts a date, which is the point: the SACCO decides, rather than the software guessing
-- on its behalf.
--
--     joined_on  ->  first record  ->  SACCO Week 1
--      (fact)        (inference)      (last resort, flagged in the UI)
--
-- REQUIRES 0030. The bulk setter reads saccos.week_anchor_date to mean "Week 1", and that
-- column is added by 0030. Apply 0030 first or this file fails on an undefined column.
--
-- Safe to re-run.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: the column
-- ====================================================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS joined_on DATE;

COMMENT ON COLUMN public.profiles.joined_on IS
  'The date this member joined the SACCO in real life, as stated by an admin. NULL means not stated, and the dues engine falls back to inferring it from the member''s earliest record. Distinct from sacco_memberships.joined_at, which records when the membership row was created in this application.';


-- ====================================================================================
-- STEP 2: one member's join date
--
-- admin_sacco_for_member (0017) is reused rather than reimplemented: it already resolves
-- "am I an admin of this member's SACCO" through BOTH a membership row and the
-- profiles.group_id fallback, and returns NULL rather than raising when the answer is no.
-- Every other member-management RPC in this database is guarded by it.
--
-- p_joined_on NULL is meaningful and allowed: it clears the date and hands the member back
-- to the inference. That is the undo for a mistake, so it must not be rejected as missing.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.set_member_join_date(
  p_member_id UUID,
  p_joined_on DATE DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_sacco_id UUID;
  v_previous DATE;
  v_name     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_member_id IS NULL THEN
    RAISE EXCEPTION 'Which member? No member was named.';
  END IF;

  v_sacco_id := public.admin_sacco_for_member(p_member_id);

  IF v_sacco_id IS NULL THEN
    RAISE EXCEPTION 'Only an admin of this member''s SACCO may set their join date.';
  END IF;

  -- A member cannot have joined tomorrow. Everything downstream counts weeks forward from
  -- this date, so a future one produces a negative span that the engine would clamp to zero
  -- -- silently making the member owe nothing at all.
  IF p_joined_on IS NOT NULL AND p_joined_on > CURRENT_DATE THEN
    RAISE EXCEPTION 'A join date cannot be in the future.';
  END IF;

  SELECT p.joined_on, p.full_name INTO v_previous, v_name
  FROM public.profiles p WHERE p.id = p_member_id;

  UPDATE public.profiles SET joined_on = p_joined_on, updated_at = now()
  WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That member no longer exists.';
  END IF;

  -- What a member is told they owe rests on this date, so changing it leaves a trace.
  INSERT INTO public.audit_events (sacco_id, actor_profile_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_sacco_id, auth.uid(), 'profile', p_member_id, 'set_member_join_date',
    json_build_object('previous', v_previous, 'joined_on', p_joined_on)::JSONB
  );

  RETURN json_build_object(
    'success',    true,
    'member_id',  p_member_id,
    'full_name',  v_name,
    'previous',   v_previous,
    'joined_on',  p_joined_on
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.set_member_join_date(UUID, DATE) TO authenticated;


-- ====================================================================================
-- STEP 3: every member at once
--
-- This is the whole reason the feature is usable. No admin types thirty dates, so without a
-- bulk action the column would stay empty and the blind spot would stay open. For a SACCO
-- that runs as a cohort -- which the 52-week cycle model implies is the normal case -- one
-- click is the entire job.
--
-- Two deliberate defaults:
--
--   * p_joined_on NULL means "the SACCO's Week 1" -- the anchor from 0030, falling back to
--     the day the group registered when it has never finished historical onboarding.
--
--   * p_only_missing TRUE means an admin who has already corrected a late joiner does not
--     lose that correction by pressing the button again. The button is therefore idempotent
--     and safe to re-click, which is how it will in fact be used.
--
-- Admin only, not staff: this rewrites the basis of every member's arrears at once, which is
-- not a loan officer's call. Three ways to be an admin are accepted, because this codebase
-- has three -- a membership row, ownership of the SACCO, and the role on profiles. Groups
-- created before 0009 have no admin_profile_id, and bulk-added admins often have no
-- membership row; accepting only one of the three would lock somebody out of their own SACCO.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.set_all_member_join_dates(
  p_sacco_id     UUID DEFAULT NULL,
  p_joined_on    DATE DEFAULT NULL,
  p_only_missing BOOLEAN DEFAULT TRUE
) RETURNS JSON AS $$
DECLARE
  v_sacco_id   UUID;
  v_group_code TEXT;
  v_owner      UUID;
  v_anchor     DATE;
  v_created    DATE;
  v_date       DATE;
  v_count      INTEGER := 0;
  v_is_admin   BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Resolved here rather than through staff_sacco_for_caller (0030), whose refusal message
  -- names week settings -- accurate there, baffling to an admin who pressed a join-date
  -- button.
  v_sacco_id := p_sacco_id;

  IF v_sacco_id IS NULL THEN
    SELECT sm.sacco_id INTO v_sacco_id
    FROM public.sacco_memberships sm
    WHERE sm.profile_id = auth.uid() AND sm.role = 'admin' AND sm.status = 'active'
    LIMIT 1;
  END IF;

  IF v_sacco_id IS NULL THEN
    SELECT s.id INTO v_sacco_id
    FROM public.saccos s WHERE s.admin_profile_id = auth.uid() LIMIT 1;
  END IF;

  IF v_sacco_id IS NULL THEN
    RAISE EXCEPTION 'No SACCO is associated with this account';
  END IF;

  SELECT s.group_code, s.admin_profile_id, s.week_anchor_date, s.created_at::DATE
    INTO v_group_code, v_owner, v_anchor, v_created
  FROM public.saccos s WHERE s.id = v_sacco_id;

  IF v_group_code IS NULL THEN
    RAISE EXCEPTION 'Could not find that SACCO.';
  END IF;

  -- COALESCE on every branch, deliberately. admin_profile_id is NULL for pre-0009 groups and
  -- for one whose owner was deleted, and `NULL = auth.uid()` is NULL, not FALSE -- so a bare
  -- OR here would make the whole condition NULL, IF NOT NULL would not fire, and the check
  -- would wave through exactly the callers it exists to stop.
  v_is_admin := COALESCE(public.is_sacco_admin(v_sacco_id), FALSE)
             OR COALESCE(v_owner = auth.uid(), FALSE)
             OR COALESCE((
                  SELECT p.role = 'admin'
                     AND lower(btrim(p.group_id)) = lower(btrim(v_group_code))
                  FROM public.profiles p WHERE p.id = auth.uid()
                ), FALSE);

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only a SACCO admin may set the join date for every member.';
  END IF;

  -- sacco_settings is read first everywhere else, so prefer its anchor when the copy on
  -- saccos has not been written.
  IF v_anchor IS NULL THEN
    SELECT ss.week_anchor_date INTO v_anchor
    FROM public.sacco_settings ss
    WHERE ss.sacco_id = v_sacco_id
       OR lower(btrim(ss.group_code)) = lower(btrim(v_group_code))
    LIMIT 1;
  END IF;

  v_date := COALESCE(p_joined_on, v_anchor, v_created, CURRENT_DATE);

  IF v_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'A join date cannot be in the future.';
  END IF;

  -- Members are found the same way the admin dashboard finds them -- by group code on
  -- profiles -- so that a member without a sacco_memberships row is included rather than
  -- being the one person the button silently skips.
  UPDATE public.profiles p
  SET joined_on = v_date, updated_at = now()
  WHERE lower(btrim(p.group_id)) = lower(btrim(v_group_code))
    AND (NOT p_only_missing OR p.joined_on IS NULL);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_events (sacco_id, actor_profile_id, entity_type, entity_id, action, metadata)
  VALUES (
    v_sacco_id, auth.uid(), 'sacco', v_sacco_id, 'set_all_member_join_dates',
    json_build_object(
      'joined_on',     v_date,
      'only_missing',  p_only_missing,
      'members_set',   v_count,
      'from_anchor',   p_joined_on IS NULL
    )::JSONB
  );

  RETURN json_build_object(
    'success',      true,
    'joined_on',    v_date,
    'members_set',  v_count,
    'only_missing', p_only_missing,
    'source',       CASE
                      WHEN p_joined_on IS NOT NULL THEN 'given'
                      WHEN v_anchor    IS NOT NULL THEN 'week_anchor'
                      ELSE 'sacco_created'
                    END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.set_all_member_join_dates(UUID, DATE, BOOLEAN) TO authenticated;


-- ====================================================================================
-- STEP 4: verification
--
-- Against a real SACCO, signed in as its admin:
--
--   -- nothing set yet, so every member still falls back to the inference
--   SELECT full_name, joined_on FROM public.profiles
--   WHERE lower(group_id) = lower('<group code>') ORDER BY full_name;
--
--   -- one click: fills only the blanks, reports how many
--   SELECT public.set_all_member_join_dates();
--
--   -- correct a genuine late joiner
--   SELECT public.set_member_join_date('<member uuid>', DATE '2026-05-06');
--
--   -- and hand one back to the inference
--   SELECT public.set_member_join_date('<member uuid>', NULL);
--
-- Re-running set_all_member_join_dates() after the correction must report members_set = 0
-- and leave the corrected date alone. That is the property that makes the button safe.
-- ====================================================================================
