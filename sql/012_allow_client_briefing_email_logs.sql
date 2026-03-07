-- Migration 012: Allow client briefing emails in email_logs
--
-- The client daily briefing sender logs with email_type = 'client-briefing',
-- but the original email_logs CHECK constraint did not allow that value.
-- This migration expands the allowed set so briefing sends are auditable.

ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_email_type_check;

ALTER TABLE email_logs
ADD CONSTRAINT email_logs_email_type_check
CHECK (email_type IN ('check-in', 'invoice-reminder', 'seasonal', 'client-briefing'));