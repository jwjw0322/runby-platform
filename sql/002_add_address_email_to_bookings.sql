-- Add customer_email and customer_address to bookings table
-- Run this in Supabase Dashboard → SQL Editor

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_address TEXT;
