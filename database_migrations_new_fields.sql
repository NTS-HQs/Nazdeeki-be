-- Database migration for enhanced operational details
-- Run this in pgAdmin4 to add new fields for operating hours and service types

BEGIN;

-- 1. Add new time fields to sellers table
ALTER TABLE sellers 
ADD COLUMN IF NOT EXISTS opening_time TIME,
ADD COLUMN IF NOT EXISTS closing_time TIME,
ADD COLUMN IF NOT EXISTS service_types TEXT[];

-- 2. Add comment to document the new fields
COMMENT ON COLUMN sellers.opening_time IS 'Restaurant opening time in HH:MM format';
COMMENT ON COLUMN sellers.closing_time IS 'Restaurant closing time in HH:MM format'; 
COMMENT ON COLUMN sellers.service_types IS 'Array of services offered: Delivery, Dine-in, Takeaway, Event Booking';

-- 3. Migrate existing data (optional - if you have existing data)
-- Convert operating_hours to opening_time and closing_time if possible
UPDATE sellers 
SET opening_time = CASE 
    WHEN operating_hours SIMILAR TO '[0-9]{1,2}:[0-9]{2}[^0-9]*[0-9]{1,2}:[0-9]{2}%' THEN
        (regexp_split_to_array(operating_hours, '[^0-9:]'))[1]::TIME
    ELSE NULL
END,
closing_time = CASE 
    WHEN operating_hours SIMILAR TO '[0-9]{1,2}:[0-9]{2}[^0-9]*[0-9]{1,2}:[0-9]{2}%' THEN
        (regexp_split_to_array(operating_hours, '[^0-9:]'))[3]::TIME
    ELSE NULL
END
WHERE operating_hours IS NOT NULL 
AND opening_time IS NULL 
AND closing_time IS NULL;

-- Convert service_type to service_types array
UPDATE sellers 
SET service_types = CASE 
    WHEN service_type IS NOT NULL THEN ARRAY[service_type]
    ELSE ARRAY[]::TEXT[]
END
WHERE service_types IS NULL;

-- 4. Update sellers_backup table if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sellers_backup') THEN
        ALTER TABLE sellers_backup 
        ADD COLUMN IF NOT EXISTS opening_time TIME,
        ADD COLUMN IF NOT EXISTS closing_time TIME,
        ADD COLUMN IF NOT EXISTS service_types TEXT[];
        
        -- Migrate data in backup table too
        UPDATE sellers_backup 
        SET opening_time = CASE 
            WHEN operating_hours SIMILAR TO '[0-9]{1,2}:[0-9]{2}[^0-9]*[0-9]{1,2}:[0-9]{2}%' THEN
                (regexp_split_to_array(operating_hours, '[^0-9:]'))[1]::TIME
            ELSE NULL
        END,
        closing_time = CASE 
            WHEN operating_hours SIMILAR TO '[0-9]{1,2}:[0-9]{2}[^0-9]*[0-9]{1,2}:[0-9]{2}%' THEN
                (regexp_split_to_array(operating_hours, '[^0-9:]'))[3]::TIME
            ELSE NULL
        END
        WHERE operating_hours IS NOT NULL 
        AND opening_time IS NULL 
        AND closing_time IS NULL;

        UPDATE sellers_backup 
        SET service_types = CASE 
            WHEN service_type IS NOT NULL THEN ARRAY[service_type]
            ELSE ARRAY[]::TEXT[]
        END
        WHERE service_types IS NULL;
    END IF;
END
$$;

-- 5. Create indexes for performance on new fields
CREATE INDEX IF NOT EXISTS idx_sellers_opening_time ON sellers(opening_time);
CREATE INDEX IF NOT EXISTS idx_sellers_service_types ON sellers USING GIN(service_types);

-- 6. Add constraints to ensure valid service types
ALTER TABLE sellers 
ADD CONSTRAINT IF NOT EXISTS check_service_types 
CHECK (
    service_types <@ ARRAY['Delivery', 'Dine-in', 'Takeaway', 'Event Booking']::TEXT[]
);

-- 7. Add constraint to ensure closing time is after opening time
ALTER TABLE sellers 
ADD CONSTRAINT IF NOT EXISTS check_operating_hours 
CHECK (
    opening_time IS NULL OR 
    closing_time IS NULL OR 
    closing_time > opening_time OR 
    (closing_time < opening_time AND closing_time < '12:00'::TIME) -- Handle overnight operations
);

COMMIT;

-- Verification queries (run these after migration to check data)
-- SELECT seller_id, operating_hours, opening_time, closing_time FROM sellers WHERE opening_time IS NOT NULL LIMIT 5;
-- SELECT seller_id, service_type, service_types FROM sellers WHERE service_types IS NOT NULL LIMIT 5;
-- SELECT COUNT(*) as total_sellers, COUNT(opening_time) as with_opening_time, COUNT(service_types) as with_service_types FROM sellers; 