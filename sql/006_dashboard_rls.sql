-- Migration 006: Add write RLS policies for the client dashboard
-- The existing team_read policies allow SELECT only.
-- The dashboard needs UPDATE access for bookings, config, and alerts.
-- Run this in Supabase Dashboard -> SQL Editor

-- Allow owners/admins to update their client config (settings page)
CREATE POLICY "team_write_config" ON client_config
  FOR UPDATE USING (
    client_id IN (
      SELECT client_id FROM client_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Allow owners/admins to update bookings (edit, cancel)
CREATE POLICY "team_write_bookings" ON bookings
  FOR UPDATE USING (
    client_id IN (
      SELECT client_id FROM client_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- Allow any team member to update alerts (mark as read)
CREATE POLICY "team_write_alerts" ON alerts
  FOR UPDATE USING (
    client_id IN (
      SELECT client_id FROM client_users
      WHERE user_id = auth.uid()
    )
  );
