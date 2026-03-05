-- Migration 008: Add booking completion tracking for follow-up emails
--
-- This migration adds columns to track when a booking is marked as completed and when
-- an automated follow-up email has been sent. This enables the system to trigger post-service
-- customer outreach (surveys, reviews, upsell) without sending duplicate emails.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS follow_up_sent_at TIMESTAMPTZ;
