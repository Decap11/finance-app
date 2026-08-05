-- ====================================================================================
-- MIGRATION 0035: Stop handing every member's name, phone and email to the public
-- ====================================================================================
--
-- Symptom, measured against the live project rather than inferred: a caller holding
-- nothing but the publishable anon key -- which ships inside the client JavaScript
-- bundle and is readable by anyone who opens DevTools -- could read
--
--     profiles           27 of 27 rows   full_name, phone, email, member_number, role
--     sacco_memberships  27 of 27 rows
--     saccos              8 of  8 rows   group_code, admin_profile_id, every fee and fine
--     sacco_settings      8 of  8 rows
--
-- and could PATCH saccos and sacco_settings. transactions, accounts and loans were
-- already correctly scoped and returned nothing, so the money was never exposed -- the
-- people were.
--
-- Cause: 0015 hardened these tables but kept SELECT deliberately open, reasoning at its
-- line 70 that "members need to see each other's names/member numbers within the app".
-- That intent is right; the implementation omitted a TO clause, and a policy with no TO
-- applies to every role -- including anon. "Members can see each other" was written as
-- "everyone on the internet can see the members". The same omission on
-- sacco_settings_write_admin_only is why an anonymous PATCH was accepted.
--
-- Why the policies are dropped by catalogue lookup rather than by name: the live policy
-- set no longer matches this directory. 0019 replaced the sacco_memberships SELECT policy
-- with a correctly scoped `profile_id = auth.uid() OR is_sacco_staff(sacco_id)`, yet an
-- anonymous caller still reads all 27 rows -- so something is present in the database
-- that no file here creates, most likely hand-run SQL or a dashboard edit. Naming every
-- policy to drop assumes we know what exists. We do not. STEP 2 therefore removes every
-- policy on these four tables and rebuilds the set from scratch, which is correct whatever
-- the starting state happens to be.
--
-- What does NOT change: members still see each other's full contact details inside their
-- own SACCO, exactly as Search.jsx has always rendered them. This migration changes who
-- counts as "inside", not what they can see.
--
-- Depends on 0015 (column-level UPDATE grants on profiles) and 0019 (is_sacco_admin /
-- is_sacco_staff). Run 0034 first if it has not already been applied.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: RLS on, unconditionally.
--
-- 0009 disabled RLS outright on all four of these tables and 0015 turned it back on.
-- Asserting it again costs nothing and removes the question.
-- ====================================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saccos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_settings ENABLE ROW LEVEL SECURITY;


-- ====================================================================================
-- STEP 2: Clear the board.
--
-- Permissive policies are OR-ed together, so one forgotten USING (true) defeats every
-- careful policy beside it. That is exactly how this bug survived 0015 and 0019.
-- ====================================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles', 'saccos', 'sacco_memberships', 'sacco_settings')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;


-- ====================================================================================
-- STEP 3: "Which SACCO am I in?" -- answered without recursion.
--
-- A policy's subquery runs as the caller, so a policy on profiles that reads profiles
-- re-triggers itself; 0019 exists because 0015 hit precisely that. SECURITY DEFINER
-- functions run as the owner and bypass RLS, which breaks the cycle. STABLE so the
-- planner evaluates them once per query rather than once per row.
--
-- Two notions of belonging, because the app has two and they disagree. 0018 records it:
-- "a member matched by profiles.group_id alone has no sacco_memberships row at all".
-- Testing only memberships would lock those members out of their own group.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.my_group_code()
RETURNS TEXT AS $$
  SELECT lower(trim(p.group_id)) FROM public.profiles p WHERE p.id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.my_group_code() IS
  'The caller''s own group code, normalised. SECURITY DEFINER so RLS policies on profiles can call it without recursing.';

-- Is this SACCO one of mine? Membership row, or group code on my profile.
CREATE OR REPLACE FUNCTION public.is_my_sacco(p_sacco_id UUID)
RETURNS BOOLEAN AS $$
  SELECT p_sacco_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.sacco_memberships sm
      WHERE sm.sacco_id = p_sacco_id AND sm.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.saccos s
      WHERE s.id = p_sacco_id
        AND public.my_group_code() IS NOT NULL
        AND lower(trim(s.group_code)) = public.my_group_code()
    )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.is_my_sacco(UUID) IS
  'True when the caller belongs to this SACCO, by membership row or by profiles.group_id matching saccos.group_code.';

