-- Migration 007: Create invoices, email logs, and seasonal reminders tables
--
-- This migration establishes the foundation for invoice sync from accounting platforms
-- (QuickBooks/FreshBooks) and tracks all automated customer communications. The tables
-- support billing workflows, email delivery auditing, and seasonal reminder scheduling.

-- Create invoices table for lightweight sync from external accounting systems
CREATE TABLE IF NOT EXISTS invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_invoice_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  amount DECIMAL(10,2) NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','cancelled')),
  invoice_date DATE,
  paid_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, external_invoice_id)
);

-- Create email_logs table to audit every automated email sent to customers
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  email_type TEXT NOT NULL CHECK (email_type IN ('check-in','invoice-reminder','seasonal')),
  related_booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  related_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  delivery_status TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent','failed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create seasonal_reminders table for per-client seasonal email scheduling
CREATE TABLE IF NOT EXISTS seasonal_reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  vertical_id TEXT NOT NULL,
  reminder_key TEXT NOT NULL,
  reminder_label TEXT NOT NULL,
  reminder_month INTEGER NOT NULL CHECK (reminder_month BETWEEN 1 AND 12),
  enabled BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, reminder_key)
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

CREATE INDEX IF NOT EXISTS idx_email_logs_client_sent ON email_logs(client_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_type_sent ON email_logs(email_type, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_booking_id ON email_logs(related_booking_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_invoice_id ON email_logs(related_invoice_id);

CREATE INDEX IF NOT EXISTS idx_seasonal_reminders_client ON seasonal_reminders(client_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_reminders_month ON seasonal_reminders(reminder_month);

-- Enable Row Level Security on all three tables (service_role only, server-side)
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_reminders ENABLE ROW LEVEL SECURITY;

-- RLS policies: allow service_role unrestricted access to all three tables
CREATE POLICY service_role_all_invoices ON invoices FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_email_logs ON email_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_seasonal_reminders ON seasonal_reminders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Create or replace the update_updated_at_column trigger function (used by multiple tables)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on invoices table to automatically update the updated_at timestamp
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
