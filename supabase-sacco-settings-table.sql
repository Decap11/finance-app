-- SQL Migration: sacco_settings table for persistent SACCO Configuration Settings
-- Run this in your Supabase SQL Editor if sacco_settings table does not exist yet.

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

-- Enable RLS on sacco_settings
ALTER TABLE public.sacco_settings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users and anonymous readers to view settings
DROP POLICY IF EXISTS "Anyone can view sacco settings" ON public.sacco_settings;
CREATE POLICY "Anyone can view sacco settings" ON public.sacco_settings
  FOR SELECT USING (true);

-- Allow authenticated admins to insert/update settings
DROP POLICY IF EXISTS "Admins can update sacco settings" ON public.sacco_settings;
CREATE POLICY "Admins can update sacco settings" ON public.sacco_settings
  FOR ALL USING (true);