-- Do this profile and I share a SACCO? Used by the profiles SELECT policy.
CREATE OR REPLACE FUNCTION public.shares_sacco_with(p_profile_id UUID)
RETURNS BOOLEAN AS $$
  SELECT
    p_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles them
      WHERE them.id = p_profile_id
        AND public.my_group_code() IS NOT NULL
        AND lower(trim(them.group_id)) = public.my_group_code()
    )
    OR EXISTS (
      SELECT 1
      FROM public.sacco_memberships mine
      JOIN public.sacco_memberships theirs ON theirs.sacco_id = mine.sacco_id
      WHERE mine.profile_id = auth.uid() AND theirs.profile_id = p_profile_id
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.shares_sacco_with(UUID) IS
  'True when the caller and the given profile belong to the same SACCO. Always true for the caller''s own row.';

-- Who may write? 0019's is_sacco_admin asks only whether a sacco_memberships row with
-- role = 'admin' exists. That is the common case but not the only one: the API's own
-- resolveAdministeredSacco treats saccos.admin_profile_id as conferring the same authority,
-- because a SACCO whose membership rows never materialised still has a founder. Writing the
-- policies against membership alone would lock such a founder out of their own settings --
-- and today they can write, because the live policy permits anyone at all, so this would
-- read as a regression caused by the fix.
CREATE OR REPLACE FUNCTION public.is_sacco_admin_or_founder(p_sacco_id UUID)
RETURNS BOOLEAN AS $$
  SELECT p_sacco_id IS NOT NULL AND (
    public.is_sacco_admin(p_sacco_id)
    OR EXISTS (
      SELECT 1 FROM public.saccos s
      WHERE s.id = p_sacco_id AND s.admin_profile_id = auth.uid()
    )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.is_sacco_admin_or_founder(UUID) IS
  'True for an admin membership row in this SACCO, or for the founder named in saccos.admin_profile_id.';

GRANT EXECUTE ON FUNCTION public.my_group_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_sacco(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_sacco_with(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sacco_admin_or_founder(UUID) TO authenticated;


-- ====================================================================================
-- STEP 4: profiles
--
-- TO authenticated is the whole fix. The predicate is broader than "your own row"
-- on purpose -- Search.jsx lets a member find co-members by name, member number, phone
-- or email, and that is intended behaviour for a savings group whose members meet weekly.
-- ====================================================================================
CREATE POLICY "profiles_select_same_sacco" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.shares_sacco_with(id));

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Re-asserted from 0015: auth.uid() = id alone would still let a member rewrite their own
-- role, status or group_id and self-promote to admin. Column privileges close that without
-- touching SECURITY DEFINER functions, which run as the owner and ignore these grants.
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name, phone, email, avatar_url, shares_target, devt_target, social_target, updated_at)
  ON public.profiles TO authenticated;
-- role, status, group_id, member_number, id, created_at are deliberately NOT grantable.


-- ====================================================================================
-- STEP 5: saccos
--
-- No INSERT policy: SACCO creation goes through register_new_sacco(), which is
-- SECURITY DEFINER and bypasses RLS by design.
-- ====================================================================================
CREATE POLICY "saccos_select_own" ON public.saccos
  FOR SELECT TO authenticated
  USING (public.is_my_sacco(id));

CREATE POLICY "saccos_update_admin_only" ON public.saccos
  FOR UPDATE TO authenticated
  USING (public.is_sacco_admin_or_founder(id))
  WITH CHECK (public.is_sacco_admin_or_founder(id));


-- ====================================================================================
-- STEP 6: sacco_settings
--
-- WITH CHECK is spelled out rather than left to default to USING, so an admin cannot
-- move a settings row onto a SACCO they do not administer.
-- ====================================================================================
CREATE POLICY "sacco_settings_select_own" ON public.sacco_settings
  FOR SELECT TO authenticated
  USING (public.is_my_sacco(sacco_id));

CREATE POLICY "sacco_settings_write_admin_only" ON public.sacco_settings
  FOR ALL TO authenticated
  USING (public.is_sacco_admin_or_founder(sacco_id))
  WITH CHECK (public.is_sacco_admin_or_founder(sacco_id));


-- ====================================================================================
-- STEP 7: sacco_memberships
--
-- Wider than 0019's "own row or staff": a member may see the membership rows of their own
-- SACCO, matching the decision that members can see each other. The table carries
-- member_full_name and sacco_name, so restricting it to staff would blank out member-facing
-- lists that read it directly.
-- ====================================================================================
CREATE POLICY "sacco_memberships_select_same_sacco" ON public.sacco_memberships
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_my_sacco(sacco_id));

CREATE POLICY "sacco_memberships_insert_self_or_admin" ON public.sacco_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    (profile_id = auth.uid() AND role = 'member')
    OR public.is_sacco_admin_or_founder(sacco_id)
  );

