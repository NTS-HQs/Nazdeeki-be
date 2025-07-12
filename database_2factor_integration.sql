-- ============================================================================
-- 2Factor SMS Integration Migration
-- ============================================================================
-- This migration adds support for 2Factor API session tracking

BEGIN;

-- Add session_id column to store 2Factor session ID
ALTER TABLE otp_attempts 
ADD COLUMN IF NOT EXISTS session_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(20) DEFAULT 'console',
ADD COLUMN IF NOT EXISTS sms_status VARCHAR(20) DEFAULT 'pending';

-- Add index for session_id lookups
CREATE INDEX IF NOT EXISTS idx_otp_attempts_session ON otp_attempts(session_id);

-- Add comments to document the new fields
COMMENT ON COLUMN otp_attempts.session_id IS '2Factor API session ID for OTP verification';
COMMENT ON COLUMN otp_attempts.sms_provider IS 'SMS provider used: console, 2factor, twilio, etc.';
COMMENT ON COLUMN otp_attempts.sms_status IS 'SMS delivery status: pending, sent, failed, verified';

-- Update existing records to have console provider
UPDATE otp_attempts 
SET sms_provider = 'console', sms_status = 'sent' 
WHERE sms_provider IS NULL;

COMMIT;

-- ============================================================================
-- Verification Queries (run these to check the migration)
-- ============================================================================

-- Check table structure
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'otp_attempts' ORDER BY ordinal_position;

-- Check sample data
-- SELECT id, phone_number, session_id, sms_provider, sms_status, created_at FROM otp_attempts LIMIT 5; 