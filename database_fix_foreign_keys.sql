-- Database Migration: Fix Foreign Key Relationships and Data Types
-- This script fixes the relationship between sellers and addresses tables

-- Step 1: First, let's check if there are any existing records that would conflict
-- You should run this query first to see existing data:
-- SELECT seller_id, address_id FROM sellers WHERE address_id IS NOT NULL;

-- Step 2: Drop the existing foreign key constraint if it exists
-- (This might not exist based on the schema, but just in case)
ALTER TABLE sellers DROP CONSTRAINT IF EXISTS fk_sellers_address_id;

-- Step 3: Change address_id in sellers table from VARCHAR to INTEGER to match addresses.address_id
-- First, we need to handle existing data
-- If you have existing sellers with address_id values, you'll need to:
-- 1. Create corresponding records in addresses table
-- 2. Update the address_id values to be integers

-- For now, let's assume we're starting fresh or will handle data migration separately
-- Change the column type
ALTER TABLE sellers ALTER COLUMN address_id TYPE INTEGER USING address_id::INTEGER;

-- Step 4: Add proper foreign key constraint
ALTER TABLE sellers 
ADD CONSTRAINT fk_sellers_address_id 
FOREIGN KEY (address_id) REFERENCES addresses(address_id) ON DELETE SET NULL;

-- Step 5: Similarly, fix menu_id if needed (assuming menu table has integer primary key)
-- Check your menu table structure first
-- ALTER TABLE sellers ALTER COLUMN menu_id TYPE INTEGER USING menu_id::INTEGER;
-- ALTER TABLE sellers ADD CONSTRAINT fk_sellers_menu_id FOREIGN KEY (menu_id) REFERENCES menu(item_id) ON DELETE SET NULL;

-- Step 6: Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_sellers_address_id ON sellers(address_id);
CREATE INDEX IF NOT EXISTS idx_sellers_menu_id ON sellers(menu_id);

-- Step 7: Add a trigger to automatically create address records when seller is created
-- This ensures referential integrity

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

-- Step 8: Create a function to generate next address_id
CREATE OR REPLACE FUNCTION get_next_address_id()
RETURNS INTEGER AS $$
DECLARE
    next_id INTEGER;
BEGIN
    SELECT COALESCE(MAX(address_id), 0) + 1 INTO next_id FROM addresses;
    RETURN next_id;
END;
$$ LANGUAGE plpgsql;

-- Optional: Add some sample data structure comments
/*
Expected data flow:
1. When a seller signs up, we generate a new address_id (integer)
2. We insert the seller record with this address_id
3. The trigger automatically creates a corresponding record in addresses table
4. When updating address info, we update the addresses table using the address_id foreign key
*/ 