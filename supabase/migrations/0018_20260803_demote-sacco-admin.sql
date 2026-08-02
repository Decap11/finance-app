-- ====================================================================================
-- 0018: demote_sacco_admin
--
-- 0017 gave the Members tab a working "Make Admin" button but no way back: once a
-- member's role became 'admin' the card rendered a static "Sacco Admin" label. A
-- mis-click was permanent, and nothing short of direct database access could undo it.
--
-- This adds the inverse of make_member_admin. Demotion is a privilege *change* rather
-- than a privilege grant, so it is deliberately narrower than promotion:
--
--   * Only the SACCO owner -- saccos.admin_profile_id, the account that created the
--     SACCO -- may demote. Without this, an admin promoted five minutes ago could demote
--     the founder and take the group over. Promotion stays open to any admin, unchanged.
--   * Nobody may demote themselves. An owner who did would strand the SACCO with no one
--     able to demote anyone again.
--   * The last remaining admin cannot be demoted, whoever asks.
--
-- Owner fallback: saccos.admin_profile_id is nullable and is set to NULL by 0017's
-- delete_member_entirely, and SACCOs created before 0009 may never have had it set. When
-- it is NULL there is no owner to defer to, so any admin may demote -- otherwise those
-- groups could never demote anyone at all. The self and last-admin guards still apply.
--
-- Like everything in 0017 this is SECURITY DEFINER (0015 revoked UPDATE on profiles.role
-- from authenticated) and carries SET search_path = public. sacco_memberships has 0016's
-- trg_sacco_access_state trigger, so this is automatically inert for a suspended or
-- on-hold SACCO -- same as the other member-management RPCs.
--
-- Step 2 then rewrites set_member_approval and delete_member_entirely so the owner
-- cannot be locked out or deleted by another admin either -- see the note there for why
-- the demotion rule is meaningless without it.
--
-- Depends on 0017 for the admin_sacco_for_member helper.
-- ====================================================================================

CREATE OR REPLACE FUNCTION public.demote_sacco_admin(
  p_member_id UUID
) RETURNS JSON AS $$
DECLARE
  v_sacco_id    UUID;
  v_owner_id    UUID;
  v_is_admin    BOOLEAN;
  v_admin_count INTEGER;
