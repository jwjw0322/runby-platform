-- ============================================
-- RunBy Platform - Database Schema
-- Phase 1: Core Tables, RLS, Realtime
-- Run in Supabase Dashboard → SQL Editor
-- ============================================

-- ============================================
-- TABLE 1: clients (your customers)
-- ============================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  vertical_id TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  twilio_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pilot'
);

CREATE INDEX idx_clients_vertical ON clients (vertical_id);

-- ============================================
-- TABLE 2: client_config (per-client settings the AI reads every call)
-- ============================================
CREATE TABLE client_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  vertical_id TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_hours JSONB DEFAULT '{"mon":{"open":"08:00","close":"17:00"}}',
  services JSONB DEFAULT '[]',
  service_area TEXT,
  routing_mode TEXT DEFAULT 'ai_primary',
  ring_timeout_seconds INT DEFAULT 20,
  transfer_numbers JSONB DEFAULT '[]',
  ai_name TEXT DEFAULT 'Alex',
  languages TEXT[] DEFAULT '{en}',
  briefing_time TEXT DEFAULT '07:00',
  review_request_delay_hours INT DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id)
);

CREATE INDEX idx_config_client ON client_config (client_id);

-- ============================================
-- TABLE 3: interactions (every call, text, email, chat)
-- ============================================
CREATE TABLE interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  vertical_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'call', 'sms', 'email', 'chat'
  direction TEXT NOT NULL,      -- 'inbound', 'outbound'
  caller_number TEXT,
  caller_name TEXT,
  language TEXT DEFAULT 'en',
  module TEXT,                  -- which capability module handled it
  classification TEXT,          -- 'booking', 'emergency', 'inquiry', 'estimate', etc.
  outcome TEXT,                 -- 'booked', 'transferred', 'voicemail', 'resolved', etc.
  estimated_value DECIMAL(10,2),
  duration_seconds INT,
  transcript_id UUID,
  source TEXT,                  -- 'direct', 'callback', 'campaign'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_interactions_client_date ON interactions (client_id, created_at);
CREATE INDEX idx_interactions_vertical_date ON interactions (vertical_id, created_at);
CREATE INDEX idx_interactions_module ON interactions (module, created_at);
CREATE INDEX idx_interactions_outcome ON interactions (outcome, created_at);

-- ============================================
-- TABLE 4: transcripts
-- ============================================
CREATE TABLE transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id UUID REFERENCES interactions(id),
  client_id UUID REFERENCES clients(id),
  full_text TEXT,
  summary TEXT,
  action_items JSONB DEFAULT '[]',
  sentiment TEXT,               -- 'positive', 'neutral', 'negative'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transcripts_interaction ON transcripts (interaction_id);

-- ============================================
-- TABLE 5: bookings
-- ============================================
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  vertical_id TEXT NOT NULL,
  interaction_id UUID REFERENCES interactions(id),
  customer_name TEXT,
  customer_phone TEXT,
  service_type TEXT,
  provider TEXT,
  scheduled_date DATE,
  scheduled_time TEXT,
  estimated_value DECIMAL(10,2),
  source TEXT,                  -- 'inbound', 'callback', 'campaign'
  status TEXT DEFAULT 'confirmed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_client ON bookings (client_id, scheduled_date);

-- ============================================
-- TABLE 6: missed_calls
-- ============================================
CREATE TABLE missed_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  vertical_id TEXT NOT NULL,
  caller_number TEXT NOT NULL,
  caller_name TEXT,
  missed_at TIMESTAMPTZ DEFAULT NOW(),
  callback_attempted_at TIMESTAMPTZ,
  callback_outcome TEXT,        -- 'booked', 'voicemail', 'no_answer', 'not_interested'
  revenue_recovered DECIMAL(10,2),
  status TEXT DEFAULT 'pending' -- 'pending', 'attempted', 'recovered', 'closed'
);

CREATE INDEX idx_missed_client ON missed_calls (client_id, status);

-- ============================================
-- TABLE 7: estimates
-- ============================================
CREATE TABLE estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  vertical_id TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  service_type TEXT,
  amount DECIMAL(10,2),
  sent_date DATE,
  follow_up_stage INT DEFAULT 0,
  last_follow_up TIMESTAMPTZ,
  outcome TEXT DEFAULT 'pending', -- 'pending', 'converted', 'lost'
  converted_date DATE,
  converted_revenue DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_estimates_client ON estimates (client_id, outcome);

-- ============================================
-- TABLE 8: reviews
-- ============================================
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  vertical_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- 'request_sent', 'review_received'
  customer_name TEXT,
  customer_phone TEXT,
  platform TEXT DEFAULT 'google',
  rating INT,
  review_text TEXT,
  response_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_client ON reviews (client_id, created_at);

-- ============================================
-- TABLE 9: alerts
-- ============================================
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  type TEXT NOT NULL,            -- 'emergency', 'negative_review', 'failed_transfer', 'high_value_lead'
  severity TEXT DEFAULT 'info',  -- 'info', 'warning', 'critical'
  message TEXT NOT NULL,
  interaction_id UUID REFERENCES interactions(id),
  read BOOLEAN DEFAULT false,
  action_taken TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_client ON alerts (client_id, read, created_at);

-- ============================================
-- TABLE 10: client_users (team access / login)
-- ============================================
CREATE TABLE client_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  user_id UUID REFERENCES auth.users(id),
  email TEXT NOT NULL,
  role TEXT DEFAULT 'viewer',    -- 'owner', 'admin', 'viewer'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, user_id)
);

CREATE INDEX idx_client_users_user ON client_users (user_id);


-- ============================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE missed_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_read" ON interactions FOR SELECT USING (
  client_id IN (SELECT client_id FROM client_users WHERE user_id = auth.uid())
);
CREATE POLICY "team_read" ON transcripts FOR SELECT USING (
  client_id IN (SELECT client_id FROM client_users WHERE user_id = auth.uid())
);
CREATE POLICY "team_read" ON bookings FOR SELECT USING (
  client_id IN (SELECT client_id FROM client_users WHERE user_id = auth.uid())
);
CREATE POLICY "team_read" ON missed_calls FOR SELECT USING (
  client_id IN (SELECT client_id FROM client_users WHERE user_id = auth.uid())
);
CREATE POLICY "team_read" ON estimates FOR SELECT USING (
  client_id IN (SELECT client_id FROM client_users WHERE user_id = auth.uid())
);
CREATE POLICY "team_read" ON reviews FOR SELECT USING (
  client_id IN (SELECT client_id FROM client_users WHERE user_id = auth.uid())
);
CREATE POLICY "team_read" ON alerts FOR SELECT USING (
  client_id IN (SELECT client_id FROM client_users WHERE user_id = auth.uid())
);
CREATE POLICY "team_read" ON client_config FOR SELECT USING (
  client_id IN (SELECT client_id FROM client_users WHERE user_id = auth.uid())
);
CREATE POLICY "own_membership" ON client_users FOR SELECT USING (
  user_id = auth.uid()
);


-- ============================================
-- REALTIME (live dashboard updates)
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE interactions;
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
