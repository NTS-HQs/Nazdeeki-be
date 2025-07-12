-- Simple Database Migration: Fix Foreign Key Relationships
-- This script handles existing data and fixes the seller-address relationship

-- Step 1: Check existing data first
-- Run this query to see what data exists:
-- SELECT seller_id, address_id, menu_id FROM sellers WHERE address_id IS NOT NULL OR menu_id IS NOT NULL;

-- Step 2: Handle existing data by converting string IDs to integers
-- For existing sellers with string address_id, we need to create proper integer IDs

-- Create a temporary column to store old address_id values
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS old_address_id VARCHAR;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS old_menu_id VARCHAR;

-- Copy existing values to temporary columns
UPDATE sellers 
SET old_address_id = address_id, old_menu_id = menu_id 
WHERE address_id IS NOT NULL OR menu_id IS NOT NULL;

-- Step 3: Create helper function to get next address ID
CREATE OR REPLACE FUNCTION get_next_address_id()
RETURNS INTEGER AS $$
DECLARE
    next_id INTEGER;
BEGIN
    SELECT COALESCE(MAX(address_id), 0) + 1 INTO next_id FROM addresses;
    RETURN next_id;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Convert existing string address_ids to integers and create corresponding address records
DO $$
DECLARE
    seller_record RECORD;
    new_address_id INTEGER;
    new_menu_id INTEGER;
BEGIN
    -- Process each seller with existing address_id
    FOR seller_record IN 
        SELECT seller_id, old_address_id, old_menu_id 
        FROM sellers 
        WHERE old_address_id IS NOT NULL
    LOOP
        -- Generate new integer address_id
        SELECT get_next_address_id() INTO new_address_id;
        
        -- Create address record in addresses table
        INSERT INTO addresses (address_id, rest_id, address_type)
        VALUES (new_address_id, seller_record.seller_id, 'restaurant')
        ON CONFLICT (address_id) DO NOTHING;
        
        -- Generate new menu_id (assuming menu table uses integer primary key)
        SELECT COALESCE(MAX(item_id), 0) + 1 INTO new_menu_id FROM menu;
        
        -- Update seller with new integer IDs
        UPDATE sellers 
        SET address_id = new_address_id::VARCHAR, menu_id = new_menu_id::VARCHAR
        WHERE seller_id = seller_record.seller_id;
        
        RAISE NOTICE 'Updated seller % - old address_id: %, new address_id: %', 
                     seller_record.seller_id, seller_record.old_address_id, new_address_id;
    END LOOP;
END $$;

-- Step 5: Now convert the column types to integers
ALTER TABLE sellers ALTER COLUMN address_id TYPE INTEGER USING address_id::INTEGER;
ALTER TABLE sellers ALTER COLUMN menu_id TYPE INTEGER USING menu_id::INTEGER;

-- Step 6: Add foreign key constraints
ALTER TABLE sellers DROP CONSTRAINT IF EXISTS fk_sellers_address_id;
ALTER TABLE sellers 
ADD CONSTRAINT fk_sellers_address_id 
FOREIGN KEY (address_id) REFERENCES addresses(address_id) ON DELETE SET NULL;

-- For menu_id, uncomment the next lines if menu table has integer primary key item_id
-- ALTER TABLE sellers DROP CONSTRAINT IF EXISTS fk_sellers_menu_id;
-- ALTER TABLE sellers 
-- ADD CONSTRAINT fk_sellers_menu_id 
-- FOREIGN KEY (menu_id) REFERENCES menu(item_id) ON DELETE SET NULL;

-- Step 7: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_sellers_address_id ON sellers(address_id);
CREATE INDEX IF NOT EXISTS idx_sellers_menu_id ON sellers(menu_id);

-- Step 8: Clean up temporary columns
ALTER TABLE sellers DROP COLUMN IF EXISTS old_address_id;
ALTER TABLE sellers DROP COLUMN IF EXISTS old_menu_id;

-- Step 9: Create trigger for future seller creations
CREATE OR REPLACE FUNCTION create_seller_address()
RETURNS TRIGGER AS $$
BEGIN
    -- If address_id is provided but doesn't exist in addresses table, create it
    IF NEW.address_id IS NOT NULL THEN
        INSERT INTO addresses (address_id, rest_id, address_type)
        VALUES (NEW.address_id, NEW.seller_id, 'restaurant')
        ON CONFLICT (address_id) DO NOTHING;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_create_seller_address ON sellers;
CREATE TRIGGER trigger_create_seller_address
    BEFORE INSERT OR UPDATE ON sellers
    FOR EACH ROW
    EXECUTE FUNCTION create_seller_address();

-- Verification queries (run these after migration):
-- SELECT s.seller_id, s.address_id, a.address_id as addr_exists FROM sellers s LEFT JOIN addresses a ON s.address_id = a.address_id;
-- SELECT COUNT(*) as sellers_count FROM sellers;
-- SELECT COUNT(*) as addresses_count FROM addresses WHERE address_type = 'restaurant'; 