-- ====================================================================================
-- MIGRATION 0016: Tenant suspension + subscription billing holds
-- Branch: Additional-features
-- ====================================================================================
--
-- Gives the platform developer two distinct levers over a tenant SACCO:
--
--   SUSPEND  (status = 'suspended')  Administrative lockout. Nobody in the SACCO can
--                                    enter the app at all. Manual, reason-tracked,
--                                    released only by an explicit reinstate.
--
--   HOLD     (status = 'on_hold')    Billing restriction, driven by subscription state.
--                                    Members can still sign in and read their records,
--                                    but every financial write is refused until the
--                                    subscription is settled.
--
-- Safe to re-run: every ADD COLUMN is IF NOT EXISTS, every DROP is IF EXISTS, and the
-- guard function/triggers are recreated unconditionally.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: Allow the 'on_hold' lifecycle state on saccos.status
-- ====================================================================================
ALTER TABLE public.saccos DROP CONSTRAINT IF EXISTS saccos_status_check;
ALTER TABLE public.saccos ADD CONSTRAINT saccos_status_check
  CHECK (status IN ('active', 'on_hold', 'suspended', 'closed'));


-- ====================================================================================
-- STEP 2: Subscription + lifecycle columns
-- ====================================================================================
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'basic';
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial';
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS subscription_amount NUMERIC(15, 2) DEFAULT 150000.00;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ;

-- Why the SACCO is in its current lifecycle state, surfaced to the tenant's members.
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS status_changed_by TEXT;

ALTER TABLE public.saccos DROP CONSTRAINT IF EXISTS saccos_subscription_plan_check;
ALTER TABLE public.saccos ADD CONSTRAINT saccos_subscription_plan_check
  CHECK (subscription_plan IN ('basic', 'premium', 'enterprise'));

ALTER TABLE public.saccos DROP CONSTRAINT IF EXISTS saccos_subscription_status_check;
ALTER TABLE public.saccos ADD CONSTRAINT saccos_subscription_status_check
  CHECK (subscription_status IN ('trial', 'active', 'past_due', 'expired', 'cancelled'));

-- Backfill rows created before this migration: a 30-day trial from their signup date.
UPDATE public.saccos
SET subscription_plan = COALESCE(subscription_plan, 'basic'),
    subscription_status = COALESCE(subscription_status, 'trial'),
    subscription_started_at = COALESCE(subscription_started_at, created_at),
    subscription_expires_at = COALESCE(subscription_expires_at, created_at + INTERVAL '30 days')
WHERE subscription_expires_at IS NULL
   OR subscription_status IS NULL
   OR subscription_plan IS NULL;

CREATE INDEX IF NOT EXISTS idx_saccos_subscription_status ON public.saccos(subscription_status);
CREATE INDEX IF NOT EXISTS idx_saccos_status ON public.saccos(status);


-- ====================================================================================
-- STEP 3: A tenant admin must not be able to lift their own suspension or hold
--
-- "saccos_update_admin_only" (migration 0015) lets a SACCO admin UPDATE their own row,
-- which would otherwise include status and every subscription column. Same treatment as
-- profiles in 0015: revoke the blanket UPDATE and grant back only operational columns.
-- Verified no browser code writes to saccos at all -- every write goes through a
-- service-role API route, and service_role is unaffected by these grants.
-- ====================================================================================
REVOKE UPDATE ON public.saccos FROM authenticated, anon;
GRANT UPDATE (
  name,
  acronym,
  member_limit,
  share_price,
  devt_fund,
  social_fund,
  current_week,
  is_locked,
  is_historical_mode,
  absenteeism_fine_amount,
  onboarding_date,
  updated_at
) ON public.saccos TO authenticated;
-- status, subscription_*, status_reason, status_changed_*, group_code and
-- admin_profile_id are deliberately NOT grantable: platform-controlled only.


-- ====================================================================================
-- STEP 4: Enforce the lifecycle state on every financial write
--
-- This is what makes suspend/hold real. RLS alone can't express it, and the app writes
-- through several paths (browser RPCs, service-role API routes, SECURITY DEFINER
-- functions). A BEFORE trigger fires on all of them, including service_role.
--
-- INSERT and UPDATE only, never DELETE: `saccos` cascades to these tables, so guarding
-- DELETE would make a suspended SACCO row impossible to remove.
-- ====================================================================================
CREATE OR REPLACE FUNCTION public.enforce_sacco_access_state()
RETURNS trigger AS $$
DECLARE
  v_sacco_id UUID;
  v_status TEXT;
  v_reason TEXT;
BEGIN
  -- loan_repayments is the one guarded table without its own sacco_id.
  IF TG_TABLE_NAME = 'loan_repayments' THEN
    SELECT l.sacco_id INTO v_sacco_id FROM public.loans l WHERE l.id = NEW.loan_id;
  ELSE
    v_sacco_id := NEW.sacco_id;
  END IF;

  IF v_sacco_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.status, s.status_reason INTO v_status, v_reason
  FROM public.saccos s WHERE s.id = v_sacco_id;

  IF v_status = 'suspended' THEN
    RAISE EXCEPTION 'SACCO_SUSPENDED: This SACCO has been suspended by the platform administrator. %',
      COALESCE(v_reason, 'Contact platform support to restore access.');
  ELSIF v_status = 'on_hold' THEN
    RAISE EXCEPTION 'SACCO_ON_HOLD: This SACCO is on a billing hold pending subscription payment. %',
      COALESCE(v_reason, 'Settle the outstanding subscription to resume activity.');
  ELSIF v_status = 'closed' THEN
    RAISE EXCEPTION 'SACCO_CLOSED: This SACCO account has been closed.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach to every table that carries financial state. Guarded by to_regclass so the
-- file still applies cleanly if 0013 (vaults/dividends) has not run yet.
DO $$
DECLARE
  t TEXT;
  guarded TEXT[] := ARRAY[
    'transactions',
    'loans',
    'loan_repayments',
    'accounts',
    'sacco_memberships',
    'savings_vaults',
    'dividend_cycles'
  ];
BEGIN
  FOREACH t IN ARRAY guarded LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_sacco_access_state ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_sacco_access_state
           BEFORE INSERT OR UPDATE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.enforce_sacco_access_state()', t);
    END IF;
  END LOOP;
END $$;
