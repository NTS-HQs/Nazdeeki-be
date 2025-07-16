-- Database Migration: Change pincode from INT to VARCHAR
-- This fixes the issue with leading zeros being dropped

BEGIN;

-- 1. Add a temporary column
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS pincode_temp VARCHAR(6);

-- 2. Copy existing pincode data to temp column, padding with zeros if needed
UPDATE addresses 
SET pincode_temp = LPAD(pincode::TEXT, 6, '0') 
WHERE pincode IS NOT NULL;

-- 3. Drop the old pincode column
ALTER TABLE addresses DROP COLUMN IF EXISTS pincode;

-- 4. Rename temp column to pincode
ALTER TABLE addresses RENAME COLUMN pincode_temp TO pincode;

-- 5. Add constraint to ensure 6 digits
ALTER TABLE addresses ADD CONSTRAINT check_pincode_format 
CHECK (pincode ~ '^[0-9]{6}$' OR pincode IS NULL);

-- 6. Add index for performance
CREATE INDEX IF NOT EXISTS idx_addresses_pincode ON addresses(pincode);

-- 7. Update any existing functions that use pincode
-- None currently, but good practice to check

COMMIT;

-- Verification query
-- SELECT address_id, pincode FROM addresses WHERE pincode IS NOT NULL LIMIT 10; 