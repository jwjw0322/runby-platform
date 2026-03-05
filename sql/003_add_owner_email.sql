-- Add owner_email and timezone to client_config
-- Run this in Supabase Dashboard → SQL Editor

ALTER TABLE client_config ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE client_config ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';

-- Update existing ABC Heating config with owner email
UPDATE client_config
SET owner_email = 'jonathan.williams0322@gmail.com',
    timezone = 'America/New_York'
WHERE client_id = 'b844d342-05b6-4d3a-bfb9-f6b7eb6a14ac';
