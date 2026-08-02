-- ====================================================================================
-- MIGRATION 0019: Break the sacco_memberships policy recursion, and let a member
--                 actually file their own contribution request
-- ====================================================================================
--
-- Symptom: a member submitting a weekly contribution gets
--
--     infinite recursion detected in policy for relation "sacco_memberships"
--
-- Cause: 0015's three sacco_memberships policies each answer "is the caller staff here?"
-- with a subquery against sacco_memberships itself. A policy's subquery runs as the
-- caller, so reading sacco_memberships re-triggers the same SELECT policy, which reads
-- sacco_memberships again. Postgres detects the cycle and aborts.
--
-- Nothing is special about the contribution path -- it is simply the first thing a member
-- does that touches a policy which consults sacco_memberships. The same error is reachable
-- from every "own or staff" policy 0015 wrote (accounts, dividend_*, audit_events,
-- loan_repayments, loan_guarantors, sacco_settings, saccos), because each of those has a
-- subquery on sacco_memberships that drags in the recursive SELECT policy.
--
-- Fix: answer the role question in a SECURITY DEFINER function instead. It runs as the
-- function owner, which is not subject to RLS, so the lookup terminates. Once the
-- sacco_memberships policies stop consulting themselves, every other policy that reads
-- the table works again unchanged.
--
-- This file also fixes two things that would each be the *next* error on that same
-- contribution submit -- see STEP 3 and STEP 4.
--
-- Safe to re-run: every DROP is IF EXISTS and every function is CREATE OR REPLACE.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: RLS-exempt role lookups
--
-- STABLE, so the planner calls them once per query rather than once per row. SECURITY
-- DEFINER with a pinned search_path, matching the convention in 0016/0017/0018.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.is_sacco_member(p_sacco_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = p_sacco_id
      AND sm.profile_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_sacco_staff(p_sacco_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = p_sacco_id
      AND sm.profile_id = auth.uid()
      AND sm.role IN ('admin', 'loan_officer')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_sacco_admin(p_sacco_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = p_sacco_id
      AND sm.profile_id = auth.uid()
      AND sm.role = 'admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- "Is this caller allowed to file financial records against this SACCO right now?"
--
-- Two branches, because the app has two notions of belonging and they do not always
-- agree. 0018 records the reason: "a member matched by profiles.group_id alone has no
-- sacco_memberships row at all". /api/user-transactions resolves the SACCO through
-- profiles.group_id -> saccos.group_code, so a membership-only test would silently lock
-- those members out of contributing.
--
-- Either branch requires an approved status: set_member_approval (0018) writes 'pending'
-- to both profiles.status and sacco_memberships.status when an admin revokes access, and
-- a revoked member must not be able to keep filing contributions.
CREATE OR REPLACE FUNCTION public.can_transact_in_sacco(p_sacco_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sacco_memberships sm
    WHERE sm.sacco_id = p_sacco_id
      AND sm.profile_id = auth.uid()
      AND sm.status = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.saccos s ON s.group_code = p.group_id
    WHERE p.id = auth.uid()
      AND s.id = p_sacco_id
      AND p.status = 'active'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- These are read-only role predicates, but they do bypass RLS, so keep the grant list
-- explicit rather than leaning on the default PUBLIC execute grant.
REVOKE EXECUTE ON FUNCTION public.is_sacco_member(UUID)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_sacco_staff(UUID)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_sacco_admin(UUID)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_transact_in_sacco(UUID) FROM PUBLIC;

-- anon is included deliberately: policies are evaluated for anon sessions too, and a
-- missing EXECUTE grant would raise a permission error instead of returning false.
GRANT EXECUTE ON FUNCTION public.is_sacco_member(UUID)       TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_sacco_staff(UUID)        TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_sacco_admin(UUID)        TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_transact_in_sacco(UUID) TO authenticated, anon, service_role;


-- ====================================================================================
-- STEP 2: sacco_memberships -- same rules as 0015, without the self-reference
-- ====================================================================================
DROP POLICY IF EXISTS "sacco_memberships_select_own_or_staff" ON public.sacco_memberships;
DROP POLICY IF EXISTS "sacco_memberships_insert_self_or_admin" ON public.sacco_memberships;
DROP POLICY IF EXISTS "sacco_memberships_update_admin_only" ON public.sacco_memberships;

CREATE POLICY "sacco_memberships_select_own_or_staff" ON public.sacco_memberships FOR SELECT USING (
  profile_id = auth.uid()
  OR public.is_sacco_staff(sacco_id)
);

CREATE POLICY "sacco_memberships_insert_self_or_admin" ON public.sacco_memberships FOR INSERT WITH CHECK (
  (profile_id = auth.uid() AND role = 'member')
  OR public.is_sacco_admin(sacco_id)
);

-- WITH CHECK is spelled out rather than left to default to USING: without it an admin
-- could move a membership row into a SACCO they do not administer.
CREATE POLICY "sacco_memberships_update_admin_only" ON public.sacco_memberships FOR UPDATE
  USING (public.is_sacco_admin(sacco_id))
  WITH CHECK (public.is_sacco_admin(sacco_id));


-- ====================================================================================
-- STEP 3: transactions -- a member had no way to insert their own contribution
--
-- 0015 read the transactions policies as "already correctly scoped, SELECT-only" and
-- added just one INSERT policy, for staff-logged absenteeism fines. But
-- /api/user-transactions POST (the member's weekly Shares / Development / Social
-- submission, from userweeklycontributions.jsx) inserts with the member's own JWT under
-- the anon key, not service_role. With no INSERT policy matching, that submit fails
-- regardless of the recursion above -- it was simply masked by it.
--
-- The policy mirrors exactly what that route writes, and nothing more: your own row, in
-- your own SACCO, credit direction, one of the three contribution categories, and
-- 'pending'. Pending is the important part -- an admin still has to approve it through
-- approve_member_transaction before any balance moves, so this cannot mint money.
-- ====================================================================================
DROP POLICY IF EXISTS "transactions_insert_own_pending_contribution" ON public.transactions;

CREATE POLICY "transactions_insert_own_pending_contribution" ON public.transactions FOR INSERT WITH CHECK (
  profile_id = auth.uid()
  AND requested_by = auth.uid()
  AND status = 'pending'
  AND direction = 'credit'
  AND category IN ('shares', 'development_fund', 'social_fund')
  AND amount > 0
  AND approved_by IS NULL
  AND public.can_transact_in_sacco(sacco_id)
);


-- ====================================================================================
-- STEP 4: transactions / loans SELECT -- cross-tenant leak in the 0002 policies
--
-- 0015 left these two alone as "already correctly scoped". They are not. Both read:
--
--     EXISTS (SELECT 1 FROM sacco_memberships sm
--             WHERE sm.sacco_id = sacco_id AND sm.profile_id = auth.uid() AND ...)
--
-- The unqualified `sacco_id` resolves to the *inner* table's column, so the intended
-- correlation to the outer row never happens and the condition degrades to
-- `sm.sacco_id = sm.sacco_id`, which is always true. The net effect: any admin or loan
-- officer of any SACCO can read every transaction and every loan in the database,
-- across all tenants. Qualifying the outer column fixes it; the helper from STEP 1 is
-- used here so the correlation cannot be written ambiguously again.
-- ====================================================================================
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
DROP POLICY IF EXISTS "transactions_select_own_or_staff" ON public.transactions;

CREATE POLICY "transactions_select_own_or_staff" ON public.transactions FOR SELECT USING (
  profile_id = auth.uid()
  OR public.is_sacco_staff(sacco_id)
);

DROP POLICY IF EXISTS "Users can view own loans" ON public.loans;
DROP POLICY IF EXISTS "loans_select_own_or_staff" ON public.loans;

CREATE POLICY "loans_select_own_or_staff" ON public.loans FOR SELECT USING (
  profile_id = auth.uid()
  OR public.is_sacco_staff(sacco_id)
);
