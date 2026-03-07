-- Migration 004: Create onboarding_requests table
-- Stores pending client onboarding requests collected via voice call
-- Run this in Supabase Dashboard → SQL Editor

CREATE TABLE onboarding_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Business details
  business_name TEXT NOT NULL,
  vertical_id TEXT NOT NULL DEFAULT 'hvac',
  service_area TEXT NOT NULL,
  services JSONB DEFAULT '[]',
  business_hours JSONB DEFAULT '{}',

  -- Owner contact info
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  owner_phone TEXT NOT NULL,

  -- AI preferences
  ai_name TEXT DEFAULT 'Alex',
  timezone TEXT DEFAULT 'America/New_York',
  preferred_area_code TEXT,

  -- Status & workflow
  status TEXT DEFAULT 'pending',  -- pending, approved, provisioned, rejected
  vapi_call_id TEXT,
  transcribed_data JSONB DEFAULT '{}',
  notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  provisioned_client_id UUID REFERENCES clients(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_onboarding_status ON onboarding_requests (status);
CREATE INDEX idx_onboarding_created ON onboarding_requests (created_at DESC);

-- Enable RLS
ALTER TABLE onboarding_requests ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (server-side only)
CREATE POLICY "service_role_all" ON onboarding_requests
  FOR ALL USING (true) WITH CHECK (true);