BEGIN
  v_sacco_id := public.admin_sacco_for_member(p_member_id);

  IF v_sacco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized to demote this member or member is not in the same SACCO group';
  END IF;

  -- Checked before the owner rule so a self-demote reports the real reason rather than
  -- "only the main admin can do this", which would be confusing when the owner is the
  -- one asking.
  IF p_member_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot demote yourself';
  END IF;

  SELECT admin_profile_id INTO v_owner_id
  FROM public.saccos
  WHERE id = v_sacco_id;

  IF v_owner_id IS NOT NULL AND v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the main SACCO admin can change another admin''s role';
  END IF;

  -- No explicit "the owner cannot be demoted" branch is needed: when an owner exists the
  -- check above means the caller *is* the owner, so a request to demote the owner is a
  -- self-demote and was already rejected. When no owner exists there is nobody to protect.

  -- The two role columns can disagree -- a member matched by profiles.group_id alone has
  -- no sacco_memberships row at all -- so 'is this person an admin' is true if either
  -- says so. This mirrors how the Members tab reads `mem?.role || p.role`.
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_member_id AND role = 'admin'
  ) OR EXISTS (
    SELECT 1 FROM public.sacco_memberships
    WHERE profile_id = p_member_id AND sacco_id = v_sacco_id AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'This member is not an admin';
  END IF;

  -- Counted over profiles, matched to the SACCO the same two ways admin_sacco_for_member
  -- matches. Counting sacco_memberships alone would miss an admin who is attached by
  -- group_id only, and could wrongly report the SACCO as down to its last admin.
  SELECT count(*) INTO v_admin_count
  FROM public.profiles p
  WHERE p.role = 'admin'
    AND (
      EXISTS (
        SELECT 1 FROM public.sacco_memberships sm
        WHERE sm.sacco_id = v_sacco_id AND sm.profile_id = p.id
      )
      OR EXISTS (
        SELECT 1 FROM public.saccos s
        WHERE s.id = v_sacco_id
          AND lower(btrim(p.group_id)) = lower(btrim(s.group_code))
      )
    );

  IF v_admin_count <= 1 THEN
    RAISE EXCEPTION 'This SACCO would be left with no admin';
  END IF;

  -- Role only. Approval status is a separate axis and a demoted admin stays an active
  -- member -- revoking their access is what set_member_approval is for.
  UPDATE public.profiles
  SET role = 'member', updated_at = now()
  WHERE id = p_member_id;

  UPDATE public.sacco_memberships
  SET role = 'member'
  WHERE profile_id = p_member_id
    AND sacco_id = v_sacco_id;

  RETURN json_build_object(
    'success', true,
    'role', 'member',
    'message', 'Admin demoted to member'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ====================================================================================
-- STEP 2: protect the owner from the other two removal paths -- supersedes 0017
--
-- Restricting demotion to the owner is worthless on its own. A promoted admin who cannot
-- demote the founder could, under 0017, simply unapprove them (which since the
-- MembershipRevoked gate landed genuinely locks them out of the dashboard) or delete
-- their account entirely. Either one hands the group to whoever moved first.
--
-- Both functions below are 0017's, unchanged except for one added guard: the account in
-- saccos.admin_profile_id cannot be unapproved or deleted by anyone else. The owner can
-- still be removed by clearing or reassigning admin_profile_id first, which is a
-- deliberate act rather than a side effect of clicking a button on a member card.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.set_member_approval(
  p_member_id UUID,
  p_approve BOOLEAN
) RETURNS JSON AS $$
DECLARE
  v_sacco_id UUID;
  v_status   TEXT;
BEGIN
  v_sacco_id := public.admin_sacco_for_member(p_member_id);

  IF v_sacco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: you are not an admin of this member''s SACCO';
  END IF;

  -- An admin unapproving themselves would revoke their own dashboard access with no way
  -- back in short of another admin or direct database access.
  IF p_approve IS NOT TRUE AND p_member_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot revoke your own access';
  END IF;

  -- Added in 0018. Self-revocation is already blocked above, so this only ever fires for
  -- somebody other than the owner trying to lock the owner out.
  IF p_approve IS NOT TRUE AND EXISTS (
    SELECT 1 FROM public.saccos
    WHERE id = v_sacco_id AND admin_profile_id = p_member_id
  ) THEN
    RAISE EXCEPTION 'The main SACCO admin''s access cannot be revoked';
  END IF;

  v_status := CASE WHEN p_approve THEN 'active' ELSE 'pending' END;

  UPDATE public.profiles
  SET status = v_status, updated_at = now()
  WHERE id = p_member_id;

  UPDATE public.sacco_memberships
  SET status = v_status
  WHERE profile_id = p_member_id
    AND sacco_id = v_sacco_id;

  RETURN json_build_object(
    'success', true,
    'status', v_status,
    'message', CASE WHEN p_approve
                    THEN 'Member approved'
                    ELSE 'Member access revoked' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.delete_member_entirely(
  p_member_id UUID
) RETURNS JSON AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
  v_sacco_id := public.admin_sacco_for_member(p_member_id);

  IF v_sacco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized to delete this member or member is not in the same SACCO group';
  END IF;

  IF p_member_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot delete your own admin account';
  END IF;

  -- Added in 0018. Deleting the owner was the loudest way to take a SACCO over: it
  -- removes the auth account outright, and step 1's UPDATE ... SET admin_profile_id =
  -- NULL below then leaves the group with no owner, which lets any remaining admin
  -- demote the rest.
  IF EXISTS (
    SELECT 1 FROM public.saccos
    WHERE id = v_sacco_id AND admin_profile_id = p_member_id
  ) THEN
    RAISE EXCEPTION 'The main SACCO admin cannot be deleted. Transfer ownership first.';
  END IF;

  -- 1. Detach, do not delete, records that belong to OTHER members. These rows are
  --    other people's contribution and loan history that this member merely approved or
  --    logged; deleting them would leave those members with account balances that no
  --    longer reconcile against any ledger.
  UPDATE public.transactions
  SET approved_by = NULL
  WHERE approved_by = p_member_id AND profile_id <> p_member_id;

  UPDATE public.transactions
  SET requested_by = NULL
  WHERE requested_by = p_member_id AND profile_id <> p_member_id;

  UPDATE public.loans
  SET approved_by = NULL
  WHERE approved_by = p_member_id AND profile_id <> p_member_id;

  -- The audit trail outlives the actor by design: the events stay, the actor goes null.
  UPDATE public.audit_events
  SET actor_profile_id = NULL
  WHERE actor_profile_id = p_member_id;

  -- Still required: the guard above only covers the member's OWN SACCO. They may be
  -- admin_profile_id on some other SACCO row, which is a RESTRICT reference.
  UPDATE public.saccos
  SET admin_profile_id = NULL
  WHERE admin_profile_id = p_member_id;

  -- Dynamic so this file still applies to a database where 0013 has not run.
  IF to_regclass('public.dividend_cycles') IS NOT NULL THEN
    EXECUTE 'UPDATE public.dividend_cycles SET executed_by = NULL WHERE executed_by = $1'
      USING p_member_id;
  END IF;

  -- 2. Delete the member's own records, innermost foreign key first.
  DELETE FROM public.loan_repayments
  WHERE loan_id IN (SELECT id FROM public.loans WHERE profile_id = p_member_id)
     OR transaction_id IN (SELECT id FROM public.transactions WHERE profile_id = p_member_id);

  DELETE FROM public.transactions WHERE profile_id = p_member_id;
  DELETE FROM public.loans        WHERE profile_id = p_member_id;
  DELETE FROM public.accounts     WHERE profile_id = p_member_id;
  DELETE FROM public.sacco_memberships WHERE profile_id = p_member_id;

  -- 3. Revoke any live session before removing the account. auth.sessions and
  --    auth.refresh_tokens cascade from auth.users anyway, but doing it explicitly makes
  --    the intent legible and does not depend on the GoTrue schema version. This is what
  --    makes the member's next token refresh fail; the browser-side half of the eviction
  --    is the getUser() revalidation in ProtectedRoute, which closes the window in which
  --    their current unexpired access token would still be honoured.
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = $1::text' USING p_member_id;
  END IF;

  IF to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING p_member_id;
  END IF;

  -- 4. Cascades into public.profiles.
  DELETE FROM auth.users WHERE id = p_member_id;

  RETURN json_build_object('success', true, 'message', 'Member and all associated data deleted successfully');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ====================================================================================
-- STEP 3: grants
--
-- Postgres grants EXECUTE to PUBLIC on every new function, anon included. CREATE OR
-- REPLACE preserves the grants already on the two rewritten functions, but they are
-- restated so this file is correct against a database where 0017 never ran.
-- ====================================================================================
REVOKE EXECUTE ON FUNCTION public.demote_sacco_admin(UUID)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_member_approval(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_member_entirely(UUID)       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.demote_sacco_admin(UUID)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_approval(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_member_entirely(UUID)       TO authenticated;