CREATE POLICY "sacco_memberships_update_admin_only" ON public.sacco_memberships
  FOR UPDATE TO authenticated
  USING (public.is_sacco_admin_or_founder(sacco_id))
  WITH CHECK (public.is_sacco_admin_or_founder(sacco_id));


-- ====================================================================================
-- STEP 8: The signup lookup, which is the one thing that legitimately needs anon.
--
-- SignUp.tsx reads saccos before the account exists -- signUp() does not run until after
-- the group has been identified -- so closing anonymous SELECT breaks joining a SACCO
-- unless that lookup moves somewhere it can be controlled. Here it is a function: the
-- caller gets id, group_code and name for a single match, and never the share price,
-- fee schedule, fine amounts or admin_profile_id that reading the table exposed.
--
-- The matching order reproduces what SignUp.tsx already did, so whether a signup joins an
-- existing SACCO or auto-creates a new one is unchanged. The fuzzy name fallback is kept
-- for that reason, but it now returns one row of three columns instead of allowing the
-- whole table to be walked.
--
-- Every column reference is qualified with the alias. RETURNS TABLE declares id,
-- group_code and name as OUT parameters, and an unqualified mention of any of them inside
-- the body is ambiguous against the saccos columns of the same name -- which aborts at
-- runtime, not at creation time.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.lookup_sacco_for_signup(
  p_group_code TEXT,
  p_unique_number TEXT DEFAULT NULL,
  p_name TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, group_code TEXT, name TEXT) AS $$
DECLARE
  v_code TEXT := nullif(trim(coalesce(p_group_code, '')), '');
  v_num  TEXT := nullif(trim(coalesce(p_unique_number, '')), '');
  v_name TEXT := nullif(trim(coalesce(p_name, '')), '');
BEGIN
  IF v_code IS NULL AND v_num IS NULL AND v_name IS NULL THEN
    RETURN;
  END IF;

  -- 1. By group code: the code as given, or a suffix match on the unique number alone.
  RETURN QUERY
  SELECT s.id, s.group_code, s.name
  FROM public.saccos s
  WHERE (v_code IS NOT NULL AND lower(trim(s.group_code)) = lower(v_code))
     OR (v_num IS NOT NULL AND lower(trim(s.group_code)) = lower(v_num))
     OR (v_num IS NOT NULL AND lower(trim(s.group_code)) LIKE '%-' || lower(v_num))
  -- A name the applicant also typed breaks ties, mirroring exactNameMatch in SignUp.tsx.
  ORDER BY (v_name IS NOT NULL AND lower(s.name) LIKE '%' || lower(v_name) || '%') DESC,
           s.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- 2. Nothing matched the code, so fall back to the SACCO's name.
  RETURN QUERY
  SELECT s.id, s.group_code, s.name
  FROM public.saccos s
  WHERE v_name IS NOT NULL
    AND lower(s.name) LIKE '%' || lower(v_name) || '%'
  ORDER BY s.created_at ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.lookup_sacco_for_signup(TEXT, TEXT, TEXT) IS
  'Identifies the SACCO a signup is joining, before the account exists. Returns id, group_code and name only -- never the financial settings that reading public.saccos used to expose.';

GRANT EXECUTE ON FUNCTION public.lookup_sacco_for_signup(TEXT, TEXT, TEXT) TO anon, authenticated;


-- ====================================================================================
-- STEP 9: Take the table privileges away from anon outright.
--
-- Belt and braces. Policies decide which rows a role may touch; grants decide whether it
-- may address the table at all. profiles survived the anonymous PATCH test only because
-- its UPDATE grant had been revoked in 0015 -- its policy would have allowed the write.
-- Relying on one of the two when both are available is how the next gap opens.
--
-- service_role is untouched: it carries BYPASSRLS, which is what the API routes depend on.
-- ====================================================================================
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.saccos FROM anon;
REVOKE ALL ON public.sacco_memberships FROM anon;
REVOKE ALL ON public.sacco_settings FROM anon;


SELECT public.record_migration(
  '0035',
  'Closes anonymous read and write access to profiles, saccos, sacco_memberships and '
  'sacco_settings, which exposed every member''s name, phone and email to anyone holding '
  'the publishable anon key. Rebuilds all four policy sets scoped TO authenticated and to '
  'the caller''s own SACCO, and moves the pre-signup SACCO lookup into '
  'lookup_sacco_for_signup() so joining a group still works without the table being public.'
);


-- ====================================================================================
-- Verify, after running. Expect four tables, every policy naming a role, none of them anon:
--
--   SELECT tablename, policyname, roles, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('profiles','saccos','sacco_memberships','sacco_settings')
--   ORDER BY tablename, cmd;
--
-- Then re-run the black-box check from the audit: with the anon key alone, all four
-- tables must return zero rows.
-- ====================================================================================
