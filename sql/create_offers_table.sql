-- Create offers table for storing seller offers with Cloudinary image links
-- Following the existing database schema pattern

CREATE TABLE offers (
    offer_id SERIAL PRIMARY KEY,
    seller_id VARCHAR NOT NULL REFERENCES sellers(seller_id) ON DELETE CASCADE,
    offer_title VARCHAR(255) NOT NULL,
    offer_description TEXT,
    offer_image VARCHAR(500), -- Cloudinary URL (can be long)
    offer_image_public_id VARCHAR(255), -- For deletion from Cloudinary
    discount_type VARCHAR(20) CHECK (discount_type IN ('percentage', 'fixed_amount')),
    discount_value INTEGER, -- Percentage (1-100) or fixed amount in rupees
    min_order_amount INTEGER DEFAULT 0,
    max_discount_amount INTEGER, -- Only for percentage discounts
    valid_from TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITHOUT TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    usage_limit INTEGER, -- Max number of times this offer can be used
    used_count INTEGER DEFAULT 0, -- Track usage
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    
    -- Ensure valid discount values
    CONSTRAINT check_discount_percentage CHECK (
        discount_type != 'percentage' OR (discount_value >= 1 AND discount_value <= 100)
    ),
    CONSTRAINT check_discount_amount CHECK (
        discount_type != 'fixed_amount' OR discount_value > 0
    ),
    CONSTRAINT check_valid_dates CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT check_usage_limit CHECK (usage_limit IS NULL OR usage_limit > 0)
);

-- Create indexes for better query performance
CREATE INDEX idx_offers_seller_id ON offers(seller_id);
CREATE INDEX idx_offers_active ON offers(is_active);
CREATE INDEX idx_offers_valid_dates ON offers(valid_from, valid_until);
CREATE INDEX idx_offers_created_at ON offers(created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE offers IS 'Stores seller promotional offers with Cloudinary-hosted images';
COMMENT ON COLUMN offers.offer_image IS 'Cloudinary secure_url for the offer image';
COMMENT ON COLUMN offers.offer_image_public_id IS 'Cloudinary public_id for image deletion';
COMMENT ON COLUMN offers.discount_type IS 'Type of discount: percentage or fixed_amount';
COMMENT ON COLUMN offers.discount_value IS 'Discount percentage (1-100) or fixed amount in rupees';
COMMENT ON COLUMN offers.min_order_amount IS 'Minimum order amount to apply this offer';
COMMENT ON COLUMN offers.max_discount_amount IS 'Maximum discount cap for percentage offers';