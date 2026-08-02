-- ====================================================================================
-- 0017: member management RPCs
--
-- The admin Members tab (adminDashboardPage.jsx, tab=members) renders Approve /
-- Unapprove / Make Admin / Delete on every member card. Three of those four posted to
-- /api/admin/member-status, a route that was never written -- the fetch hit Next's 404
-- HTML page and died parsing '<' as JSON, so nothing was ever persisted. This file adds
-- the missing approval RPC and rewrites the two existing member RPCs, which were
-- unhardened and carried real bugs:
--
--   set_member_approval      NEW. Backs Approve / Unapprove. Writes both profiles.status
--                            and sacco_memberships.status so the card's
--                            `mem?.status || p.status` read is consistent either way.
--                            Cannot be used to revoke your own access.
--
--   make_member_admin        Was updating sacco_memberships WHERE profile_id = target
--                            with no sacco_id predicate: promoting a member in one SACCO
--                            promoted them in every SACCO they belonged to. Now scoped
--                            to the caller's SACCO.
--
--   delete_member_entirely   Was running DELETE ... WHERE approved_by = target on
--                            transactions and loans, so deleting an admin destroyed
--                            every record that admin had ever approved -- other members'
--                            contribution history and loans, while their account
--                            balances stayed put. Now the member's own rows are deleted
--                            and everyone else's are merely detached (approver set to
--                            NULL). Also predates 0013: dividend_cycles.executed_by is a
--                            RESTRICT foreign key, so deleting an admin who had run a
--                            dividend payout failed outright. Same for
--                            saccos.admin_profile_id.
--
-- All three are SECURITY DEFINER (they write columns that 0015 deliberately revoked from
-- `authenticated`) and all three now carry SET search_path = public, the hardening 0015
-- applied everywhere else and these two missed.
--
-- Note: sacco_memberships, transactions and loans all carry 0016's
-- trg_sacco_access_state trigger, so every function here is automatically inert for a
-- suspended or on-hold SACCO. That is intended.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: shared authorization helper
--
-- Answers "is auth.uid() an admin of the SACCO this member belongs to, and if so which
-- SACCO is it" -- returns the sacco_id, or NULL when the caller has no such standing.
-- Resolving the id rather than returning a boolean is what lets the callers below scope
-- their writes to one SACCO.
--
-- Membership is matched two ways because the two are not always in sync: an explicit
-- sacco_memberships row, or profiles.group_id matching saccos.group_code. The group_code
-- comparison is case/whitespace-insensitive to match the ilike() the app queries with.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.admin_sacco_for_member(p_member_id UUID)
RETURNS UUID AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
  IF p_member_id IS NULL OR auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.id INTO v_sacco_id
  FROM public.sacco_memberships sm_caller
  JOIN public.saccos s ON s.id = sm_caller.sacco_id
  WHERE sm_caller.profile_id = auth.uid()
    AND sm_caller.role = 'admin'
    AND (
      EXISTS (
        SELECT 1 FROM public.sacco_memberships sm_target
        WHERE sm_target.sacco_id = s.id
          AND sm_target.profile_id = p_member_id
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p_target
        WHERE p_target.id = p_member_id
          AND lower(btrim(p_target.group_id)) = lower(btrim(s.group_code))
      )
    )
  LIMIT 1;

  RETURN v_sacco_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Not callable from the browser. The three RPCs below are SECURITY DEFINER, so they
-- invoke this as the function owner and do not need a client-facing grant.
REVOKE EXECUTE ON FUNCTION public.admin_sacco_for_member(UUID) FROM PUBLIC, anon, authenticated;


-- ====================================================================================
-- STEP 2: set_member_approval -- backs the Approve and Unapprove buttons
--
-- 'active'/'pending' are legal for both profiles.status and sacco_memberships.status
-- (0001), so one value can drive both writes.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.set_member_approval(
  p_member_id UUID,
  p_approve BOOLEAN
) RETURNS JSON AS $$
DECLARE
  v_sacco_id UUID;
  v_status TEXT;
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


-- ====================================================================================
-- STEP 3: make_member_admin -- supersedes 0002
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.make_member_admin(
  p_member_id UUID
) RETURNS JSON AS $$
DECLARE
  v_sacco_id UUID;
BEGIN
  v_sacco_id := public.admin_sacco_for_member(p_member_id);

  IF v_sacco_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized to promote this member or member is not in the same SACCO group';
  END IF;

  UPDATE public.profiles
  SET role = 'admin', status = 'active', updated_at = now()
  WHERE id = p_member_id;

  -- Scoped to this SACCO. The 0002 version omitted the sacco_id predicate.
  UPDATE public.sacco_memberships
  SET role = 'admin', status = 'active'
  WHERE profile_id = p_member_id
    AND sacco_id = v_sacco_id;

  RETURN json_build_object('success', true, 'message', 'Member successfully promoted to admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ====================================================================================
-- STEP 4: delete_member_entirely -- supersedes 0002
--
-- Order matters. Every foreign key into profiles is either ON DELETE CASCADE
-- (sacco_memberships, accounts via profile_id, savings_vaults, dividend_allocations,
-- loan_guarantors) or has no ON DELETE clause at all, which means RESTRICT: transactions
-- .requested_by/.approved_by, loans.approved_by, audit_events.actor_profile_id,
-- dividend_cycles.executed_by, saccos.admin_profile_id. Every RESTRICT reference has to
-- be cleared before the auth.users delete cascades into profiles.
-- ====================================================================================
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
-- STEP 5: grants
--
-- Postgres grants EXECUTE to PUBLIC on every new function, which includes anon. Revoke
-- first, then hand execution to authenticated only -- each function checks auth.uid()
-- internally and is useless without a session anyway, but anon should not reach them.
-- ====================================================================================
REVOKE EXECUTE ON FUNCTION public.set_member_approval(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.make_member_admin(UUID)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_member_entirely(UUID)       FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_member_approval(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.make_member_admin(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_member_entirely(UUID)       TO authenticated;
