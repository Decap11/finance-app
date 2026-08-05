-- ====================================================================================
-- MIGRATION 0036: Make saccos.subscription_plan the plans we actually sell
-- ====================================================================================
--
-- The plan catalogue in src/utils/subscriptionPlans.js -- the one the payments page shows
-- members, the one /api/subscription-plans serves and the one /api/subscription-checkout
-- prices a request from -- is:
--
--   basic      free        the onboarding month, a trial
--   standard   60,000      per month   (recommended; was 75,000)
--   premium    200,000     per 3 months
--
-- 0016 wrote a different list into the database: ('basic', 'premium', 'enterprise'). So
-- 'standard' -- the plan most SACCOs are meant to be on -- could not be stored at all, and
-- 'enterprise' is a tier nothing in the app sells. subscriptionPlans.js has carried a note
-- about this since it was written; this file is that note being settled.
--
-- subscription_amount defaulted to 150,000, which is not the price of any plan in the
-- catalogue and never has been. Every SACCO ever registered carries it, because
-- register_new_sacco does not set the column and nothing in the app writes it afterwards:
-- record-payment updates the status and the expiry only, and update-subscription writes the
-- amount only when a caller supplies one, which the developer portal never did. So the
-- figure the portal has been billing against is the column default and nothing else.
--
-- Safe to re-run: the UPDATEs are idempotent, the constraint is dropped before it is added.
-- ====================================================================================


-- ====================================================================================
-- STEP 1: Retire 'enterprise'
--
-- Before the constraint changes, or ADD CONSTRAINT fails on any row still holding it.
-- Premium is the top plan that exists, so that is where an enterprise tenant lands.
-- ====================================================================================
UPDATE public.saccos
SET subscription_plan = 'premium',
    updated_at = now()
WHERE subscription_plan = 'enterprise';


-- ====================================================================================
-- STEP 2: The constraint now lists the catalogue
-- ====================================================================================
ALTER TABLE public.saccos DROP CONSTRAINT IF EXISTS saccos_subscription_plan_check;
ALTER TABLE public.saccos ADD CONSTRAINT saccos_subscription_plan_check
  CHECK (subscription_plan IN ('basic', 'standard', 'premium'));


-- ====================================================================================
-- STEP 3: What a tenant is charged, per billing term of their plan
--
-- Per *term*, not per month: premium is one payment of 200,000 covering three months, and
-- storing a derived monthly figure for it would round (66,666.67) and then fail to
-- reconcile against what was actually collected. Anything that wants a monthly rate
-- divides by the plan's duration at the point of display -- see planMonthlyPrice() in
-- src/utils/subscriptionPlans.js, which is what the portal's revenue metric uses.
--
-- The backfill deliberately touches only rows sitting on the old default or on nothing at
-- all. A row with any other figure was set by hand and is left exactly as it is.
-- ====================================================================================
ALTER TABLE public.saccos ALTER COLUMN subscription_amount SET DEFAULT 0;

UPDATE public.saccos
SET subscription_amount = CASE COALESCE(subscription_plan, 'basic')
      WHEN 'standard' THEN 60000
      WHEN 'premium'  THEN 200000
      ELSE 0                      -- basic is the free onboarding trial
    END,
    updated_at = now()
WHERE subscription_amount IS NULL
   OR subscription_amount = 150000;

COMMENT ON COLUMN public.saccos.subscription_amount IS
  'What this tenant is charged per billing term of their plan, in UGX. A term is one month '
  'on basic/standard and three months on premium. 0 on the basic trial. Prices come from '
  'src/utils/subscriptionPlans.js; this column is the per-tenant override of that price.';

COMMENT ON COLUMN public.saccos.subscription_plan IS
  'Which catalogue plan this tenant is on: basic (free onboarding trial), standard or '
  'premium. Mirrors the ids in src/utils/subscriptionPlans.js. Platform-controlled -- 0016 '
  'revoked the tenant admin''s UPDATE grant on this column.';


-- ====================================================================================
-- STEP 4: Record it
-- ====================================================================================
SELECT public.record_migration(
  '0036',
  'Aligns saccos.subscription_plan with the plan catalogue: adds standard, retires '
  'enterprise (migrated to premium), and replaces the 150,000 subscription_amount default '
  'with the plan''s real price per billing term.'
);


-- ====================================================================================
-- Verify, after running. Expect no enterprise rows, and every amount to be one of
-- 0 / 60000 / 200000 unless it was set by hand:
--
--   SELECT subscription_plan, subscription_amount, count(*)
--   FROM public.saccos
--   GROUP BY 1, 2
--   ORDER BY 1, 2;
-- ====================================================================================
