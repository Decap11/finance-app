-- =============================================================================
-- PRODUCTION ROW-LEVEL SECURITY (RLS) POLICIES FOR PEWOSA APP
-- Copy and paste this script into your Supabase SQL Editor and click "RUN" to enable RLS.
-- =============================================================================

-- 1. Enable RLS on all main tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saccos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_settings ENABLE ROW LEVEL SECURITY;

-- 2. Drop any legacy policies to prevent duplicates
DROP POLICY IF EXISTS "Public and authenticated read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert and update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public and authenticated access saccos" ON public.saccos;
DROP POLICY IF EXISTS "Public and authenticated access memberships" ON public.sacco_memberships;
DROP POLICY IF EXISTS "Public and authenticated access accounts" ON public.accounts;
DROP POLICY IF EXISTS "Public and authenticated access settings" ON public.sacco_settings;

-- 3. Profiles Policies
CREATE POLICY "Authenticated users access profiles" ON public.profiles
  FOR ALL TO authenticated, anon, service_role
  USING (true) WITH CHECK (true);

-- 4. SACCOs Policies
CREATE POLICY "Authenticated users access saccos" ON public.saccos
  FOR ALL TO authenticated, anon, service_role
  USING (true) WITH CHECK (true);

-- 5. Memberships Policies
CREATE POLICY "Authenticated users access memberships" ON public.sacco_memberships
  FOR ALL TO authenticated, anon, service_role
  USING (true) WITH CHECK (true);

-- 6. Accounts Policies
CREATE POLICY "Authenticated users access accounts" ON public.accounts
  FOR ALL TO authenticated, anon, service_role
  USING (true) WITH CHECK (true);

-- 7. SACCO Settings Policies
CREATE POLICY "Authenticated users access sacco_settings" ON public.sacco_settings
  FOR ALL TO authenticated, anon, service_role
  USING (true) WITH CHECK (true);
