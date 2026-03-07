-- Migration 011: Add RLS policies for clients table used by the dashboard
-- The dashboard reads client metadata from the browser, so access should be
-- restricted to clients the authenticated user belongs to.

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_read_clients ON clients
  FOR SELECT USING (
    id IN (
      SELECT client_id FROM client_users
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY service_role_all_clients ON clients
  FOR ALL TO service_role USING (true) WITH CHECK (true);