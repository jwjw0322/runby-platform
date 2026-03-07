-- ============================================
-- RunBy Platform - Internal Client for Onboarding & Sales Calls
-- This creates a "RunBy" client record so onboarding and sales
-- calls can be logged to the interactions table with a valid client_id.
-- Run in Supabase Dashboard → SQL Editor
-- ============================================

-- Insert the RunBy internal client (idempotent — skips if already exists)
INSERT INTO clients (id, name, business_name, vertical_id, phone, email, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'RunBy Internal',
  'RunBy AI',
  'internal',
  NULL,
  'jonathan@runbyai.co',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- Also create a minimal config row so any lookups don't break
INSERT INTO client_config (client_id, vertical_id, business_name, ai_name, owner_email, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'internal',
  'RunBy AI',
  'RunBy Assistant',
  'jonathan@runbyai.co',
  'America/New_York'
)
ON CONFLICT (client_id) DO NOTHING;
