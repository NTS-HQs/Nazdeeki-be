-- ============================================================================
-- Fix for Operational Fields Issues in Sellers Table
-- ============================================================================
-- This script addresses the missing operating_hours column and ordinal position issues

BEGIN;

-- 1. Fix the missing operating_hours column in sellers table
-- Add it back for backward compatibility with existing code
ALTER TABLE sellers 
ADD COLUMN IF NOT EXISTS operating_hours VARCHAR(100);

-- 2. Remove the incorrect self-referential foreign key on rest_phone
-- First check if it exists, then drop it
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%rest_phone%' 
        AND table_name = 'sellers'
        AND constraint_type = 'FOREIGN KEY'
    ) THEN
        ALTER TABLE sellers DROP CONSTRAINT sellers_rest_phone_fkey;
        RAISE NOTICE 'Dropped self-referential foreign key on rest_phone';
    END IF;
END $$;

-- 3. Ensure proper unique constraint on rest_phone (should be unique but not self-referential)
ALTER TABLE sellers DROP CONSTRAINT IF EXISTS unique_phone;
ALTER TABLE sellers ADD CONSTRAINT unique_phone UNIQUE(rest_phone);

-- 4. Migrate data from new time fields back to operating_hours for compatibility
-- This ensures existing code that expects operating_hours continues to work
UPDATE sellers 
SET operating_hours = CASE 
    WHEN opening_time IS NOT NULL AND closing_time IS NOT NULL THEN
        opening_time::TEXT || ' - ' || closing_time::TEXT
    WHEN opening_time IS NOT NULL THEN
        'Opens: ' || opening_time::TEXT
    WHEN closing_time IS NOT NULL THEN
        'Closes: ' || closing_time::TEXT
    ELSE operating_hours
END
WHERE (opening_time IS NOT NULL OR closing_time IS NOT NULL)
AND (operating_hours IS NULL OR operating_hours = '');

-- 5. Create a function to keep operating_hours in sync with time fields
CREATE OR REPLACE FUNCTION sync_operating_hours()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-update operating_hours when time fields change
    IF NEW.opening_time IS NOT NULL AND NEW.closing_time IS NOT NULL THEN
        NEW.operating_hours = NEW.opening_time::TEXT || ' - ' || NEW.closing_time::TEXT;
    ELSIF NEW.opening_time IS NOT NULL THEN
        NEW.operating_hours = 'Opens: ' || NEW.opening_time::TEXT;
    ELSIF NEW.closing_time IS NOT NULL THEN
        NEW.operating_hours = 'Closes: ' || NEW.closing_time::TEXT;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Create trigger to maintain operating_hours automatically
DROP TRIGGER IF EXISTS sync_operating_hours_trigger ON sellers;
CREATE TRIGGER sync_operating_hours_trigger
    BEFORE INSERT OR UPDATE OF opening_time, closing_time ON sellers
    FOR EACH ROW
    EXECUTE FUNCTION sync_operating_hours();

-- 7. Update sellers_backup table to match the main table structure
ALTER TABLE sellers_backup 
ADD COLUMN IF NOT EXISTS operating_hours VARCHAR(100);

-- Update backup table data as well
UPDATE sellers_backup 
SET operating_hours = CASE 
    WHEN opening_time IS NOT NULL AND closing_time IS NOT NULL THEN
        opening_time::TEXT || ' - ' || closing_time::TEXT
    WHEN opening_time IS NOT NULL THEN
        'Opens: ' || opening_time::TEXT
    WHEN closing_time IS NOT NULL THEN
        'Closes: ' || closing_time::TEXT
    ELSE operating_hours
END
WHERE (opening_time IS NOT NULL OR closing_time IS NOT NULL)
AND (operating_hours IS NULL OR operating_hours = '');

-- 8. Add helpful comments to document the dual approach
COMMENT ON COLUMN sellers.operating_hours IS 'Legacy field maintained for backward compatibility. Auto-synced from opening_time/closing_time';
COMMENT ON COLUMN sellers.opening_time IS 'Structured opening time in HH:MM format';
COMMENT ON COLUMN sellers.closing_time IS 'Structured closing time in HH:MM format';

-- 9. Verify the fixes with some sample data
DO $$
DECLARE
    rec RECORD;
BEGIN
    -- Show a few examples of the updated structure
    FOR rec IN 
        SELECT seller_id, operating_hours, opening_time, closing_time, service_types 
        FROM sellers 
        WHERE seller_id IS NOT NULL 
        LIMIT 3
    LOOP
        RAISE NOTICE 'Seller %, Hours: %, Open: %, Close: %, Services: %', 
            rec.seller_id, rec.operating_hours, rec.opening_time, rec.closing_time, rec.service_types;
    END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- Verification Queries (run these to check the fixes)
-- ============================================================================

-- Check table structure
-- SELECT column_name, ordinal_position, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'sellers' ORDER BY ordinal_position;

-- Check foreign key constraints
-- SELECT constraint_name, table_name, column_name FROM information_schema.key_column_usage WHERE table_name = 'sellers' AND constraint_name LIKE '%fkey%';

-- Check unique constraints
-- SELECT constraint_name, table_name FROM information_schema.table_constraints WHERE table_name = 'sellers' AND constraint_type = 'UNIQUE';

-- Sample data check
-- SELECT seller_id, operating_hours, opening_time, closing_time, service_types FROM sellers LIMIT 5; 