-- =============================================================================
-- IDEMPOTENT SQL MIGRATION: REMOVE MEETING_DAY FROM PUBLIC.SACCOS
-- Copy and paste this script into your Supabase SQL Editor and click "RUN".
-- =============================================================================

-- 1. Drop meeting_day column from public.saccos table
ALTER TABLE public.saccos DROP COLUMN IF EXISTS meeting_day;

-- 2. Ensure meeting_day exists exclusively on public.sacco_settings table
ALTER TABLE public.sacco_settings ADD COLUMN IF NOT EXISTS meeting_day TEXT NOT NULL DEFAULT 'Wednesday';
