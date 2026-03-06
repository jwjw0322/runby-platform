-- Migration 009: Add service_role write policies for core tables
-- The server uses SUPABASE_SERVICE_KEY (service_role) for all inserts.
-- While the service key typically bypasses RLS, explicit policies ensure
-- writes are never silently blocked regardless of Supabase config.
-- Run this in Supabase Dashboard -> SQL Editor

-- interactions: call logs, chat logs
CREATE POLICY service_role_all_interactions ON interactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- transcripts: call transcripts
CREATE POLICY service_role_all_transcripts ON transcripts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- bookings: appointments
CREATE POLICY service_role_all_bookings ON bookings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- missed_calls
CREATE POLICY service_role_all_missed_calls ON missed_calls
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- estimates
CREATE POLICY service_role_all_estimates ON estimates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- reviews
CREATE POLICY service_role_all_reviews ON reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- alerts: emergency alerts, notifications
CREATE POLICY service_role_all_alerts ON alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- client_config: server needs to read/write config during onboarding
CREATE POLICY service_role_all_client_config ON client_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- client_users: server needs to manage memberships
CREATE POLICY service_role_all_client_users ON client_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);
