-- ==============================================================================
-- Idempotent SQL Migration for SACCO Settings Persistence
-- Copy & Run this script in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql/new
-- ==============================================================================

-- 1. Add settings columns to public.saccos table if missing
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS share_price NUMERIC(15, 2) DEFAULT 25000.00;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS devt_fund NUMERIC(15, 2) DEFAULT 1000.00;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS social_fund NUMERIC(15, 2) DEFAULT 2000.00;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS current_week INTEGER DEFAULT 1;
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS meeting_day TEXT DEFAULT 'Wednesday';
ALTER TABLE public.saccos ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;

-- 2. Create public.sacco_settings table
CREATE TABLE IF NOT EXISTS public.sacco_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code TEXT UNIQUE NOT NULL,
  sacco_id UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  share_price NUMERIC(15, 2) NOT NULL DEFAULT 25000.00,
  devt_fund NUMERIC(15, 2) NOT NULL DEFAULT 1000.00,
  social_fund NUMERIC(15, 2) NOT NULL DEFAULT 2000.00,
  current_week INTEGER NOT NULL DEFAULT 1,
  meeting_day TEXT NOT NULL DEFAULT 'Wednesday',
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.sacco_settings ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies
DROP POLICY IF EXISTS "Anyone can view sacco settings" ON public.sacco_settings;
CREATE POLICY "Anyone can view sacco settings" ON public.sacco_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can update sacco settings" ON public.sacco_settings;
CREATE POLICY "Admins can update sacco settings" ON public.sacco_settings
  FOR ALL USING (true);
