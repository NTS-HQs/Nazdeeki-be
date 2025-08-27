-- Update offers table to make fields optional for simplified offers
-- This makes the previously required fields nullable

ALTER TABLE offers 
ALTER COLUMN offer_title DROP NOT NULL,
ALTER COLUMN discount_type DROP NOT NULL,
ALTER COLUMN discount_value DROP NOT NULL;

-- Update constraints to handle nullable discount fields
ALTER TABLE offers DROP CONSTRAINT IF EXISTS check_discount_percentage;
ALTER TABLE offers DROP CONSTRAINT IF EXISTS check_discount_amount;

-- Add new flexible constraints that work with nullable values
ALTER TABLE offers ADD CONSTRAINT check_discount_percentage_nullable 
  CHECK (discount_type IS NULL OR discount_type != 'percentage' OR (discount_value IS NOT NULL AND discount_value >= 1 AND discount_value <= 100));

ALTER TABLE offers ADD CONSTRAINT check_discount_amount_nullable 
  CHECK (discount_type IS NULL OR discount_type != 'fixed_amount' OR (discount_value IS NOT NULL AND discount_value > 0));

-- Add comment to document the change
COMMENT ON TABLE offers IS 'Simplified offers table - stores promotional offers with optional discount details and required validity periods';