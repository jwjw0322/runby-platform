-- Migration 005: Create demo_leads table
-- Stores demo meeting requests from the AI sales rep
-- Run this in Supabase Dashboard → SQL Editor

CREATE TABLE demo_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Business info
  business_name TEXT NOT NULL,
  business_type TEXT,
  num_employees TEXT,
  current_pain_points TEXT,

  -- Contact info
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,

  -- Demo preferences
  preferred_demo_time TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  interest_level TEXT DEFAULT 'warm',  -- hot, warm, cold

  -- Call context
  call_direction TEXT DEFAULT 'inbound',  -- inbound, outbound
  vapi_call_id TEXT,
  transcribed_data JSONB DEFAULT '{}',

  -- Status & workflow
  status TEXT DEFAULT 'pending',  -- pending, scheduled, completed, no_show, not_interested
  notes TEXT,
  followed_up_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_demo_leads_status ON demo_leads (status);
CREATE INDEX idx_demo_leads_interest ON demo_leads (interest_level);
CREATE INDEX idx_demo_leads_created ON demo_leads (created_at DESC);

-- Enable RLS
ALTER TABLE demo_leads ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (server-side only)
CREATE POLICY "service_role_all" ON demo_leads
  FOR ALL USING (true) WITH CHECK (true);
